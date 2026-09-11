// captionGenerator.js
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

// Katta auditoriyali (mashhur) — har doim qo'shiladi, lekin ko'pi bilan 2-3 tasi
const HASHTAGS_BROAD = [
  "#kochmasmulk", "#realestate", "#uy", "#toshkent", "#uzbekistan"
];

// O'rta auditoriyali — mulk turiga bog'liq
const HASHTAGS_MEDIUM = {
  "kvartira": ["#kvartirasotiladi", "#kvartira", "#kvartiratoshkent"],
  "hovli uy": ["#hovliuy", "#uysotiladi", "#hovliuytoshkent"],
  "ofis": ["#ofissotiladi", "#tijoratkochmasmulk", "#ofistoshkent"],
  "default": ["#uysotuv", "#mulk", "#uyijara"]
};

// Tor auditoriyali — hudud va narx toifasiga bog'liq, eng aniq auditoriyani topadi
function buildNicheHashtags(data) {
  const tags = [];
  if (data.manzil) {
    const first = data.manzil.split(',')[0].trim().toLowerCase().replace(/\s+/g, '');
    if (first) {
      tags.push('#' + first);
      tags.push('#' + first + 'kochmasmulk');
    }
  }
  if (data.xonalar) {
    tags.push(`#${data.xonalar}xonaliuy`);
  }
  return tags;
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// Massivdan tasodifiy N ta elementni (takrorlanmas) tanlaydi
function pickN(arr, n) {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

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

/**
 * Hashtaglarni 3 qatlamli strategiya bilan yasaydi:
 * - Keng qamrovli (broad): ko'p ko'rish, lekin yuqori raqobat
 * - O'rta (medium): mulk turiga mos, o'rtacha raqobat
 * - Tor (niche): hudud/xususiyatga xos, kam raqobat lekin aniq auditoriya
 * Bu aralashma Instagram algoritmida turli auditoriya segmentlariga chiqish imkonini beradi.
 */
function generateHashtags(data) {
  const uyTuriKey = (data.uyTuri || '').toLowerCase();
  const mediumPool = HASHTAGS_MEDIUM[uyTuriKey] || HASHTAGS_MEDIUM.default;

  const broad = pickN(HASHTAGS_BROAD, 3);        // 3 ta keng qamrovli
  const medium = pickN(mediumPool, 2);             // 2 ta o'rta
  const niche = buildNicheHashtags(data).slice(0, 4); // 4 tagacha tor

  const all = [...new Set([...broad, ...medium, ...niche])];
  return all.slice(0, 12); // Instagram tavsiyasi: 10-15 ta orasida optimal
}

module.exports = { generateCaption, generateHashtags };
