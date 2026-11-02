// captionGenerator.js
// Instagram/Telegram uchun post matni (caption) va hashtag'lar yaratadi.

const { toLatin } = require('./translit');

const MAX_XUSUSIYAT_CHARS = 350;

// "265000" -> "265 000$"; allaqachon valyutali bo'lsa, tegmaydi
function formatPrice(narx) {
  if (!narx) return '';
  const s = String(narx).trim();
  if (/[$a-zA-Zа-яА-Я]/.test(s)) return s;
  const digits = s.replace(/\D/g, '');
  if (!digits) return s;
  return `${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}$`;
}

// "250 m²" bo'lsa, "m²" ni qayta qo'shmaydi
function formatArea(maydon) {
  if (!maydon) return '';
  const s = String(maydon).trim();
  if (/m²|m2|м²|м2|sotix|сот/i.test(s)) return s;
  return `${s} m²`;
}

// Telefon raqamlarini olib tashlaydi, ortiqcha bo'shliqlarni tozalaydi
function cleanText(text) {
  return String(text || '')
    .replace(/\+?\d[\d\s\-()]{7,}\d/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function generateCaption(data) {
  const { uyTuri, manzil, narx, qavat, xonalar, maydon, xususiyat } = data;
  const lines = [];

  lines.push('Bugungi eng qiziqarli taklifimiz 👇');
  if (uyTuri) lines.push(`${toLatin(uyTuri)} sotiladi`);
  if (manzil) lines.push(`📍 ${manzil}`);

  const facts = [];
  if (xonalar) facts.push(`🛏 ${xonalar} xonali`);
  if (maydon) facts.push(`📐 ${formatArea(maydon)}`);
  if (qavat) facts.push(`🏢 ${qavat}-qavat`);
  if (narx) facts.push(`💰 ${formatPrice(narx)}`);
  if (facts.length) lines.push(facts.join(' · '));

  const extra = cleanText(xususiyat).slice(0, MAX_XUSUSIYAT_CHARS);
  if (extra) lines.push('', extra);

  lines.push('', "Bugunoq ko'rib kelishga yoziling — imkoniyat cheklangan!");
  return lines.join('\n');
}

// Manzildan tuman nomini lotin harfida, qisqa hashtag qilib oladi
// ("Юнусобод тумани Обод махалла" -> "yunusobod")
function districtTag(manzil) {
  if (!manzil) return null;
  const first = toLatin(String(manzil)).trim().split(/[\s,]+/)[0] || '';
  const clean = first.toLowerCase().replace(/[^a-z0-9]/g, '');
  return clean.length >= 4 && clean.length <= 20 ? `#${clean}` : null;
}

function generateHashtags(data) {
  const { uyTuri, manzil, xonalar } = data;
  const tags = ['#kochmasmulk', '#realestate', '#uzbekistan', '#toshkent'];

  const type = toLatin(uyTuri || '').toLowerCase().replace(/[^a-z]/g, '');
  if (type) tags.push(`#${type}sotiladi`);

  const district = districtTag(manzil);
  if (district) tags.push(district);

  const rooms = String(xonalar || '').match(/\d+/);
  if (rooms) tags.push(`#${rooms[0]}xonali`);

  return Array.from(new Set(tags));
}

module.exports = { generateCaption, generateHashtags };
