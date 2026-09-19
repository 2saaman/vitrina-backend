// ocrGenerator.js
// Video kadrlaridan yozuvni (masalan avvaldan kuydirilgan subtitr) avtomatik
// o'qib oladi (OCR). Ssenariy matni bo'sh qoldirilganda ishlatiladi.
//
// DIQQAT: bu TAXMINIY natija beradi — shrift, fon rangi va yozuv joylashuviga
// qarab noto'g'ri o'qishi mumkin. Agar natija noto'g'ri bo'lsa, ssenariy
// maydoniga matnni qo'lda yozib qo'ying.
//
// Server resurslarini tejash uchun butun video emas, faqat bir nechta
// kadr (FRAME_COUNT) tekshiriladi, va faqat pastki qism (subtitr odatda
// shu yerda joylashadi) qirqib olinadi.

const ffmpegPath = require('ffmpeg-static');
const { spawnSync } = require('child_process');
const fs = require('fs');
const Tesseract = require('tesseract.js');
const { getVideoInfo } = require('./videoNarrator');

const FRAME_COUNT = 3;

function extractFrame(videoPath, atSeconds, outputPath) {
  const res = spawnSync(ffmpegPath, [
    '-ss', String(atSeconds),
    '-i', videoPath,
    '-frames:v', '1',
    '-vf', 'crop=iw:ih*0.3:0:ih*0.65', // pastki ~30% qism (subtitr odatda shu yerda)
    '-y', outputPath
  ]);
  return fs.existsSync(outputPath);
}

/**
 * Video kadrlaridan matnni o'qishga urinadi.
 * Muvaffaqiyatsiz bo'lsa yoki hech narsa topilmasa — null qaytaradi.
 */
async function extractCaptionText(videoPath) {
  const info = getVideoInfo(videoPath);
  const duration = info.duration || 10;

  const framePaths = [];
  for (let i = 1; i <= FRAME_COUNT; i++) {
    const t = (duration * i) / (FRAME_COUNT + 1);
    const framePath = `${videoPath}.frame${i}.png`;
    if (extractFrame(videoPath, t, framePath)) {
      framePaths.push(framePath);
    }
  }

  if (framePaths.length === 0) return null;

  const lines = new Set();
  for (const fp of framePaths) {
    try {
      const { data } = await Tesseract.recognize(fp, 'eng');
      const text = (data.text || '').trim();
      if (text) lines.add(text.replace(/\s+/g, ' '));
    } catch (e) {
      console.log('🔍 OCR xatosi (bitta kadr uchun):', e.message);
    } finally {
      fs.unlink(fp, () => {});
    }
  }

  const combined = Array.from(lines).join('. ').trim();
  return combined || null;
}

module.exports = { extractCaptionText };
