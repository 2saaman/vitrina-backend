// telegramBot.js
// Telegram orqali "bot"ga rasm + matn yuborib, avtomatik video yasab,
// Instagram va Telegram kanalga joylaydigan tizim.
//
// QANDAY ISHLATISH:
//   1. Botga 1-5 ta rasmni albom qilib yuboring (rasm yoki "fayl" ko'rinishida
//      — ikkalasi ham qabul qilinadi).
//   2. Rasmning izoh (caption) qismiga e'lon matnini yozing. Ikki xil
//      ko'rinish qabul qilinadi:
//
//      A) SHABLON:
//         Uy turi: Kvartira
//         Manzil: Chilonzor tumani
//         Narx: 45000
//         Qavat: 3
//         Xonalar: 2
//         Maydon: 60 m²
//         Xususiyat: Yevroremont, mebel bilan
//
//      B) ERKIN MATN (masalan boshqa kanaldan nusxalangan e'lon):
//         📍 Юнусобод тумани Обод махалла
//         - 1.8 соток 250 m2
//         - 6 хона
//         💵 265.000$
//         Bot manzil, narx, xona, maydonni matndan o'zi ajratib oladi
//         (taxminiy — natijani tekshirib turing).
//
//   3. Bot video yasaydi, Instagram + Telegram kanalga joylaydi va natijani
//      sizga yozadi.
//
// XAVFSIZLIK: faqat ADMIN_TELEGRAM_ID dagi foydalanuvchi xabarlari qabul qilinadi.

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const { v4: uuidv4 } = require('uuid');
const { createAndPublishListing } = require('./listingPipeline');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_TELEGRAM_ID ? String(process.env.ADMIN_TELEGRAM_ID).trim() : null;
const UPLOADS_DIR = path.join(__dirname, '..', 'public', 'uploads');

// Albomdagi oxirgi rasm kelgandan keyin shuncha kutamiz (millisekund)
const MEDIA_GROUP_WAIT_MS = 2500;

const FIELD_ALIASES = {
  uyTuri: ['uy turi', 'uyturi', 'tur', 'turi'],
  manzil: ['manzil', 'joylashuv', 'joyi'],
  narx: ['narx', 'narxi', 'bahosi', 'baho'],
  qavat: ['qavat', 'qavati'],
  xonalar: ['xona', 'xonalar', 'xonasi'],
  maydon: ['maydon', 'maydoni', 'kvadrat'],
  xususiyat: ['xususiyat', 'izoh', 'qoshimcha', "qo'shimcha"]
};

const REQUIRED_FIELDS = ['uyTuri', 'manzil', 'narx', 'xonalar'];

const TEMPLATE_TEXT = `Rasmlar bilan birga (caption qismiga) quyidagi shablon asosida matn yozib yuboring:

Uy turi: Kvartira
Manzil: Chilonzor tumani
Narx: 45000
Qavat: 3
Xonalar: 2
Maydon: 60 m²
Xususiyat: Yevroremont, mebel bilan

("Uy turi", "Manzil", "Narx" va "Xonalar" — majburiy, qolganlari ixtiyoriy.)

Yoki oddiy e'lon matnini yozing (📍 manzil, "6 хона", "250 m2", "265.000$" kabi) — bot o'zi ajratib oladi.`;

// ---------- 1) SHABLON bo'yicha o'qish ----------
function parseTemplateCaption(caption) {
  const fields = {};
  if (!caption) return fields;
  String(caption).split('\n').forEach((line) => {
    const idx = line.indexOf(':');
    if (idx === -1) return;
    const label = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (!value) return;
    for (const [key, aliases] of Object.entries(FIELD_ALIASES)) {
      if (aliases.includes(label)) {
        fields[key] = value;
        break;
      }
    }
  });
  return fields;
}

// ---------- 2) ERKIN MATNdan taxminiy ajratib olish ----------
function stripEmoji(s) {
  return String(s)
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .trim();
}

function parseFreeText(text) {
  const fields = {};
  if (!text) return fields;
  const lines = String(text).split('\n').map((l) => l.trim());

  // NARX: $ yoki 💵/💰 bor qator
  const priceLine = lines.find((l) => /[$]|usd|dollar|💵|💰/i.test(l));
  if (priceLine) {
    const digits = priceLine.replace(/\D/g, '');
    if (digits.length >= 4) fields.narx = digits;
  }

  // XONALAR: "6 хона", "3 xona", "2 комнат"
  const roomMatch = text.match(/(\d+)\s*(?:та\s*)?(?:хона|xona|комнат|ta\s*xona)/i);
  if (roomMatch) fields.xonalar = roomMatch[1];

  // MAYDON: "250 m2", "60 м²" va/yoki "1.8 соток"
  const areaMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(?:m2|м2|m²|м²|kv\.?\s*m|кв\.?\s*м)/i);
  const sotMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(?:сотк\S*|соток|sotix|sotih|sotka)/i);
  const areaParts = [];
  if (sotMatch) areaParts.push(`${sotMatch[1]} sotix`);
  if (areaMatch) areaParts.push(`${areaMatch[1]} m²`);
  if (areaParts.length) fields.maydon = areaParts.join(', ');

  // QAVAT
  const floorMatch = text.match(/(\d+)\s*[- ]?\s*(?:qavat|этаж|qavatli)/i);
  if (floorMatch) fields.qavat = floorMatch[1];

  // MANZIL: 📍 qatori (+ undan keyingi "-" bilan boshlanmaydigan qatorlar)
  const pinIdx = lines.findIndex((l) => l.includes('📍'));
  if (pinIdx !== -1) {
    const addrParts = [stripEmoji(lines[pinIdx])];
    for (let i = pinIdx + 1; i < lines.length; i++) {
      if (!lines[i] || /^[-•–]/.test(lines[i]) || /[$💵💰📞☎]/.test(lines[i])) break;
      addrParts.push(stripEmoji(lines[i]));
    }
    fields.manzil = addrParts.filter(Boolean).join(', ');
  }

  // UY TURI
  if (/квартир|kvartira/i.test(text)) fields.uyTuri = 'Kvartira';
  else if (/соток|сотих|sotix|ховли|hovli|дом\b|участок/i.test(text)) fields.uyTuri = 'Hovli uy';
  else fields.uyTuri = 'Uy';

  // XUSUSIYAT: "-" bilan boshlangan qatorlar
  const bullets = lines
    .filter((l) => /^[-•–]/.test(l))
    .map((l) => l.replace(/^[-•–]\s*/, ''));
  if (bullets.length) fields.xususiyat = bullets.join(', ');

  return fields;
}

// Avval shablon, yetishmagan maydonlarni erkin matndan to'ldiramiz
function parseCaption(caption) {
  const template = parseTemplateCaption(caption);
  const free = parseFreeText(caption);
  const merged = { ...free, ...template }; // shablon ustuvor
  return merged;
}

function findMissingFields(fields) {
  return REQUIRED_FIELDS.filter((k) => !fields[k] || !String(fields[k]).trim());
}

function extFromMime(mime) {
  if (!mime) return '.jpg';
  if (mime.includes('png')) return '.png';
  if (mime.includes('webp')) return '.webp';
  return '.jpg';
}

function startTelegramBot() {
  if (!BOT_TOKEN) {
    console.log('🤖 TELEGRAM_BOT_TOKEN topilmadi — Telegram bot ishga tushirilmadi.');
    return;
  }
  if (!ADMIN_ID) {
    console.log('🤖 ADMIN_TELEGRAM_ID sozlanmagan — Telegram bot ishga tushirilmadi.');
    return;
  }

  const bot = new TelegramBot(BOT_TOKEN, { polling: true });
  console.log('🤖 Telegram bot ishga tushdi, admin xabarlarini kutyapti...');

  bot.on('polling_error', (err) => {
    console.log('🤖 Telegram bot polling xatosi:', err.message);
  });

  // media_group_id -> { photos: [{fileId, ext}], caption, chatId, timer }
  const pendingGroups = new Map();

  async function downloadPhoto(fileId, destPath) {
    const link = await bot.getFileLink(fileId);
    const response = await axios.get(link, { responseType: 'arraybuffer', timeout: 30000 });
    fs.writeFileSync(destPath, response.data);
    return destPath;
  }

  async function processSubmission(chatId, photos, caption) {
    const fields = parseCaption(caption);
    const missing = findMissingFields(fields);

    if (missing.length > 0) {
      await bot.sendMessage(chatId,
        `❌ Matndan quyidagilarni aniqlay olmadim: ${missing.join(', ')}\n\n${TEMPLATE_TEXT}`);
      return;
    }
    if (!photos || photos.length === 0) {
      await bot.sendMessage(chatId, '❌ Kamida bitta rasm kerak.');
      return;
    }

    // Instagram uchun ko'pi bilan 5 ta rasm
    const usedPhotos = photos.slice(0, 5);

    const summary =
      `📋 Aniqlangan ma'lumot:\n` +
      `Uy turi: ${fields.uyTuri}\nManzil: ${fields.manzil}\nNarx: ${fields.narx}\nXonalar: ${fields.xonalar}` +
      (fields.maydon ? `\nMaydon: ${fields.maydon}` : '') +
      (fields.qavat ? `\nQavat: ${fields.qavat}` : '') +
      (fields.xususiyat ? `\nXususiyat: ${fields.xususiyat}` : '');
    await bot.sendMessage(chatId,
      `${summary}\n\n⏳ Video yasalmoqda... (${usedPhotos.length} ta rasm) — 1-2 daqiqa kutishingiz mumkin.`);

    const batchId = uuidv4();
    const imagePaths = [];
    try {
      for (let i = 0; i < usedPhotos.length; i++) {
        const destPath = path.join(UPLOADS_DIR, `${batchId}-${i}${usedPhotos[i].ext}`);
        await downloadPhoto(usedPhotos[i].fileId, destPath);
        imagePaths.push(destPath);
      }
    } catch (e) {
      console.log('🤖 Rasmlarni yuklab olishda xatolik:', e.message);
      imagePaths.forEach((p) => fs.unlink(p, () => {}));
      await bot.sendMessage(chatId, `❌ Rasmlarni yuklab olishda xatolik: ${e.message}`);
      return;
    }

    try {
      const result = await createAndPublishListing(imagePaths, fields, null);
      if (result.status === 'joylandi') {
        let msg = `✅ Video tayyor va joylandi!\n\n📸 Instagram post: ${result.igPostId}`;
        if (result.telegramMessageId) {
          msg += `\n📨 Telegram kanalga ham joylandi (xabar #${result.telegramMessageId})`;
        }
        msg += `\n\n🎬 Video: ${result.videoUrl}`;
        await bot.sendMessage(chatId, msg);
      } else {
        await bot.sendMessage(chatId,
          `❌ Joylashda xatolik: ${result.error}\n\n🎬 Video baribir tayyor bo'ldi: ${result.videoUrl}`);
      }
    } catch (e) {
      console.log('🤖 Pipeline xatosi:', e.message);
      await bot.sendMessage(chatId, `❌ Video yasashda xatolik: ${e.message}`);
    }
  }

  bot.on('message', async (msg) => {
    try {
      const chatId = msg.chat.id;

      if (!msg.from || String(msg.from.id) !== ADMIN_ID) {
        return;
      }

      if (msg.text === '/start') {
        await bot.sendMessage(chatId,
          `👋 Salom! Men e'lon videosini avtomatik yasab, Instagram va Telegram kanalga joylayman.\n\n${TEMPLATE_TEXT}`);
        return;
      }

      // Rasm: oddiy "photo" yoki "fayl" (document) ko'rinishida
      let photo = null;
      if (msg.photo && msg.photo.length) {
        photo = { fileId: msg.photo[msg.photo.length - 1].file_id, ext: '.jpg' };
      } else if (msg.document && msg.document.mime_type && msg.document.mime_type.startsWith('image/')) {
        photo = { fileId: msg.document.file_id, ext: extFromMime(msg.document.mime_type) };
      }

      if (!photo) {
        // Admin matn yozdi, lekin rasm yo'q — yo'l-yo'riq beramiz
        await bot.sendMessage(chatId,
          `Rasm topilmadi. Rasmlarni matn bilan birga (caption qismida) yuboring.\n\n${TEMPLATE_TEXT}`);
        return;
      }

      const caption = msg.caption || '';
      const groupId = msg.media_group_id;

      if (!groupId) {
        await processSubmission(chatId, [photo], caption);
        return;
      }

      if (!pendingGroups.has(groupId)) {
        pendingGroups.set(groupId, { photos: [], caption: '', chatId });
      }
      const group = pendingGroups.get(groupId);
      group.photos.push(photo);
      if (caption) group.caption = caption;

      if (group.timer) clearTimeout(group.timer);
      group.timer = setTimeout(() => {
        pendingGroups.delete(groupId);
        processSubmission(group.chatId, group.photos, group.caption);
      }, MEDIA_GROUP_WAIT_MS);
    } catch (e) {
      console.log('🤖 Xabarni qayta ishlashda kutilmagan xatolik:', e.message);
    }
  });
}

module.exports = { startTelegramBot, parseCaption };
