const OPENERS = [
  "Diqqat! Ajoyib taklif 🏡",
  "Yangi e'lon — bu imkoniyatni qo'ldan boy bermang! ✨",
  "O'zingiz yoki oilangiz uchun mukammal tanlov 🔑",
  "Bugungi eng qiziqarli taklifimiz 👇"
];

const CTAS = [
  "Batafsil ma'lumot va ko'rish uchun profildagi kontaktga yozing 📩",
  "Qiziqsangiz, DM'ga yozing yoki qo'ng'iroq qiling ☎️",
  "Bugunoq ko'rib kelishga yoziling — imkoniyat cheklangan!",
  "Savollaringiz bo'lsa, xabar qoldiring, tez orada javob beramiz 💬"
];

const BASE_HASHTAGS = ["#kochmasmulk", "#uysotuv", "#toshkent", "#uyijara", "#mulk", "#realestate", "#uy", "#kvartira"];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function buildFeatureLine(data) {
  const parts = [];
  if (data.xonalar) parts.push(`🛏 ${data.xonalar} xonali`);
  if (data.maydon) parts.push(`📐 ${data.maydon} m²`);
  if (data.qavat) parts.push(`🏢 ${data.qavat}-qavat`);
  if (data.narx) parts.push(`💰 ${data.narx}`);
  return parts.join('  ·  ');
}

function generateCaption(data) {
  const opener = pick(OPENERS);
  const cta = pick(CTAS);
  const featureLine = buildFeatureLine(data);
  const manzilLine = data.manzil ? `📍 ${data.manzil}` : '';
  const xususiyatLine = data.xususiyat ? `\n${data.xususiyat}` : '';

  const caption = [
    opener,
    '',
    `${data.uyTuri || 'Mulk'} sotiladi`,
    manzilLine,
    featureLine,
    xususiyatLine,
    '',
    cta
  ].filter(Boolean).join('\n');

  return caption;
}

function generateHashtags(data) {
  const tags = new Set(BASE_HASHTAGS);
  if (data.uyTuri) {
    const t = data.uyTuri.toLowerCase().replace(/\s+/g, '');
    tags.add('#' + t);
  }
  if (data.manzil) {
    const first = data.manzil.split(',')[0].trim().toLowerCase().replace(/\s+/g, '');
    if (first) tags.add('#' + first);
  }
  return Array.from(tags).slice(0, 12);
}

module.exports = { generateCaption, generateHashtags };
