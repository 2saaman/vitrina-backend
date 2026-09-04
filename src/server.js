require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const { addListing, getAllListings } = require('./db');
const { generateVideoFromImages } = require('./videoGenerator');
const { generateCaption, generateHashtags } = require('./captionGenerator');
const { uploadVideo } = require('./cloudinary');
const { startScheduler } = require('./scheduler');
const { optimizePostTime } = require('./postTimeOptimizer');

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

// Yangi e'lon qo'shish: rasmlar + ma'lumot + qachon joylanishi
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
    await generateVideoFromImages(imagePaths, videoOutputPath, musicPath);

    // Vaqtinchalik yuklangan rasmlarni tozalash
    imagePaths.forEach((p) => fs.unlink(p, () => {}));

    // Videoni Cloudinary'ga yuklash (turg'un havola olish uchun)
    const videoUrl = await uploadVideo(videoOutputPath, id);

    // Lokal video faylni endi kerak emas, o'chiramiz
    fs.unlink(videoOutputPath, () => {});

    const data = { uyTuri, manzil, narx, qavat, xonalar, maydon, xususiyat };
    const caption = generateCaption(data);
    const hashtags = generateHashtags(data);

    // Joylash vaqtini optimallashtirish: agar foydalanuvchi vaqti "yomon" oynaga
    // tushsa, avtomatik eng yaqin optimal vaqtga ko'chiriladi.
    let finalScheduledFor = scheduledFor;
    if (scheduledFor) {
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

// Serverning ishlab turganini tekshirish
app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

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
