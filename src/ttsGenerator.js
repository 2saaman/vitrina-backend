// ttsGenerator.js
// Matnni ovozga aylantiradi. Ikki bosqichli tizim:
//   1) ELEVENLABS_API_KEY sozlangan bo'lsa — ElevenLabs (yuqori sifat,
//      ko'p tilli model) ishlatiladi.
//   2) Aks holda, yoki ElevenLabs xato bersa (masalan oylik limit tugasa) —
//      avtomatik ravishda BEPUL Edge TTS'ga qaytiladi. Shuning uchun ovoz
//      hech qachon butunlay to'xtab qolmaydi.

const axios = require('axios');
const fs = require('fs');
const { EdgeTTS } = require('edge-tts-universal');

const ELEVEN_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVEN_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'; // "Rachel" — standart ko'p tilli ovoz
const ELEVEN_MODEL = 'eleven_multilingual_v2';

const RU_VOICE = process.env.EDGE_TTS_RU_VOICE || 'ru-RU-SvetlanaNeural';
const UZ_VOICE = process.env.EDGE_TTS_UZ_VOICE || 'uz-UZ-MadinaNeural';

function detectEdgeVoice(text) {
  const cyrillicCount = (text.match(/[\u0400-\u04FF]/g) || []).length;
  const latinCount = (text.match(/[A-Za-z']/g) || []).length;
  return cyrillicCount > latinCount ? RU_VOICE : UZ_VOICE;
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
      responseType: 'arraybuffer'
    }
  );
  fs.writeFileSync(outputPath, response.data);
  console.log('🔊 Ovozli tavsif yaratildi (ElevenLabs):', outputPath);
  return outputPath;
}

async function synthesizeWithEdgeTTS(text, outputPath) {
  const voice = detectEdgeVoice(text);
  const tts = new EdgeTTS(text, voice);
  const result = await tts.synthesize();
  const buffer = Buffer.from(await result.audio.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);
  console.log(`🔊 Ovozli tavsif yaratildi (Edge TTS, ${voice}):`, outputPath);
  return outputPath;
}

/**
 * Matnni ovozga aylantiradi va faylga saqlaydi.
 * Xato yuz bersa (ikkala usul ham ishlamasa) — null qaytaradi, bu holda
 * video ovozli tavsifsiz, faqat fon musiqasi bilan yaratiladi.
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
