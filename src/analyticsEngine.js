// analyticsEngine.js
// Instagram postlar statistikasini yig'ib, optimal joylash vaqtini
// shaxsiy ma'lumotlar asosida hisoblaydigan modul.
// MUHIM: bu modul IG_USER_ID va IG_ACCESS_TOKEN muhit o'zgaruvchilari
// mavjud bo'lganda ishlaydi. Ular hali sozlanmagan bo'lsa, funksiyalar
// xato qaytarmaydi — shunchaki "ma'lumot yo'q" holatini qaytaradi va
// tizim avtomatik ravishda postTimeOptimizer.js dagi statik jadvalni
// ishlatishda davom etadi.

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const GRAPH_VERSION = 'v20.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const STATS_FILE = path.join(__dirname, '..', 'data', 'post_stats.json');

// Kamida shuncha post to'planmaguncha statik jadval ishlatiladi
const MIN_POSTS_FOR_PERSONAL_DATA = 15;

function isConfigured() {
  return !!(process.env.IG_USER_ID && process.env.IG_ACCESS_TOKEN);
}

function loadStats() {
  try {
    if (!fs.existsSync(STATS_FILE)) return [];
    return JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
  } catch (e) {
    console.log('📊 Statistika faylini o\'qishda xatolik:', e.message);
    return [];
  }
}

function saveStats(stats) {
  try {
    fs.mkdirSync(path.dirname(STATS_FILE), { recursive: true });
    fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
  } catch (e) {
    console.log('📊 Statistika faylini yozishda xatolik:', e.message);
  }
}

/**
 * Instagram'dan bitta post uchun insights (reach, engagement, saved) oladi.
 * Token yo'q bo'lsa yoki xato bo'lsa, null qaytaradi (tizim yiqilmaydi).
 */
async function fetchPostInsights(igMediaId) {
  if (!isConfigured()) return null;
  try {
    const res = await axios.get(`${GRAPH_BASE}/${igMediaId}/insights`, {
      params: {
        metric: 'reach,saved,likes,comments',
        access_token: process.env.IG_ACCESS_TOKEN
      }
    });
    const metrics = {};
    (res.data.data || []).forEach((m) => {
      metrics[m.name] = m.values?.[0]?.value ?? 0;
    });
    return metrics;
  } catch (e) {
    console.log(`📊 ${igMediaId} uchun insights olishda xatolik:`, e.message);
    return null;
  }
}

/**
 * Joylangan postning natijasini mahalliy faylga saqlaydi.
 * postedAt — ISO sana, igMediaId — Instagram media ID.
 */
async function recordPostResult(igMediaId, postedAt) {
  const insights = await fetchPostInsights(igMediaId);
  if (!insights) return;

  const date = new Date(postedAt);
  const entry = {
    igMediaId,
    postedAt,
    weekday: date.getDay(),
    hour: date.getHours(),
    reach: insights.reach || 0,
    saved: insights.saved || 0,
    likes: insights.likes || 0,
    comments: insights.comments || 0,
    // Umumiy "engagement score" — reach ga nisbatan qiziqish darajasi
    engagementScore: (insights.saved || 0) * 3 + (insights.likes || 0) + (insights.comments || 0) * 2
  };

  const stats = loadStats();
  stats.push(entry);
  saveStats(stats);
  console.log(`📊 Post statistikasi saqlandi: ${igMediaId}, reach=${entry.reach}, engagement=${entry.engagementScore}`);
}

/**
 * To'plangan ma'lumotlar asosida har hafta kuni uchun eng yaxshi soatlarni hisoblaydi.
 * Yetarli ma'lumot bo'lmasa, null qaytaradi (statik jadval ishlatilaveradi).
 * @returns {Object|null} postTimeOptimizer.js dagi OPTIMAL_WINDOWS formatida
 */
function computePersonalizedWindows() {
  const stats = loadStats();
  if (stats.length < MIN_POSTS_FOR_PERSONAL_DATA) {
    console.log(`📊 Shaxsiy analitika uchun yetarli ma'lumot yo'q (${stats.length}/${MIN_POSTS_FOR_PERSONAL_DATA})`);
    return null;
  }

  // Har bir kun-soat kombinatsiyasi uchun o'rtacha engagement hisoblanadi
  const buckets = {}; // { "3-18": [scores] }
  stats.forEach((s) => {
    const key = `${s.weekday}-${s.hour}`;
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(s.engagementScore);
  });

  const avgByBucket = Object.entries(buckets).map(([key, scores]) => {
    const [weekday, hour] = key.split('-').map(Number);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    return { weekday, hour, avg, count: scores.length };
  });

  // Har bir kun uchun eng yaxshi 2 ta soatni tanlaymiz
  const windows = {};
  for (let day = 0; day <= 6; day++) {
    const dayBuckets = avgByBucket
      .filter((b) => b.weekday === day)
      .sort((a, b) => b.avg - a.avg)
      .slice(0, 2);

    if (dayBuckets.length > 0) {
      windows[day] = dayBuckets.map((b) => [b.hour, b.hour + 2]);
    }
  }

  return Object.keys(windows).length > 0 ? windows : null;
}

/**
 * Tayyor holat: qancha post to'plangani va shaxsiy analitika hali
 * faollashmaganini tekshirish uchun.
 */
function getAnalyticsStatus() {
  const stats = loadStats();
  return {
    configured: isConfigured(),
    postsRecorded: stats.length,
    minRequired: MIN_POSTS_FOR_PERSONAL_DATA,
    personalizedDataReady: stats.length >= MIN_POSTS_FOR_PERSONAL_DATA
  };
}

module.exports = {
  recordPostResult,
  computePersonalizedWindows,
  getAnalyticsStatus,
  isConfigured
};
