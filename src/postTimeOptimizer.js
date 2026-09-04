// postTimeOptimizer.js
// Instagram'da e'lonni eng samarali vaqtda joylash uchun yordamchi modul.
// MUHIM: server UTC vaqtida ishlashi mumkin, shuning uchun barcha hisob-kitoblar
// aniq Toshkent vaqtiga (UTC+5, yil davomida o'zgarmaydi) asoslanadi —
// serverning o'z mahalliy vaqtidan mustaqil ishlaydi.

const TASHKENT_OFFSET_HOURS = 5;
const OFFSET_MS = TASHKENT_OFFSET_HOURS * 60 * 60 * 1000;

// Har bir hafta kuni uchun "yaxshi" soatlar oralig'i (Toshkent mahalliy vaqti)
// 0 = Yakshanba, 1 = Dushanba, ... 6 = Shanba
const OPTIMAL_WINDOWS = {
  0: [[12, 15]],
  1: [[12, 14], [18, 21]],
  2: [[12, 14], [18, 21]],
  3: [[12, 14], [18, 21]],
  4: [[9, 10], [12, 14], [18, 21]],
  5: [[12, 14], [16, 18]],
  6: [[11, 13], [17, 19]],
};

// Berilgan Date'dan Toshkent mahalliy soat/kun/sanasini xavfsiz oladi
// (serverning o'z vaqt zonasiga bog'liq bo'lmagan holda)
function getTashkentParts(date) {
  const shifted = new Date(date.getTime() + OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    hour: shifted.getUTCHours() + shifted.getUTCMinutes() / 60,
  };
}

// Toshkent mahalliy sana/soatidan haqiqiy UTC Date yaratadi
function buildDateFromTashkent(year, month, day, hour) {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  const utcMs = Date.UTC(year, month, day, h, m, 0, 0) - OFFSET_MS;
  return new Date(utcMs);
}

function isInOptimalWindow(date) {
  const { weekday, hour } = getTashkentParts(date);
  const windows = OPTIMAL_WINDOWS[weekday] || [];
  return windows.some(([start, end]) => hour >= start && hour < end);
}

function findNearestOptimalTime(date) {
  const { year, month, day, weekday, hour } = getTashkentParts(date);
  const windows = OPTIMAL_WINDOWS[weekday] || [];

  if (windows.length === 0) {
    return buildDateFromTashkent(year, month, day, 13);
  }

  let closestStart = null;
  let minDiff = Infinity;

  windows.forEach(([start, end]) => {
    if (hour >= start && hour < end) {
      closestStart = hour;
      minDiff = 0;
      return;
    }
    const diff = Math.min(Math.abs(hour - start), Math.abs(hour - end));
    if (diff < minDiff) {
      minDiff = diff;
      closestStart = start;
    }
  });

  return buildDateFromTashkent(year, month, day, closestStart);
}

/**
 * Asosiy funksiya: foydalanuvchi kiritgan vaqtni Toshkent vaqti bo'yicha tekshiradi,
 * agar u "yomon" oynaga tushsa — eng yaqin optimal vaqtga ko'chiradi.
 * @param {string|Date} requestedTime - foydalanuvchi kiritgan scheduledFor
 * @returns {{ optimizedTime: Date, wasAdjusted: boolean, originalTime: Date }}
 */
function optimizePostTime(requestedTime) {
  const original = new Date(requestedTime);

  if (isNaN(original.getTime())) {
    throw new Error('Noto\'g\'ri sana formati');
  }

  if (isInOptimalWindow(original)) {
    return { optimizedTime: original, wasAdjusted: false, originalTime: original };
  }

  const optimized = findNearestOptimalTime(original);
  return { optimizedTime: optimized, wasAdjusted: true, originalTime: original };
}

module.exports = { optimizePostTime, isInOptimalWindow, OPTIMAL_WINDOWS };
