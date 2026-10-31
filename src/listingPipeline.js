// listingPipeline.js
// Video yasash + Instagram/Telegram'ga joylash bo'yicha ASOSIY logika.
// Bu fayl avval server.js ichida (POST /api/listings yo'lida) yozilgan
// edi — endi alohida fayl qilib ajratildi, chunki endi IKKITA joydan
// chaqiriladi:
//   1) server.js — veb-sahifa (darhol-joyla.html) orqali kelgan so'rovlar
//   2) telegramBot.js — Telegram botga yuborilgan rasm+matn orqali
// Ikkalasi ham xuddi shu funksiyani ishlatadi, shuning uchun video yasash
// mantig'ini ikki joyda saqlashga hojat yo'q.

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const { addListing, updateListing } = require('./db');
const { generateVideoFromImages, computeSlideshowDuration, WIDTH, HEIGHT } = require('./videoGenerator');
const { generateNarrationScript } = require('./narrationGenerator');
const { synthesizeSpeech } = require('./ttsGenerator');
const { generateKaraokeSubtitles } = require('./captionsGenerator');
const { generateCaption, generateHashtags } = require('./captionGenerator');
const { uploadVideo } = require('./cloudinary');
const { optimizePostTime } = require('./postTimeOptimizer');
const { publishReel } = require('./instagramPublisher');
const { publishToTelegram } = require('./telegramPublisher');

const ENABLE_KARAOKE_CAPTIONS = process.env.ENABLE_KARAOKE_CAPTIONS !== 'false';
const MUSIC_DIR = path.join(__dirname, '..', 'public', 'music');
const UPLOADS_DIR = path.join(__dirname, '..', 'public', 'uploads');
const VIDEOS_DIR = path.join(__dirname, '..', 'public', 'videos');

// public/music papkasidan tasodifiy musiqa tanlaydi (fayllar bo'lmasa, musiqasiz davom etadi)
function pickRandomMusic() {
  try {
    if (!fs.existsSync(MUSIC_DIR)) return null;
    const files = fs.readdirSync(MUSIC_DIR).filter((f) => f.toLowerCase().endsWith('.mp3'));
    if (files.length === 0) return null;
    const chosen = files[Math.floor(Math.random() * files.length)];
    return path.join(MUSIC_DIR, chosen);
  } catch (e) {
    console.log('🎵 Musiqa tanlashda xatolik:', e.message);
    return null;
  }
}

/**
 * Rasmlardan video yasaydi va (scheduledFor berilmasa) darhol
 * Instagram + Telegram'ga joylaydi, yoki (scheduledFor berilsa) keyinroq
 * joylash uchun navbatga qo'yadi.
 *
 * @param {string[]} imagePaths - diskdagi rasm fayllari yo'llari.
 *        DIQQAT: bu funksiya ishini tugatgach, shu fayllarni O'ZI O'CHIRIB
 *        TASHLAYDI (vaqtinchalik fayllar bo'lgani uchun).
 * @param {object} fields - { uyTuri, manzil, narx, qavat, xonalar, maydon, xususiyat }
 * @param {string|null} scheduledFor - ISO sana satri, yoki null/undefined (darhol joylash)
 * @returns {Promise<object>} - { id, caption, hashtags, videoUrl, status, igPostId?, telegramMessageId?, scheduledFor?, error? }
 */
async function createAndPublishListing(imagePaths, fields, scheduledFor) {
  const { uyTuri, manzil, narx, qavat, xonalar, maydon, xususiyat } = fields;

  const id = uuidv4();
  const videoFileName = `${id}.mp4`;
  const videoOutputPath = path.join(VIDEOS_DIR, videoFileName);
  const musicPath = pickRandomMusic();

  // Ovozli tavsif (AI narration) yaratish — xatolik bo'lsa ham dastur
  // to'xtamaydi, shunchaki ovozsiz (faqat musiqali) video yaratiladi.
  const narrationScript = generateNarrationScript({ uyTuri, manzil, narx, xonalar, maydon });
  const voiceOutputPath = path.join(UPLOADS_DIR, `${id}-voice.ogg`);
  let voicePath = null;
  try {
    voicePath = await synthesizeSpeech(narrationScript, voiceOutputPath);
  } catch (e) {
    console.log('🔊 Ovozli tavsif yaratishda kutilmagan xatolik:', e.message);
  }

  // Karaoke subtitr (.ass fayl)
  let captionsAssPath = null;
  if (ENABLE_KARAOKE_CAPTIONS) {
    const slideshowDuration = computeSlideshowDuration(imagePaths.length);
    captionsAssPath = path.join(UPLOADS_DIR, `${id}-captions.ass`);
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

      return {
        id, caption, hashtags, videoUrl,
        status: 'joylandi', igPostId, telegramMessageId
      };
    } catch (publishErr) {
      updateListing(id, { status: 'xato' });
      console.error(`❌ Darhol joylashda xatolik (${id}):`, publishErr.message);
      return {
        id, caption, hashtags, videoUrl,
        status: 'xato',
        error: `Joylashda xatolik: ${publishErr.message}`
      };
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

  return { id, caption, hashtags, videoUrl, scheduledFor: finalScheduledFor, status: 'kutilmoqda' };
}

module.exports = { createAndPublishListing, pickRandomMusic };
