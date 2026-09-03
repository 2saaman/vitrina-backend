const ffmpegPath = require('ffmpeg-static');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const SECONDS_PER_IMAGE = 2.5;
const FPS = 18;
const WIDTH = 720;
const HEIGHT = 900;

/**
 * Bir nechta rasmdan pan/zoom (Ken Burns) effektli video yasaydi va musiqa qo'shadi.
 * @param {string[]} imagePaths - lokal rasm fayllari yo'llari
 * @param {string} outputPath - chiqish video fayli (.mp4)
 * @param {string} [musicPath] - musiqa fayli yo'li (ixtiyoriy)
 * @returns {Promise<string>} outputPath
 */
function generateVideoFromImages(imagePaths, outputPath, musicPath) {
  return new Promise((resolve, reject) => {
    if (!imagePaths || imagePaths.length === 0) {
      return reject(new Error('Kamida bitta rasm kerak'));
    }

    const frames = Math.round(SECONDS_PER_IMAGE * FPS);
    const inputs = [];
    const filterParts = [];

    imagePaths.forEach((imgPath, i) => {
      inputs.push('-loop', '1', '-i', imgPath);
      const zoomDirection = i % 2 === 0 ? 'zoom+0.0015' : '1.12-0.0015*on';
      filterParts.push(
        `[${i}:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,` +
        `crop=${WIDTH}:${HEIGHT},` +
        `zoompan=z='${zoomDirection}':d=${frames}:s=${WIDTH}x${HEIGHT}:fps=${FPS},` +
        `trim=duration=${SECONDS_PER_IMAGE},` +
        `format=yuv420p[v${i}]`
      );
    });

    const concatInputs = imagePaths.map((_, i) => `[v${i}]`).join('');
    const filterComplex = filterParts.join(';') + `;${concatInputs}concat=n=${imagePaths.length}:v=1:a=0[outv]`;

    // Musiqa fayli mavjud bo'lsa, uni oxirgi input qilib qo'shamiz
    const audioInputIndex = imagePaths.length; // musiqa input indeksi (rasmlardan keyin)
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
      args.push('-shortest'); // video/audio dan qisqasiga moslashtiradi
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
        reject(new Error('ffmpeg xatosi: ' + stderr.slice(-800)));
      }
    });
  });
}

module.exports = { generateVideoFromImages };
