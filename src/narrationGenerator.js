// narrationGenerator.js
// E'lon ma'lumotlaridan ovozli tavsif (narration) uchun QISQA matn yaratadi.
// MUHIM: bu to'liq caption emas — caption'da hashtag, telefon raqami, emoji
// kabi ovozga aylantirib bo'lmaydigan narsalar bor. Shuning uchun alohida,
// tabiiy eshitiladigan qisqa skript tuziladi (odatda 10-15 soniyalik video
// davomiyligiga mos keladigan uzunlikda).

function generateNarrationScript(data) {
  const { uyTuri, manzil, xonalar, narx, maydon } = data;
  const parts = [];

  parts.push('Yangi taklif.');
  if (uyTuri) parts.push(`${uyTuri} sotiladi.`);
  if (manzil) parts.push(`Manzil — ${manzil}.`);
  if (xonalar) parts.push(`${xonalar} xonali.`);
  if (maydon) parts.push(`Maydoni ${maydon}.`);
  if (narx) parts.push(`Narxi ${narx} dollar.`);
  parts.push("Batafsil ma'lumot uchun profildagi kontaktga yozing.");

  return parts.join(' ');
}

module.exports = { generateNarrationScript };
