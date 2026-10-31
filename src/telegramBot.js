// telegramBot.js
// Telegram orqali "bot"ga rasm + matn yuborib, avtomatik video yasab,
// Instagram va Telegram kanalga joylaydigan tizim.
//
// QANDAY ISHLATISH (botga yozadigan administrator uchun):
//   1. Botga Telegram'da shaxsiy xabar oching (agar hali ochmagan bo'lsangiz,
//      botning username'ini qidirib, "Start" tugmasini bosing).
//   2. 1 dan 5 tagacha rasmni BIRGALIKDA (albom sifatida) tanlab yuboring.
//   3. Rasmlarni yuborishdan oldin (yoki rasmlar bilan birga, "caption"
//      qismiga) quyidagi shablon asosida matn yozing:
//
//      Uy turi: Kvartira
//      Manzil: Chilonzor tumani
//      Narx: 45000
//      Qavat: 3
//      Xonalar: 2
//      Maydon: 60 m²
//      Xususiyat: Yevroremont, mebel bilan
//
//      ("Uy turi", "Manzil", "Narx", "Xonalar" — MAJBURIY. Qolganlari ixtiyoriy.)
//
//   4. Bot avtomatik video yasaydi, Instagram + Telegram kanalga joylaydi,
//      va natijani (muvaffaqiyat yoki xatolik) sizga qaytarib yozadi.
//
// XAVFSIZLIK: faqat Render'dagi ADMIN_TELEGRAM_ID o'zgaruvchisida
// ko'rsatilgan Telegram foydalanuvchisidan kelgan xabarlar qabul qilinadi.
// Boshqa hech kim (hatto bot linkini bilsa ham) undan foydalana olmaydi.

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const { v4: uuidv4 } = require('uuid');
const { createAndPublishListing } = require('./listingPipeline');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_TELEGRAM_ID ? String(process.env.ADMIN_TELEGRAM_ID).trim() : null;
const UPLOADS_DIR = path.join(__dirname, '..', 'public', 'uploads');

// Bir nechta rasm "albom" sifatida yuborilganda, Telegram ularni alohida-
// alohida xabar qilib yuboradi (bir xil media_group_id bilan). Shuning
// uchun oxirgi rasm kelganidan keyin shuncha millisekund kutamiz — agar
// shu vaqt ichida yana rasm kelmasa, albom "tugadi" deb hisoblaymiz.
const MEDIA_GROUP_WAIT_MS = 2500;

// Caption matnidagi qatorlarni (masalan "Manzil: Chilonzor") qaysi
// maydonga tegishli ekanini aniqlash uchun kalit so'zlar (kichik harfda)
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

("Uy turi", "Manzil", "Narx" va "Xonalar" — majburiy, qolganlari ixtiyoriy.)`;

function parseCaption(caption) {
  const fields = {};
  if (!caption) return fields;
  const lines = String(caption).split('\n');
  lines.forEach((line) => {
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

function findMissingFields(fields) {
  return REQUIRED_FIELDS.filter((k) => !fields[k] || !String(fields[k]).trim());
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

  // media_group_id bo'yicha kelayotgan rasmlarni vaqtinchalik yig'ish
  // Map: media_group_id -> { photos: [fileId...], caption, chatId, timer }
  const pendingGroups = new Map();

  async function downloadPhoto(fileId, destPath) {
    const link = await bot.getFileLink(fileId);
    const response = await axios.get(link, { responseType: 'arraybuffer', timeout: 30000 });
    fs.writeFileSync(destPath, response.data);
    return destPath;
  }

  async function processSubmission(chatId, photoFileIds, caption) {
    const fields = parseCaption(caption);
    const missing = findMissingFields(fields);

    if (missing.length > 0) {
      await bot.sendMessage(chatId,
        `❌ Quyidagi maydonlar yetishmayapti: ${missing.join(', ')}\n\n${TEMPLATE_TEXT}`);
      return;
    }
    if (!photoFileIds || photoFileIds.length === 0) {
      await bot.sendMessage(chatId, '❌ Kamida bitta rasm kerak.');
      return;
    }

    await bot.sendMessage(chatId,
      `⏳ Video yasalmoqda... (${photoFileIds.length} ta rasm) — 1-2 daqiqa kutishingiz mumkin.`);

    const batchId = uuidv4();
    const imagePaths = [];
    try {
      for (let i = 0; i < photoFileIds.length; i++) {
        const destPath = path.join(UPLOADS_DIR, `${batchId}-${i}.jpg`);
        await downloadPhoto(photoFileIds[i], destPath);
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

      // Faqat ADMIN_TELEGRAM_ID'dagi foydalanuvchidan kelgan xabarlar qabul qilinadi
      if (!msg.from || String(msg.from.id) !== ADMIN_ID) {
        return;
      }

      if (msg.text === '/start') {
        await bot.sendMessage(chatId,
          `👋 Salom! Men e'lon videosini avtomatik yasab, Instagram va Telegram kanalga joylayman.\n\n${TEMPLATE_TEXT}`);
        return;
      }

      if (!msg.photo) return;

      // Telegram bir nechta o'lchamda yuboradi — eng kattasini olamiz
      const fileId = msg.photo[msg.photo.length - 1].file_id;
      const caption = msg.caption || '';
      const groupId = msg.media_group_id;

      if (!groupId) {
        // Yagona rasm (albom emas) — darhol qayta ishlanadi
        await processSubmission(chatId, [fileId], caption);
        return;
      }

      // Albomga tegishli rasm — navbatga qo'shamiz va kutamiz
      if (!pendingGroups.has(groupId)) {
        pendingGroups.set(groupId, { photos: [], caption: '', chatId });
      }
      const group = pendingGroups.get(groupId);
      group.photos.push(fileId);
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

module.exports = { startTelegramBot };
