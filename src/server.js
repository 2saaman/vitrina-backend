require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const { getAllListings } = require('./db');
const { WIDTH } = require('./videoGenerator');
const { synthesizeSpeech } = require('./ttsGenerator');
const { generateKaraokeSubtitles } = require('./captionsGenerator');
const { narrateExistingVideo } = require('./videoNarrator');

// Karaoke subtitr yoqilgan/o'chirilganligi — buni Render Environment'da
// ENABLE_KARAOKE_CAPTIONS=false qilib qo'ysangiz, kodni o'zgartirmasdan
// darhol o'chirib qo'yish mumkin (yoqmasa, shunchaki shu qiymatni o'zgartiring).
const ENABLE_KARAOKE_CAPTIONS = process.env.ENABLE_KARAOKE_CAPTIONS !== 'false';
const { uploadVideo } = require('./cloudinary');
const { startScheduler } = require('./scheduler');
const { getInsightsStatus, fetchOnlineFollowers } = require('./instagramInsights');
const { createAndPublishListing, pickRandomMusic } = require('./listingPipeline');
const { startTelegramBot } = require('./telegramBot');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/videos', express.static(path.join(__dirname, '..', 'public', 'videos')));

const upload = multer({ dest: path.join(__dirname, '..', 'public', 'uploads') });
const MAX_IMAGES = 5;

// Oddiy himoya: har bir so'rov ADMIN_SECRET bilan kelishi kerak
function checkAuth(req, res, next) {
  const secret = req.headers['x-admin-secret'];
  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: "Ruxsat yo'q" });
  }
  next();
}

// Asosiy sahifa — UptimeRobot va boshqa monitoring xizmatlari uchun
// oddiy "200 OK" javobi (health check bilan bir xil ma'noda)
app.get('/', (req, res) => res.json({ ok: true, service: 'vitrina-backend' }));

// Yangi e'lon qo'shish: rasmlar + ma'lumot + qachon joylanishi
//
// IKKI XIL REJIM:
//   1) scheduledFor BERILGAN  -> e'lon "kutilmoqda" holatida saqlanadi,
//      scheduler (har daqiqada tekshiradi) belgilangan vaqt kelganda joylaydi.
//   2) scheduledFor BERILMAGAN (bo'sh) -> video tayyor bo'lgach, DARHOL
//      Instagram'ga joylanadi, scheduler'ni kutish shart emas.
//
// Video yasash + joylash mantig'i endi listingPipeline.js ichida —
// shu fayl Telegram bot bilan ham baham ko'riladi (telegramBot.js).
app.post('/api/listings', checkAuth, upload.array('images', MAX_IMAGES), async (req, res) => {
  try {
    const { uyTuri, manzil, narx, qavat, xonalar, maydon, xususiyat, scheduledFor } = req.body;
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Kamida bitta rasm kerak' });
    }

    const imagePaths = req.files.map((f) => f.path);
    const fields = { uyTuri, manzil, narx, qavat, xonalar, maydon, xususiyat };

    const result = await createAndPublishListing(imagePaths, fields, scheduledFor);

    if (result.status === 'xato') {
      return res.status(500).json({
        ...result,
        message: `Joylashda xatolik: ${result.error}`
      });
    }

    const message = result.status === 'joylandi'
      ? "✅ Video darhol Instagram'ga joylandi!"
      : undefined;

    return res.json({ ...result, message });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Barcha e'lonlar tarixi
app.get('/api/listings', checkAuth, (req, res) => {
  res.json(getAllListings());
});

// TAYYOR videoga AI ovozli tavsif + karaoke subtitr qo'shish.
// Instagram'ga AVTOMATIK JOYLANMAYDI — natija video havolasi qaytariladi,
// uni o'zingiz yuklab olib, kerakli joyga (masalan boshqa odamning
// sahifasiga) qo'lda joylashtirasiz.
app.post('/api/narrate-video', checkAuth, upload.single('video'), async (req, res) => {
  const cleanupPaths = [];
  try {
    const { script: rawScript, addMusic, skipCaptions } = req.body;
    if (!req.file) {
      return res.status(400).json({ error: 'Video fayl kerak' });
    }

    const id = uuidv4();
    const inputVideoPath = req.file.path;
    cleanupPaths.push(inputVideoPath);

    let script = rawScript && rawScript.trim() ? rawScript.trim() : null;
    let scriptSource = 'manual';

    if (!script) {
      console.log('🔍 Ssenariy matni berilmagan — video ichidan avtomatik o\'qishga (OCR) urinilmoqda...');
      try {
        const { extractCaptionText } = require('./ocrGenerator');
        script = await extractCaptionText(inputVideoPath);
        scriptSource = 'ocr';
      } catch (e) {
        console.log('🔍 OCR xatosi:', e.message);
      }
      if (!script) {
        cleanupPaths.forEach((p) => fs.unlink(p, () => {}));
        return res.status(400).json({
          error: "Video ichidagi yozuvni avtomatik o'qib bo'lmadi. Iltimos, ssenariy matnini qo'lda kiriting."
        });
      }
      console.log('🔍 OCR orqali o\'qilgan matn:', script);
    }

    const voiceOutputPath = path.join(__dirname, '..', 'public', 'uploads', `${id}-nv-voice.ogg`);
    let voicePath = null;
    try {
      voicePath = await synthesizeSpeech(script, voiceOutputPath);
      if (voicePath) cleanupPaths.push(voicePath);
    } catch (e) {
      console.log('🔊 Ovoz yaratishda xatolik:', e.message);
    }

    const musicPath = addMusic === 'true' ? pickRandomMusic() : null;

    // Video davomiyligini aniqlash (subtitr vaqtini shunga moslash uchun)
    const { getVideoInfo } = require('./videoNarrator');
    const info = getVideoInfo(inputVideoPath);
    const videoDuration = info.duration || 15;
    const videoWidth = info.width || WIDTH;
    const videoHeight = info.height || require('./videoGenerator').HEIGHT;

    let captionsAssPath = null;
    if (ENABLE_KARAOKE_CAPTIONS && skipCaptions !== 'true') {
      captionsAssPath = path.join(__dirname, '..', 'public', 'uploads', `${id}-nv-captions.ass`);
      try {
        generateKaraokeSubtitles(script, videoDuration, captionsAssPath, videoWidth, videoHeight);
        cleanupPaths.push(captionsAssPath);
      } catch (e) {
        console.log('🎤 Subtitr yaratishda xatolik:', e.message);
        captionsAssPath = null;
      }
    }

    const finalOutputPath = path.join(__dirname, '..', 'public', 'videos', `${id}-narrated.mp4`);
    await narrateExistingVideo({
      inputVideoPath,
      outputPath: finalOutputPath,
      voicePath,
      musicPath,
      captionsAssPath
    });

    const videoUrl = await uploadVideo(finalOutputPath, id);
    fs.unlink(finalOutputPath, () => {});
    cleanupPaths.forEach((p) => fs.unlink(p, () => {}));

    res.json({
      videoUrl,
      usedScript: script,
      scriptSource,
      message: scriptSource === 'ocr'
        ? '✅ Video tayyor. Matn video ichidan avtomatik o\'qildi — natijani albatta tekshiring.'
        : '✅ Video tayyor — yuklab oling va kerakli joyga joylashtiring.'
    });
  } catch (err) {
    cleanupPaths.forEach((p) => fs.unlink(p, () => {}));
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Serverning ishlab turganini tekshirish
app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// Optimal vaqt tizimi qaysi rejimda ishlayotganini tekshirish:
// haqiqiy Instagram ma'lumotidan foydalanyaptimi, yoki hali standart
// (tadqiqotga asoslangan) oynalarni ishlatyaptimi.
app.get('/api/insights-status', checkAuth, (req, res) => {
  res.json(getInsightsStatus());
});

// Insights ma'lumotini qo'lda (darhol) yangilash — 6 soat kutmasdan tekshirish uchun
app.post('/api/insights-refresh', checkAuth, async (req, res) => {
  const values = await fetchOnlineFollowers({
    igUserId: process.env.IG_USER_ID,
    accessToken: process.env.IG_ACCESS_TOKEN
  });
  res.json({ updated: !!values, status: getInsightsStatus() });
});

// Multer va boshqa xatoliklarni chiroyli JSON ko'rinishida qaytarish
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ error: `Ko'pi bilan ${MAX_IMAGES} ta rasm yuklash mumkin` });
  }
  console.error(err);
  res.status(500).json({ error: err.message || 'Kutilmagan xatolik' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Vitrina backend ${PORT}-portda ishga tushdi`);
  startScheduler();
  startTelegramBot();
});
