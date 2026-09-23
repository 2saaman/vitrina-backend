require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const { addListing, getAllListings, updateListing } = require('./db');
const { generateVideoFromImages, computeSlideshowDuration, WIDTH, HEIGHT } = require('./videoGenerator');
const { generateNarrationScript } = require('./narrationGenerator');
const { synthesizeSpeech } = require('./ttsGenerator');
const { generateKaraokeSubtitles } = require('./captionsGenerator');
const { narrateExistingVideo } = require('./videoNarrator');

// Karaoke subtitr yoqilgan/o'chirilganligi — buni Render Environment'da
// ENABLE_KARAOKE_CAPTIONS=false qilib qo'ysangiz, kodni o'zgartirmasdan
// darhol o'chirib qo'yish mumkin (yoqmasa, shunchaki shu qiymatni o'zgartiring).
const ENABLE_KARAOKE_CAPTIONS = process.env.ENABLE_KARAOKE_CAPTIONS !== 'false';
const { generateCaption, generateHashtags } = require('./captionGenerator');
const { uploadVideo } = require('./cloudinary');
const { startScheduler } = require('./scheduler');
const { optimizePostTime } = require('./postTimeOptimizer');
const { publishReel } = require('./instagramPublisher');
const { publishToTelegram } = require('./telegramPublisher');
const { getInsightsStatus, fetchOnlineFollowers } = require('./instagramInsights');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/videos', express.static(path.join(__dirname, '..', 'public', 'videos')));

const upload = multer({ dest: path.join(__dirname, '..', 'public', 'uploads') });
const MAX_IMAGES = 5;
const MUSIC_DIR = path.join(__dirname, '..', 'public', 'music');

// public/music papkasidan tasodifiy musiqa tanlaydi (fayllar bo'lmasa, musiqasiz davom etadi)
function pickRandomMusic() {
  try {
    console.log('🎵 Musiqa papkasi tekshirilmoqda:', MUSIC_DIR);
    if (!fs.existsSync(MUSIC_DIR)) {
      console.log('🎵 Musiqa papkasi topilmadi!');
      return null;
    }
    const files = fs.readdirSync(MUSIC_DIR).filter((f) => f.toLowerCase().endsWith('.mp3'));
    console.log('🎵 Topilgan mp3 fayllar:', files);
    if (files.length === 0) return null;
    const chosen = files[Math.floor(Math.random() * files.length)];
    console.log('🎵 Tanlangan musiqa:', chosen);
    return path.join(MUSIC_DIR, chosen);
  } catch (e) {
    console.log('🎵 Musiqa tanlashda xatolik:', e.message);
    return null;
  }
}

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
app.post('/api/listings', checkAuth, upload.array('images', MAX_IMAGES), async (req, res) => {
  try {
    const { uyTuri, manzil, narx, qavat, xonalar, maydon, xususiyat, scheduledFor } = req.body;
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Kamida bitta rasm kerak' });
    }

    const id = uuidv4();
    const imagePaths = req.files.map((f) => f.path);
    const videoFileName = `${id}.mp4`;
    const videoOutputPath = path.join(__dirname, '..', 'public', 'videos', videoFileName);

    const musicPath = pickRandomMusic();

    // Ovozli tavsif (AI narration) yaratish — xatolik bo'lsa ham dastur
    // to'xtamaydi, shunchaki ovozsiz (faqat musiqali) video yaratiladi.
    const narrationScript = generateNarrationScript({ uyTuri, manzil, narx, xonalar, maydon });
    const voiceOutputPath = path.join(__dirname, '..', 'public', 'uploads', `${id}-voice.ogg`);
    let voicePath = null;
    try {
      voicePath = await synthesizeSpeech(narrationScript, voiceOutputPath);
    } catch (e) {
      console.log('🔊 Ovozli tavsif yaratishda kutilmagan xatolik:', e.message);
    }

    // Karaoke subtitr (.ass fayl) — ENABLE_KARAOKE_CAPTIONS orqali yoqib/
    // o'chirish mumkin. Bu vizual effekt bo'lgani uchun ovoz mavjud
    // bo'lmasa ham ishlaydi (taxminiy vaqt taqsimoti bilan).
    let captionsAssPath = null;
    if (ENABLE_KARAOKE_CAPTIONS) {
      const slideshowDuration = computeSlideshowDuration(imagePaths.length);
      captionsAssPath = path.join(__dirname, '..', 'public', 'uploads', `${id}-captions.ass`);
      try {
        generateKaraokeSubtitles(narrationScript, slideshowDuration, captionsAssPath, WIDTH, HEIGHT);
      } catch (e) {
        console.log('🎤 Karaoke subtitr yaratishda xatolik, o\'tkazib yuboriladi:', e.message);
        captionsAssPath = null;
      }
    }

    await generateVideoFromImages(
      imagePaths,
      videoOutputPath,
      { musicPath, voicePath },
      { manzil, narx, xonalar },
      captionsAssPath
    );

    // Vaqtinchalik yuklangan rasmlar, ovoz va subtitr fayllarini tozalash
    imagePaths.forEach((p) => fs.unlink(p, () => {}));
    if (voicePath) fs.unlink(voicePath, () => {});
    if (captionsAssPath) fs.unlink(captionsAssPath, () => {});

    // Videoni Cloudinary'ga yuklash (turg'un havola olish uchun)
    const videoUrl = await uploadVideo(videoOutputPath, id);

    // Lokal video faylni endi kerak emas, o'chiramiz
    fs.unlink(videoOutputPath, () => {});

    const data = { uyTuri, manzil, narx, qavat, xonalar, maydon, xususiyat };
    const caption = generateCaption(data);
    const hashtags = generateHashtags(data);
    const fullCaption = `${caption}\n\n${hashtags.join(' ')}`;

    const hasScheduledTime = scheduledFor && String(scheduledFor).trim() !== '';

    // ============================================================
    // 1-REJIM: DARHOL JOYLASH — scheduledFor berilmagan
    // ============================================================
    if (!hasScheduledTime) {
      console.log('⚡ scheduledFor berilmagan — video darhol Instagram\'ga joylanmoqda...');

      addListing({
        id, uyTuri, manzil, narx, qavat, xonalar, maydon, xususiyat,
        caption, hashtags, videoUrl,
        status: 'joylanmoqda', scheduledFor: null,
        postedAt: null, igPostId: null,
        createdAt: new Date().toISOString()
      });

      try {
        const igPostId = await publishReel({
          igUserId: process.env.IG_USER_ID,
          accessToken: process.env.IG_ACCESS_TOKEN,
          videoUrl,
          caption: fullCaption
        });

        let telegramMessageId = null;
        try {
          telegramMessageId = await publishToTelegram({
            botToken: process.env.TELEGRAM_BOT_TOKEN,
            channelUsername: process.env.TELEGRAM_CHANNEL,
            videoUrl,
            caption: fullCaption
          });
          console.log(`✅ Telegram'ga ham joylandi: xabar #${telegramMessageId}`);
        } catch (tgErr) {
          console.log('📨 Telegram\'ga joylashda xatolik (Instagram\'ga baribir joylandi):', tgErr.message);
        }

        updateListing(id, { status: 'joylandi', postedAt: new Date().toISOString(), igPostId });
        console.log(`✅ Darhol joylandi: ${id} -> IG post ${igPostId}`);

        return res.json({
          id, caption, hashtags, videoUrl,
          status: 'joylandi', igPostId, telegramMessageId,
          message: '✅ Video darhol Instagram\'ga joylandi!'
        });
      } catch (publishErr) {
        updateListing(id, { status: 'xato' });
        console.error(`❌ Darhol joylashda xatolik (${id}):`, publishErr.message);
        return res.status(500).json({
          id, caption, hashtags, videoUrl,
          status: 'xato',
          error: `Joylashda xatolik: ${publishErr.message}`
        });
      }
    }

    // ============================================================
    // 2-REJIM: REJALASHTIRILGAN JOYLASH — scheduledFor berilgan
    // ============================================================
    let finalScheduledFor = scheduledFor;
    try {
      const { optimizedTime, wasAdjusted, originalTime } = optimizePostTime(scheduledFor);
      finalScheduledFor = optimizedTime.toISOString();
      if (wasAdjusted) {
        console.log(`⏰ Vaqt optimallashtirildi: ${originalTime.toISOString()} → ${finalScheduledFor}`);
      } else {
        console.log(`⏰ Vaqt allaqachon optimal: ${finalScheduledFor}`);
      }
    } catch (e) {
      console.log('⏰ Vaqtni optimallashtirishda xatolik, asl vaqt ishlatiladi:', e.message);
      finalScheduledFor = scheduledFor;
    }

    addListing({
      id, uyTuri, manzil, narx, qavat, xonalar, maydon, xususiyat,
      caption, hashtags, videoUrl,
      status: 'kutilmoqda', scheduledFor: finalScheduledFor,
      postedAt: null, igPostId: null,
      createdAt: new Date().toISOString()
    });

    res.json({ id, caption, hashtags, videoUrl, scheduledFor: finalScheduledFor, status: 'kutilmoqda' });
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
    const videoHeight = info.height || HEIGHT;

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
});
