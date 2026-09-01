const ffmpegPath = require('ffmpeg-static');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const SECONDS_PER_IMAGE = 3;
const FPS = 25;
const WIDTH = 1080;
const HEIGHT = 1350; // Instagram uchun qulay 4:5 nisbat

/**
 * Bir nechta rasmdan pan/zoom (Ken Burns) effektli video yasaydi.
 * @param {string[]} imagePaths - lokal rasm fayllari yo'llari
 * @param {string} outputPath - chiqish video fayli (.mp4)
 * @returns {Promise<string>} outputPath
 */
function generateVideoFromImages(imagePaths, outputPath) {
  return new Promise((resolve, reject) => {
    if (!imagePaths || imagePaths.length === 0) {
      return reject(new Error('Kamida bitta rasm kerak'));
    }

    const frames = SECONDS_PER_IMAGE * FPS;
    const inputs = [];
    const filterParts = [];

    imagePaths.forEach((imgPath, i) => {
      inputs.push('-loop', '1', '-t', String(SECONDS_PER_IMAGE), '-i', imgPath);
      // Har bir rasmga sekin zoom effekti + o'lchamga moslash
      const zoomDirection = i % 2 === 0 ? 'zoom+0.0012' : '1.15-0.0012*on';
      filterParts.push(
        `[${i}:v]scale=${WIDTH * 1.3}:${HEIGHT * 1.3}:force_original_aspect_ratio=increase,` +
        `crop=${WIDTH * 1.3}:${HEIGHT * 1.3},` +
        `zoompan=z='${zoomDirection}':d=${frames}:s=${WIDTH}x${HEIGHT}:fps=${FPS},` +
        `format=yuv420p[v${i}]`
      );
    });

    const concatInputs = imagePaths.map((_, i) => `[v${i}]`).join('');
    const filterComplex = filterParts.join(';') + `;${concatInputs}concat=n=${imagePaths.length}:v=1:a=0[outv]`;

    const args = [
      ...inputs,
      '-filter_complex', filterComplex,
      '-map', '[outv]',
      '-r', String(FPS),
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-y',
      outputPath
    ];

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
