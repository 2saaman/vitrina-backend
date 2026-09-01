const axios = require('axios');

const GRAPH_VERSION = 'v20.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * Video URL'dan Reels yaratadi va Instagram'ga joylaydi.
 * Video hammaga ochiq URL orqali (PUBLIC_BASE_URL/videos/...) berilishi shart —
 * Meta serverlari o'zi borib videoni yuklab oladi.
 */
async function publishReel({ igUserId, accessToken, videoUrl, caption }) {
  // 1-qadam: media konteyner yaratish
  const createRes = await axios.post(`${GRAPH_BASE}/${igUserId}/media`, null, {
    params: {
      video_url: videoUrl,
      caption,
      media_type: 'REELS',
      access_token: accessToken
    }
  });
  const creationId = createRes.data.id;

  // 2-qadam: video qayta ishlanishini kutish (Meta serverida)
  let status = 'IN_PROGRESS';
  let attempts = 0;
  while (status === 'IN_PROGRESS' && attempts < 30) {
    await sleep(5000);
    const statusRes = await axios.get(`${GRAPH_BASE}/${creationId}`, {
      params: { fields: 'status_code', access_token: accessToken }
    });
    status = statusRes.data.status_code;
    attempts++;
  }

  if (status !== 'FINISHED') {
    throw new Error(`Video tayyor bo'lmadi, holat: ${status}`);
  }

  // 3-qadam: joylashtirish (publish)
  const publishRes = await axios.post(`${GRAPH_BASE}/${igUserId}/media_publish`, null, {
    params: { creation_id: creationId, access_token: accessToken }
  });

  return publishRes.data.id; // joylangan post ID
}

module.exports = { publishReel };
