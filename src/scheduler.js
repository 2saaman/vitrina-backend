const cron = require('node-cron');
const { getDueListings, updateListing } = require('./db');
const { publishReel } = require('./instagramPublisher');
const { fetchOnlineFollowers } = require('./instagramInsights');

function startScheduler() {
  // Har daqiqada tekshiradi — rejalashtirilgan e'lonlarni joylaydi
  cron.schedule('* * * * *', async () => {
    const now = new Date().toISOString();
    const due = getDueListings(now);

    for (const listing of due) {
      try {
        const videoUrl = listing.videoUrl;
        const hashtags = Array.isArray(listing.hashtags) ? listing.hashtags : JSON.parse(listing.hashtags || '[]');
        const fullCaption = `${listing.caption}\n\n${hashtags.join(' ')}`;

        const igPostId = await publishReel({
          igUserId: process.env.IG_USER_ID,
          accessToken: process.env.IG_ACCESS_TOKEN,
          videoUrl,
          caption: fullCaption
        });

        updateListing(listing.id, { status: 'joylandi', postedAt: new Date().toISOString(), igPostId });

        console.log(`✅ Joylandi: ${listing.id} -> IG post ${igPostId}`);
      } catch (err) {
        updateListing(listing.id, { status: 'xato' });
        console.error(`❌ Xatolik (${listing.id}):`, err.message);
      }
    }
  });

  // Har 6 soatda Instagram'dan obunachilarning haqiqiy onlayn faolligini
  // yangilab turadi (akkaunt kamida 100 obunachiga yetganda ishga tushadi).
  cron.schedule('0 */6 * * *', async () => {
    console.log('📊 Obunachilar faolligi (online_followers) tekshirilmoqda...');
    await fetchOnlineFollowers({
      igUserId: process.env.IG_USER_ID,
      accessToken: process.env.IG_ACCESS_TOKEN
    });
  });

  // Server ishga tushganda ham bir marta darhol tekshirib qo'yamiz
  // (6 soat kutmasdan, imkon bo'lsa darhol real ma'lumotdan foydalanish uchun)
  fetchOnlineFollowers({
    igUserId: process.env.IG_USER_ID,
    accessToken: process.env.IG_ACCESS_TOKEN
  }).catch((e) => console.log('📊 Boshlang\'ich insights so\'rovida xatolik:', e.message));

  console.log('⏱  Scheduler ishga tushdi — har daqiqada tekshiradi, har 6 soatda insights yangilanadi');
}

module.exports = { startScheduler };
