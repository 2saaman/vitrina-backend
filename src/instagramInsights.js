// instagramInsights.js
// Instagram'dagi haqiqiy obunachilar faolligini o'qib, eng samarali joylash
// soatlarini avtomatik aniqlaydigan modul.
//
// MUHIM CHEKLOV: Instagram "online_followers" statistikasi faqat yetarlicha
// obunachisi bor akkauntlar uchun ma'lumot qaytaradi (odatda kamida ~100).
// Shu sababli bu modul har doim "yetarli ma'lumot bormi?" tekshiruvidan
// boshlanadi va yetarli bo'lmasa graceful ravishda null qaytaradi — bunday
// holatda postTimeOptimizer.js standart (tadqiqotga asoslangan) oynalarga
// avtomatik qaytadi.

const axios = require('axios');

const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.instagram.com/${GRAPH_VERSION}`;
const TASHKENT_OFFSET_HOURS = 5;
const MIN_FOLLOWERS_FOR_INSIGHTS = 100;

// Xotirada saqlanadigan kesh — server qayta ishga tushganda tozalanadi,
// lekin scheduler uni muntazam yangilab turgani uchun bu muammo emas.
let cachedHourlyActivity = null; // { "0": 12, "1": 5, ... } — UTC soatlar bo'yicha
let lastFetchedAt = null;
let lastFollowersCount = null;
let lastError = null;

async function getFollowersCount({ igUserId, accessToken }) {
  const res = await axios.get(`${GRAPH_BASE}/${igUserId}`, {
    params: { fields: 'followers_count', access_token: accessToken }
  });
  return res.data.followers_count || 0;
}

/**
 * Instagram'dan obunachilarning soat bo'yicha onlayn faolligini so'raydi
 * va keshni yangilaydi. Muvaffaqiyatli bo'lsa qiymatlar obyektini,
 * bo'lmasa (yetarli obunachi yo'q yoki API xatosi) null qaytaradi.
 */
async function fetchOnlineFollowers({ igUserId, accessToken }) {
  try {
    const followers = await getFollowersCount({ igUserId, accessToken });
    lastFollowersCount = followers;

    if (followers < MIN_FOLLOWERS_FOR_INSIGHTS) {
      lastError = `Obunachilar soni (${followers}) yetarli emas — Instagram kamida ${MIN_FOLLOWERS_FOR_INSIGHTS} obunachi talab qiladi.`;
      console.log(`📊 Insights: ${lastError}`);
      return null;
    }

    const res = await axios.get(`${GRAPH_BASE}/${igUserId}/insights`, {
      params: { metric: 'online_followers', period: 'lifetime', access_token: accessToken }
    });

    const values = res.data?.data?.[0]?.values?.[0]?.value;
    if (!values || Object.keys(values).length === 0) {
      lastError = "Instagram online_followers ma'lumot qaytarmadi (bo'sh javob).";
      console.log(`📊 Insights: ${lastError}`);
      return null;
    }

    cachedHourlyActivity = values;
    lastFetchedAt = new Date();
    lastError = null;
    console.log('📊 Online followers ma\'lumoti yangilandi:', values);
    return values;
  } catch (err) {
    lastError = err.response?.data?.error?.message || err.message;
    console.log('📊 Insights olishda xatolik:', lastError);
    return null;
  }
}

/**
 * Toshkent vaqti bo'yicha eng faol soatlarni qaytaradi (kattadan kichikka).
 * Ma'lumot hali mavjud bo'lmasa (kesh bo'sh) — null qaytaradi.
 */
function getBestTashkentHours(topN = 4) {
  if (!cachedHourlyActivity) return null;

  const entries = Object.entries(cachedHourlyActivity).map(([utcHour, count]) => {
    const tashkentHour = (parseInt(utcHour, 10) + TASHKENT_OFFSET_HOURS) % 24;
    return { tashkentHour, count: Number(count) };
  });

  entries.sort((a, b) => b.count - a.count);
  return entries.slice(0, topN).map((e) => e.tashkentHour);
}

/**
 * Hozirgi holatni tekshirish uchun (masalan /api/insights-status endpoint'ida).
 */
function getInsightsStatus() {
  return {
    hasRealData: !!cachedHourlyActivity,
    followersCount: lastFollowersCount,
    minFollowersRequired: MIN_FOLLOWERS_FOR_INSIGHTS,
    lastFetchedAt,
    lastError
  };
}

module.exports = {
  fetchOnlineFollowers,
  getBestTashkentHours,
  getInsightsStatus,
  MIN_FOLLOWERS_FOR_INSIGHTS
};
