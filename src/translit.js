// translit.js
// Kirill harflarini (o'zbek/rus) lotin harflariga o'giradi.
// Maqsad: (1) o'zbekcha ovoz kirill manzilni to'g'ri o'qishi uchun,
// (2) Instagram hashtag'lari lotin harflarida chiqishi uchun.

const MAP = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 's', ч: 'ch', ш: 'sh', щ: 'sh',
  ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya',
  ў: "o'", қ: 'q', ғ: "g'", ҳ: 'h'
};

function toLatin(text) {
  if (!text) return '';
  return String(text)
    .split('')
    .map((ch) => {
      const lower = ch.toLowerCase();
      if (!(lower in MAP)) return ch;
      const lat = MAP[lower];
      return ch === lower ? lat : lat.charAt(0).toUpperCase() + lat.slice(1);
    })
    .join('');
}

function hasCyrillic(text) {
  return /[\u0400-\u04FF]/.test(String(text || ''));
}

module.exports = { toLatin, hasCyrillic };
