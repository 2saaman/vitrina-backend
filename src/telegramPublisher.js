// telegramPublisher.js
// Telegram Bot API orqali video + caption'ni kanalga joylaydi.

const axios = require('axios');

/**
 * Video URL (Cloudinary havolasi) + caption'ni Telegram kanaliga yuboradi.
 * @param {object} opts
 * @param {string} opts.botToken - Telegram bot token
 * @param {string} opts.channelUsername - kanal (masalan "@homebysaman_uy")
 * @param {string} opts.videoUrl - video havolasi (Cloudinary)
 * @param {string} opts.caption - video ostidagi matn
 * @returns {Promise<number>} - joylangan xabar ID'si
 */
async function publishToTelegram({ botToken, channelUsername, videoUrl, caption }) {
  if (!botToken || !channelUsername) {
    throw new Error("Telegram bot token yoki kanal username sozlanmagan");
  }

  // Telegram caption uzunligi 1024 belgi bilan cheklangan
  const safeCaption = caption.length > 1024 ? caption.slice(0, 1021) + '...' : caption;

  const url = `https://api.telegram.org/bot${botToken}/sendVideo`;
  const response = await axios.post(url, {
    chat_id: channelUsername,
    video: videoUrl, // Telegram video URL'ni o'zi yuklab oladi
    caption: safeCaption,
    parse_mode: 'HTML'
  });

  if (!response.data.ok) {
    throw new Error(`Telegram xatosi: ${JSON.stringify(response.data)}`);
  }

  return response.data.result.message_id;
}

module.exports = { publishToTelegram };
