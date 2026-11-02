// narrationGenerator.js
// E'lon ma'lumotlaridan ovozli tavsif (narration) uchun matn yaratadi.
// Kirill harfida kelgan manzil/tavsif lotinga o'giriladi — shunda o'zbekcha
// ovoz ularni to'g'ri o'qiydi (ruscha ovozga o'tib ketmaydi).

const { toLatin } = require('./translit');

const MAX_XUSUSIYAT_CHARS = 220; // batafsil tavsifdan qancha belgi olinadi

// Telefon raqami, emoji va ortiqcha belgilarni olib tashlaydi
function cleanForSpeech(text) {
  if (!text) return '';
  return String(text)
    .replace(/\+?\d[\d\s\-()]{7,}\d/g, '')                      // telefon raqamlari
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')    // emoji
    .replace(/[\r\n]+/g, '. ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\.\s*\./g, '.')
    .trim();
}

function generateNarrationScript(data) {
  const { uyTuri, manzil, xonalar, narx, maydon, xususiyat } = data;
  const parts = [];

  parts.push('Yangi taklif.');
  if (uyTuri) parts.push(`${toLatin(uyTuri)} sotiladi.`);
  if (manzil) parts.push(`Manzil — ${toLatin(manzil)}.`);
  if (xonalar) parts.push(`${xonalar} xonali.`);
  if (maydon) parts.push(`Maydoni ${toLatin(maydon)}.`);

  const cleanedXususiyat = toLatin(cleanForSpeech(xususiyat)).slice(0, MAX_XUSUSIYAT_CHARS);
  if (cleanedXususiyat) {
    parts.push(/[.!?]$/.test(cleanedXususiyat) ? cleanedXususiyat : `${cleanedXususiyat}.`);
  }

  if (narx) parts.push(`Narxi ${String(narx).replace(/\D/g, '') || narx} dollar.`);
  parts.push("Batafsil ma'lumot uchun profildagi kontaktga yozing.");

  return parts.join(' ');
}

module.exports = { generateNarrationScript };
