// ttsGenerator.js
// Matnni ovozga aylantiradi. Ikki bosqichli tizim:
//   1) ELEVENLABS_API_KEY sozlangan bo'lsa — ElevenLabs (yuqori sifat,
//      ko'p tilli model) ishlatiladi.
//   2) Aks holda, yoki ElevenLabs xato bersa (masalan oylik limit tugasa) —
//      avtomatik ravishda BEPUL Edge TTS'ga qaytiladi.
//
// MUHIM TUZATISH: ilgari Edge TTS chaqiruvida VAQT CHEGARASI (timeout)
// yo'q edi — agar Microsoft'ning xizmati javob bermay qolsa, butun so'rov
// ABADIY osilib qolardi (server esa bitta ishchi oqimda ishlagani uchun
// boshqa hamma so'rovlar ham to'xtab qolardi). Endi HAR BIR usul uchun
// vaqt chegarasi qo'yilgan: agar shu vaqt ichida javob kelmasa, xato
// sifatida qaraladi va keyingi variantga (yoki ovozsiz video yaratishga)
// o'tiladi — server hech qachon abadiy osilib qolmaydi.

const axios = require('axios');
const fs = require('fs');
const { EdgeTTS } = require('edge-tts-universal');

const ELEVEN_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVEN_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'; // "Rachel" — standart ko'p tilli ovoz
const ELEVEN_MODEL = 'eleven_multilingual_v2';

const RU_VOICE = process.env.EDGE_TTS_RU_VOICE || 'ru-RU-SvetlanaNeural';
const UZ_VOICE = process.env.EDGE_TTS_UZ_VOICE || 'uz-UZ-MadinaNeural';

// Har bir TTS usuli uchun maksimal kutish vaqti (millisekund)
const ELEVENLABS_TIMEOUT_MS = 15000; // 15 soniya
const EDGE_TTS_TIMEOUT_MS = 20000;   // 20 soniya

function detectEdgeVoice(text) {
  const cyrillicCount = (text.match(/[\u0400-\u04FF]/g) || []).length;
  const latinCount = (text.match(/[A-Za-z']/g) || []).length;
  return cyrillicCount > latinCount ? RU_VOICE : UZ_VOICE;
}

// Har qanday Promise'ni berilgan vaqt ichida bajarilishga majbur qiladi.
// Agar shu vaqt ichida natija kelmasa — xato tashlaydi (lekin dastur
// osilib qolmaydi, chunki Promise.race birinchi hal bo'lgan natijani oladi).
function withTimeout(promise, ms, label) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label}: vaqt chegarasi (${ms}ms) tugadi`));
    }, ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

async function synthesizeWithElevenLabs(text, outputPath) {
  const response = await axios.post(
    `https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE_ID}`,
    {
      text,
      model_id: ELEVEN_MODEL,
      voice_settings: { stability: 0.4, similarity_boost: 0.8 }
    },
    {
      headers: {
        'xi-api-key': ELEVEN_API_KEY,
        'Content-Type': 'application/json'
      },
      responseType: 'arraybuffer',
      timeout: ELEVENLABS_TIMEOUT_MS
    }
  );
  fs.writeFileSync(outputPath, response.data);
  console.log('🔊 Ovozli tavsif yaratildi (ElevenLabs):', outputPath);
  return outputPath;
}

async function synthesizeWithEdgeTTS(text, outputPath) {
  const voice = detectEdgeVoice(text);
  const tts = new EdgeTTS(text, voice);
  const result = await withTimeout(tts.synthesize(), EDGE_TTS_TIMEOUT_MS, 'Edge TTS');
  const buffer = Buffer.from(await result.audio.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
  console.log(`🔊 Ovozli tavsif yaratildi (Edge TTS, ${voice}):`, outputPath);
  return outputPath;
}

/**
 * Matnni ovozga aylantiradi va faylga saqlaydi.
 * Xato yuz bersa (ikkala usul ham ishlamasa yoki vaqt chegarasi tugasa) —
 * null qaytaradi, bu holda video ovozli tavsifsiz, faqat fon musiqasi
 * bilan yaratiladi. Bu funksiya HECH QACHON abadiy osilib qolmaydi —
 * eng yomon holatda ~35 soniyada (ElevenLabs 15s + Edge TTS 20s) xato
 * bilan tugaydi va video yaratish davom etadi.
 */
async function synthesizeSpeech(text, outputPath) {
  if (ELEVEN_API_KEY) {
    try {
      return await synthesizeWithElevenLabs(text, outputPath);
    } catch (err) {
      const detail = err.response?.data ? Buffer.from(err.response.data).toString() : err.message;
      console.log('🔊 ElevenLabs xatosi, Edge TTS\'ga qaytilmoqda:', detail);
    }
  }

  try {
    return await synthesizeWithEdgeTTS(text, outputPath);
  } catch (err) {
    console.log('🔊 Edge TTS xatosi, ovozsiz davom etiladi:', err.message);
    return null;
  }
}

module.exports = { synthesizeSpeech };
