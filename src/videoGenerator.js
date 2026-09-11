// videoGenerator.js
const ffmpegPath = require('ffmpeg-static');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const SECONDS_PER_IMAGE = 2.5;
const FPS = 18;
const WIDTH = 720;
const HEIGHT = 900;
const TRANSITION_DURATION = 0.5; // rasmlar orasidagi crossfade davomiyligi
const INTRO_DURATION = 1.5;
const OUTRO_DURATION = 2;
const FONT_PATH = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

// drawtext filteri uchun matnni xavfsiz escape qiladi
function escapeDrawtext(text) {
  return String(text)
    .replace(/\\/g, '\\\\\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\u2019")
    .replace(/%/g, '\\%');
}

/**
 * Bir nechta rasmdan pan/zoom effektli, o'tishlar va matn bilan video yasaydi.
 * @param {string[]} imagePaths - lokal rasm fayllari yo'llari
 * @param {string} outputPath - chiqish video fayli (.mp4)
 * @param {string} [musicPath] - musiqa fayli yo'li (ixtiyoriy)
 * @param {Object} [overlayData] - { manzil, narx, xonalar } video ustida ko'rsatiladigan matn
 * @returns {Promise<string>} outputPath
 */
function generateVideoFromImages(imagePaths, outputPath, musicPath, overlayData) {
  return new Promise((resolve, reject) => {
    if (!imagePaths || imagePaths.length === 0) {
      return reject(new Error('Kamida bitta rasm kerak'));
    }

    const frames = Math.round(SECONDS_PER_IMAGE * FPS);
    const inputs = [];
    const filterParts = [];

    // 1. Intro va outro uchun rangli fon inputlari (lavfi)
    inputs.push('-f', 'lavfi', '-t', String(INTRO_DURATION), '-i', `color=c=black:s=${WIDTH}x${HEIGHT}:r=${FPS}`);
    inputs.push('-f', 'lavfi', '-t', String(OUTRO_DURATION), '-i', `color=c=black:s=${WIDTH}x${HEIGHT}:r=${FPS}`);
    const introIdx = 0;
    const outroIdx = 1;

    // 2. Rasm inputlari
    const imageStartIdx = 2;
    imagePaths.forEach((imgPath) => {
      inputs.push('-loop', '1', '-i', imgPath);
    });

    // 3. Intro matni
    const introText = escapeDrawtext('HomeBySaman');
    filterParts.push(
      `[${introIdx}:v]drawtext=fontfile=${FONT_PATH}:text='${introText}':fontcolor=white:fontsize=48:` +
      `x=(w-text_w)/2:y=(h-text_h)/2:alpha='if(lt(t,0.3),t/0.3,1)'[introv]`
    );

    // 4. Outro matni
    const outroText = escapeDrawtext('DM ga yozing 📩');
    filterParts.push(
      `[${outroIdx}:v]drawtext=fontfile=${FONT_PATH}:text='${outroText}':fontcolor=white:fontsize=40:` +
      `x=(w-text_w)/2:y=(h-text_h)/2[outrov]`
    );

    // 5. Har bir rasm uchun Ken Burns effekti
    imagePaths.forEach((imgPath, i) => {
      const inputIdx = imageStartIdx + i;
      const zoomDirection = i % 2 === 0 ? 'zoom+0.0015' : '1.12-0.0015*on';
      filterParts.push(
        `[${inputIdx}:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,` +
        `crop=${WIDTH}:${HEIGHT},` +
        `zoompan=z='${zoomDirection}':d=${frames}:s=${WIDTH}x${HEIGHT}:fps=${FPS},` +
        `trim=duration=${SECONDS_PER_IMAGE},` +
        `format=yuv420p[v${i}]`
      );
    });

    // 6. Rasmlarni xfade (crossfade) bilan ketma-ket bog'lash
    let chainLabel = 'v0';
    let accumulatedDuration = SECONDS_PER_IMAGE;
    for (let i = 1; i < imagePaths.length; i++) {
      const nextLabel = `v${i}`;
      const outLabel = i === imagePaths.length - 1 ? 'imgschain' : `x${i}`;
      const offset = accumulatedDuration - TRANSITION_DURATION;
      filterParts.push(
        `[${chainLabel}][${nextLabel}]xfade=transition=fade:duration=${TRANSITION_DURATION}:offset=${offset.toFixed(3)}[${outLabel}]`
      );
      accumulatedDuration = accumulatedDuration + SECONDS_PER_IMAGE - TRANSITION_DURATION;
      chainLabel = outLabel;
    }
    // Agar faqat bitta rasm bo'lsa, xfade kerak emas
    if (imagePaths.length === 1) {
      filterParts.push(`[v0]null[imgschain]`);
    }

    // 7. Rasmlar ustiga narx/manzil matnini yozish (butun davomida pastda)
    let overlayLine = '';
    if (overlayData) {
      const parts = [];
      if (overlayData.manzil) parts.push(overlayData.manzil);
      if (overlayData.xonalar) parts.push(`${overlayData.xonalar} xona`);
      if (overlayData.narx) parts.push(overlayData.narx);
      overlayLine = parts.join('  ·  ');
    }

    let mainLabel = 'imgschain';
    if (overlayLine) {
      const safeText = escapeDrawtext(overlayLine);
      filterParts.push(
        `[imgschain]drawtext=fontfile=${FONT_PATH}:text='${safeText}':fontcolor=white:fontsize=28:` +
        `box=1:boxcolor=black@0.5:boxborderw=10:x=(w-text_w)/2:y=h-th-40[mainv]`
      );
      mainLabel = 'mainv';
    }

    // 8. Intro + asosiy video + outro ni birlashtirish (oddiy concat)
    filterParts.push(
      `[introv][${mainLabel}][outrov]concat=n=3:v=1:a=0[outv]`
    );

    const filterComplex = filterParts.join(';');

    // 9. Musiqa qo'shish
    const audioInputIndex = imageStartIdx + imagePaths.length;
    if (musicPath && fs.existsSync(musicPath)) {
      inputs.push('-i', musicPath);
    }

    const args = [
      ...inputs,
      '-filter_complex', filterComplex,
      '-map', '[outv]',
    ];

    if (musicPath && fs.existsSync(musicPath)) {
      args.push('-map', `${audioInputIndex}:a`);
      args.push('-shortest');
      args.push('-c:a', 'aac', '-b:a', '128k');
    }

    args.push(
      '-r', String(FPS),
      '-pix_fmt', 'yuv420p',
      '-preset', 'ultrafast',
      '-threads', '1',
      '-movflags', '+faststart',
      '-y',
      outputPath
    );

    const proc = spawn(ffmpegPath, args);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve(outputPath);
      } else {
        reject(new Error('ffmpeg xatosi: ' + stderr.slice(-1200)));
      }
    });
  });
}

module.exports = { generateVideoFromImages };
