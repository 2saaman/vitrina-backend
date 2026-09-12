// videoGenerator.js
const ffmpegPath = require('ffmpeg-static');
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const SECONDS_PER_IMAGE = 3;
const FPS = 18;
const WIDTH = 720;
const HEIGHT = 900;
const TRANSITION_DURATION = 0.5;
const INTRO_DURATION = 1.5;
const OUTRO_DURATION = 2;
const FONT_PATH = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

let _drawtextSupported = null;
function isDrawtextSupported() {
  if (_drawtextSupported !== null) return _drawtextSupported;
  try {
    const res = spawnSync(ffmpegPath, ['-hide_banner', '-filters']);
    const output = (res.stdout || '').toString();
    _drawtextSupported = output.includes('drawtext');
    console.log('🎬 drawtext filteri mavjud:', _drawtextSupported);
  } catch (e) {
    console.log('🎬 drawtext tekshiruvida xatolik:', e.message);
    _drawtextSupported = false;
  }
  return _drawtextSupported;
}

function escapeDrawtext(text) {
  return String(text)
    .replace(/\\/g, '\\\\\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\u2019")
    .replace(/%/g, '\\%');
}

function generateVideoFromImages(imagePaths, outputPath, musicPath, overlayData) {
  return new Promise((resolve, reject) => {
    if (!imagePaths || imagePaths.length === 0) {
      return reject(new Error('Kamida bitta rasm kerak'));
    }

    const useText = isDrawtextSupported();
    if (!useText) {
      console.log('🎬 drawtext mavjud emas — matn/intro/outro o\'tkazib yuboriladi, faqat crossfade + musiqa ishlatiladi.');
    }

    const frames = Math.round(SECONDS_PER_IMAGE * FPS);
    const inputs = [];
    const filterParts = [];

    let introIdx, outroIdx, imageStartIdx;

    if (useText) {
      inputs.push('-f', 'lavfi', '-t', String(INTRO_DURATION), '-i', `color=c=black:s=${WIDTH}x${HEIGHT}:r=${FPS}`);
      inputs.push('-f', 'lavfi', '-t', String(OUTRO_DURATION), '-i', `color=c=black:s=${WIDTH}x${HEIGHT}:r=${FPS}`);
      introIdx = 0;
      outroIdx = 1;
      imageStartIdx = 2;
    } else {
      imageStartIdx = 0;
    }

    imagePaths.forEach((imgPath) => {
      inputs.push('-loop', '1', '-i', imgPath);
    });

    if (useText) {
      const introText = escapeDrawtext('HomeBySaman');
      filterParts.push(
        `[${introIdx}:v]drawtext=fontfile=${FONT_PATH}:text='${introText}':fontcolor=white:fontsize=48:` +
        `x=(w-text_w)/2:y=(h-text_h)/2:alpha='if(lt(t,0.3),t/0.3,1)'[introv]`
      );
      const outroText = escapeDrawtext('DM ga yozing 📩');
      filterParts.push(
        `[${outroIdx}:v]drawtext=fontfile=${FONT_PATH}:text='${outroText}':fontcolor=white:fontsize=40:` +
        `x=(w-text_w)/2:y=(h-text_h)/2[outrov]`
      );
    }

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
    if (imagePaths.length === 1) {
      filterParts.push(`[v0]copy[imgschain]`);
    }

    let mainLabel = 'imgschain';
    if (useText && overlayData) {
      const parts = [];
      if (overlayData.manzil) parts.push(overlayData.manzil);
      if (overlayData.xonalar) parts.push(`${overlayData.xonalar} xona`);
      if (overlayData.narx) parts.push(overlayData.narx);
      const overlayLine = parts.join('  ·  ');
      if (overlayLine) {
        const safeText = escapeDrawtext(overlayLine);
        filterParts.push(
          `[imgschain]drawtext=fontfile=${FONT_PATH}:text='${safeText}':fontcolor=white:fontsize=28:` +
          `box=1:boxcolor=black@0.5:boxborderw=10:x=(w-text_w)/2:y=h-th-40[mainv]`
        );
        mainLabel = 'mainv';
      }
    }

    let outputLabel;
    if (useText) {
      filterParts.push(`[introv][${mainLabel}][outrov]concat=n=3:v=1:a=0[outv]`);
      outputLabel = 'outv';
    } else {
      filterParts.push(`[${mainLabel}]format=yuv420p[outv]`);
      outputLabel = 'outv';
    }

    const filterComplex = filterParts.join(';');

    const audioInputIndex = imageStartIdx + imagePaths.length;
    if (musicPath && fs.existsSync(musicPath)) {
      inputs.push('-i', musicPath);
    }

    const args = [
      ...inputs,
      '-filter_complex', filterComplex,
      '-map', `[${outputLabel}]`,
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
