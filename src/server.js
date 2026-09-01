require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const db = require('./db');
const { generateVideoFromImages } = require('./videoGenerator');
const { generateCaption, generateHashtags } = require('./captionGenerator');
const { startScheduler } = require('./scheduler');

const app = express();
app.use(express.json());
app.use('/videos', express.static(path.join(__dirname, '..', 'public', 'videos')));

const upload = multer({ dest: path.join(__dirname, '..', 'public', 'uploads') });

// Oddiy himoya: har bir so'rov ADMIN_SECRET bilan kelishi kerak
function checkAuth(req, res, next) {
  const secret = req.headers['x-admin-secret'];
  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: "Ruxsat yo'q" });
  }
  next();
}

// Yangi e'lon qo'shish: rasmlar + ma'lumot + qachon joylanishi
app.post('/api/listings', checkAuth, upload.array('images', 10), async (req, res) => {
  try {
    const { uyTuri, manzil, narx, qavat, xonalar, maydon, xususiyat, scheduledFor } = req.body;
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'Kamida bitta rasm kerak' });
    }

    const id = uuidv4();
    const imagePaths = req.files.map((f) => f.path);
    const videoFileName = `${id}.mp4`;
    const videoOutputPath = path.join(__dirname, '..', 'public', 'videos', videoFileName);

    await generateVideoFromImages(imagePaths, videoOutputPath);

    // Vaqtinchalik yuklangan rasmlarni tozalash
    imagePaths.forEach((p) => fs.unlink(p, () => {}));

    const data = { uyTuri, manzil, narx, qavat, xonalar, maydon, xususiyat };
    const caption = generateCaption(data);
    const hashtags = generateHashtags(data);

    db.prepare(`
      INSERT INTO listings (id, uyTuri, manzil, narx, xonalar, maydon, xususiyat, caption, hashtags, videoPath, status, scheduledFor)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'kutilmoqda', ?)
    `).run(id, uyTuri, manzil, narx, xonalar, maydon, xususiyat, caption, JSON.stringify(hashtags), videoFileName, scheduledFor);

    res.json({ id, caption, hashtags, videoUrl: `${process.env.PUBLIC_BASE_URL}/videos/${videoFileName}`, scheduledFor, status: 'kutilmoqda' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Barcha e'lonlar tarixi
app.get('/api/listings', checkAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM listings ORDER BY createdAt DESC').all();
  res.json(rows.map((r) => ({ ...r, hashtags: JSON.parse(r.hashtags || '[]') })));
});

// Serverning ishlab turganini tekshirish
app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Vitrina backend ${PORT}-portda ishga tushdi`);
  startScheduler();
});
