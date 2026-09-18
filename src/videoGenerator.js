// videoGenerator.js
const ffmpegPath = require('ffmpeg-static');
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const SECONDS_PER_IMAGE = 3;
const FPS = 24;
const WIDTH = 576;
const HEIGHT = 1024;
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

let _subtitlesSupported = null;
function isSubtitlesSupported() {
  if (_subtitlesSupported !== null) return _subtitlesSupported;
  try {
    const res = spawnSync(ffmpegPath, ['-hide_banner', '-filters']);
    const output = (res.stdout || '').toString();
    _subtitlesSupported = output.includes('subtitles');
    console.log('🎤 subtitles filteri (karaoke uchun) mavjud:', _subtitlesSupported);
  } catch (e) {
    _subtitlesSupported = false;
  }
  return _subtitlesSupported;
}

// Har bir e'lon uchun necha soniyalik slayd-shou (rasmlar) davomiyligi
// bo'lishini hisoblaydi — karaoke subtitr vaqtini shu bilan moslashtirish uchun.
function computeSlideshowDuration(imageCount) {
  if (imageCount <= 0) return 0;
  if (imageCount === 1) return SECONDS_PER_IMAGE;
  return SECONDS_PER_IMAGE + (imageCount - 1) * (SECONDS_PER_IMAGE - TRANSITION_DURATION);
}

function escapeDrawtext(text) {
  return String(text)
    .replace(/\\/g, '\\\\\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\u2019")
    .replace(/%/g, '\\%');
}

/**
 * @param {string[]} imagePaths
 * @param {string} outputPath
 * @param {{ musicPath?: string, voicePath?: string }} audioOptions - fon
 *   musiqasi va/yoki ovozli tavsif fayllari (ikkalasi ham ixtiyoriy).
 * @param {object} overlayData
 * @param {string} [captionsAssPath] - karaoke uslubidagi .ass subtitr fayl
 *   yo'li (ixtiyoriy). Mavjud bo'lsa, slayd-shou qismiga "kuydiriladi".
 */
function generateVideoFromImages(imagePaths, outputPath, audioOptions, overlayData, captionsAssPath) {
  return new Promise((resolve, reject) => {
    if (!imagePaths || imagePaths.length === 0) {
      return reject(new Error('Kamida bitta rasm kerak'));
    }

    const musicPath = audioOptions?.musicPath;
    const voicePath = audioOptions?.voicePath;
    const hasMusic = musicPath && fs.existsSync(musicPath);
    const hasVoice = voicePath && fs.existsSync(voicePath);

    const useText = isDrawtextSupported();
    if (!useText) {
      console.log('🎬 drawtext mavjud emas — matn/intro/outro o\'tkazib yuboriladi, faqat crossfade + audio ishlatiladi.');
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

    // ============================================================
    // KARAOKE SUBTITR: so'z-so'z yorishib boradigan matn (ixtiyoriy).
    // Bu drawtext'dan MUSTAQIL ishlaydi (libass orqali), shuning uchun
    // drawtext mavjud bo'lmasa ham (useText=false) ishlashi mumkin.
    // ============================================================
    if (captionsAssPath && fs.existsSync(captionsAssPath) && isSubtitlesSupported()) {
      const escapedPath = captionsAssPath.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
      filterParts.push(`[${mainLabel}]subtitles=filename='${escapedPath}'[capped]`);
      mainLabel = 'capped';
    } else if (captionsAssPath) {
      console.log('🎤 subtitles filtri mavjud emas yoki fayl topilmadi — karaoke subtitr o\'tkazib yuboriladi.');
    }

    let outputLabel;
    if (useText) {
      filterParts.push(`[introv][${mainLabel}][outrov]concat=n=3:v=1:a=0[outv]`);
      outputLabel = 'outv';
    } else {
      filterParts.push(`[${mainLabel}]format=yuv420p[outv]`);
      outputLabel = 'outv';
    }

    // ============================================================
    // AUDIO: fon musiqasi va ovozli tavsifni (ikkalasi ham ixtiyoriy)
    // birlashtiramiz. apad orqali ikkalasi ham video uzunligidan
    // KAMIDA uzun bo'lishi ta'minlanadi, keyin -shortest orqali aynan
    // video uzunligiga qadar qirqiladi — bu video hech qachon audio
    // sababli qisqarib qolmasligini kafolatlaydi.
    // ============================================================
    let musicIdx = null;
    let voiceIdx = null;
    let nextInputIdx = imageStartIdx + imagePaths.length;

    if (hasMusic) {
      inputs.push('-i', musicPath);
      musicIdx = nextInputIdx++;
    }
    if (hasVoice) {
      inputs.push('-i', voicePath);
      voiceIdx = nextInputIdx++;
    }

    let audioOutputLabel = null;
    if (hasMusic && hasVoice) {
      filterParts.push(`[${musicIdx}:a]volume=0.35,apad=pad_dur=30[bgpad]`);
      filterParts.push(`[${voiceIdx}:a]volume=1.4,apad=pad_dur=30[vopad]`);
      filterParts.push(`[bgpad][vopad]amix=inputs=2:duration=longest:dropout_transition=2[aout]`);
      audioOutputLabel = 'aout';
    } else if (hasMusic) {
      filterParts.push(`[${musicIdx}:a]apad=pad_dur=30[aout]`);
      audioOutputLabel = 'aout';
    } else if (hasVoice) {
      filterParts.push(`[${voiceIdx}:a]volume=1.4,apad=pad_dur=30[aout]`);
      audioOutputLabel = 'aout';
    }

    const filterComplex = filterParts.join(';');

    const args = [
      ...inputs,
      '-filter_complex', filterComplex,
      '-map', `[${outputLabel}]`,
    ];

    if (audioOutputLabel) {
      args.push('-map', `[${audioOutputLabel}]`);
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

module.exports = { generateVideoFromImages, computeSlideshowDuration, WIDTH, HEIGHT };
