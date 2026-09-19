// videoNarrator.js
// Foydalanuvchi yuborgan TAYYOR videoga AI ovozli tavsif (narration) va
// karaoke subtitr qo'shadi. videoGenerator.js'dan farqi: bu rasmlardan
// yangi video yig'maydi, balki MAVJUD video faylni qayta ishlaydi.

const ffmpegPath = require('ffmpeg-static');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');

// Video faylining davomiyligi va o'lchamini aniqlaydi. Alohida ffprobe
// dasturi o'rnatilmagan bo'lishi mumkinligi uchun, buning o'rniga ffmpeg'ning
// o'zidan (chiqish fayl bermay) olingan diagnostika matnidan o'qib olamiz.
function getVideoInfo(inputPath) {
  const res = spawnSync(ffmpegPath, ['-i', inputPath], { encoding: 'utf8' });
  const output = (res.stderr || '') + (res.stdout || '');

  const durationMatch = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  let duration = null;
  if (durationMatch) {
    const [, hh, mm, ss] = durationMatch;
    duration = parseInt(hh, 10) * 3600 + parseInt(mm, 10) * 60 + parseFloat(ss);
  }

  const resMatch = output.match(/,\s*(\d{2,5})x(\d{2,5})[\s,]/);
  let width = null, height = null;
  if (resMatch) {
    width = parseInt(resMatch[1], 10);
    height = parseInt(resMatch[2], 10);
  }

  return { duration, width, height };
}

let _subtitlesSupported = null;
function isSubtitlesSupported() {
  if (_subtitlesSupported !== null) return _subtitlesSupported;
  try {
    const res = spawnSync(ffmpegPath, ['-hide_banner', '-filters']);
    _subtitlesSupported = (res.stdout || '').toString().includes('subtitles');
  } catch (e) {
    _subtitlesSupported = false;
  }
  return _subtitlesSupported;
}

/**
 * Mavjud videoga ovoz (+ ixtiyoriy fon musiqasi) va karaoke subtitr qo'shadi.
 * @param {object} opts
 * @param {string} opts.inputVideoPath - kirish video fayli
 * @param {string} opts.outputPath - chiqish video fayli
 * @param {string} [opts.voicePath] - ovozli tavsif audio fayli
 * @param {string} [opts.musicPath] - fon musiqasi fayli
 * @param {string} [opts.captionsAssPath] - karaoke subtitr .ass fayli
 * @returns {Promise<{outputPath: string, duration: number}>}
 */
function narrateExistingVideo({ inputVideoPath, outputPath, voicePath, musicPath, captionsAssPath }) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(inputVideoPath)) {
      return reject(new Error('Kirish video fayli topilmadi'));
    }

    const info = getVideoInfo(inputVideoPath);
    if (!info.duration) {
      return reject(new Error("Video davomiyligini aniqlab bo'lmadi"));
    }

    const hasVoice = voicePath && fs.existsSync(voicePath);
    const hasMusic = musicPath && fs.existsSync(musicPath);
    const hasCaptions = captionsAssPath && fs.existsSync(captionsAssPath) && isSubtitlesSupported();

    const inputs = ['-i', inputVideoPath];
    let voiceIdx = null, musicIdx = null;
    let nextIdx = 1;
    if (hasVoice) { inputs.push('-i', voicePath); voiceIdx = nextIdx++; }
    if (hasMusic) { inputs.push('-i', musicPath); musicIdx = nextIdx++; }

    const filterParts = [];

    // Video qatlami: agar subtitr bo'lsa, uni "kuydiramiz"
    let videoLabel = '0:v';
    const scaleFilter = `scale='min(720,iw)':'-2'`;
    if (hasCaptions) {
      const escapedPath = captionsAssPath.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
      filterParts.push(`[0:v]${scaleFilter},subtitles=filename='${escapedPath}',format=yuv420p[vout]`);
      videoLabel = 'vout';
    } else {
      filterParts.push(`[0:v]${scaleFilter},format=yuv420p[vout]`);
      videoLabel = 'vout';
    }

    // Audio qatlami: ovoz + musiqa (ikkalasi ham ixtiyoriy)
    let audioLabel = null;
    if (hasVoice && hasMusic) {
      filterParts.push(`[${voiceIdx}:a]volume=1.4,apad=pad_dur=30[vo]`);
      filterParts.push(`[${musicIdx}:a]volume=0.3,apad=pad_dur=30[bg]`);
      filterParts.push(`[vo][bg]amix=inputs=2:duration=longest:dropout_transition=2[aout]`);
      audioLabel = 'aout';
    } else if (hasVoice) {
      filterParts.push(`[${voiceIdx}:a]volume=1.4,apad=pad_dur=30[aout]`);
      audioLabel = 'aout';
    } else if (hasMusic) {
      filterParts.push(`[${musicIdx}:a]apad=pad_dur=30[aout]`);
      audioLabel = 'aout';
    }

    const args = [
      ...inputs,
      '-filter_complex', filterParts.join(';'),
      '-map', `[${videoLabel}]`,
    ];

    if (audioLabel) {
      args.push('-map', `[${audioLabel}]`);
      args.push('-shortest');
      args.push('-c:a', 'aac', '-b:a', '128k');
    }

    args.push(
      '-pix_fmt', 'yuv420p',
      '-preset', 'ultrafast',
      '-threads', '1',
      '-crf', '28',
      '-movflags', '+faststart',
      '-y',
      outputPath
    );

    const proc = spawn(ffmpegPath, args);
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => {
      if (code === 0 && fs.existsSync(outputPath)) {
        resolve({ outputPath, duration: info.duration });
      } else {
        reject(new Error('ffmpeg xatosi: ' + stderr.slice(-1200)));
      }
    });
  });
}

module.exports = { narrateExistingVideo, getVideoInfo };
