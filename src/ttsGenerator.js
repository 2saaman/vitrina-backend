// ttsGenerator.js
// Matnni Microsoft Edge TTS orqali BEPUL ovozga aylantiradi.
// Karta, API-key yoki ro'yxatdan o'tish SHART EMAS — bu Microsoft Edge
// brauzerining ochiq (hech kim uchun yopilmagan) ovozli o'qish xizmatidan
// foydalanadi. O'zbek (uz-UZ) va rus (ru-RU) tillari ikkalasi ham qo'llab-
// quvvatlanadi.

const { EdgeTTS } = require('edge-tts-universal');
const fs = require('fs');

// Matn tilini taxminan aniqlaydi: kirill harflar ko'p bo'lsa -> rus,
// lotin harflar ko'p bo'lsa -> o'zbek ovozi tanlanadi.
const RU_VOICE = process.env.EDGE_TTS_RU_VOICE || 'ru-RU-SvetlanaNeural';
const UZ_VOICE = process.env.EDGE_TTS_UZ_VOICE || 'uz-UZ-MadinaNeural';

function detectVoice(text) {
  const cyrillicCount = (text.match(/[\u0400-\u04FF]/g) || []).length;
  const latinCount = (text.match(/[A-Za-z']/g) || []).length;
  return cyrillicCount > latinCount ? RU_VOICE : UZ_VOICE;
}

/**
 * Matnni ovozga aylantiradi va faylga saqlaydi.
 * Xato yuz bersa (masalan tarmoq muammosi) — null qaytaradi, bu holda
 * video ovozli tavsifsiz, faqat fon musiqasi bilan yaratiladi.
 */
async function synthesizeSpeech(text, outputPath) {
  try {
    const voice = detectVoice(text);
    const tts = new EdgeTTS(text, voice);
    const result = await tts.synthesize();
    const buffer = Buffer.from(await result.audio.arrayBuffer());
    fs.writeFileSync(outputPath, buffer);
    console.log(`🔊 Ovozli tavsif yaratildi (${voice}):`, outputPath);
    return outputPath;
  } catch (err) {
    console.log('🔊 TTS xatosi, ovozsiz davom etiladi:', err.message);
    return null;
  }
}

module.exports = { synthesizeSpeech };
