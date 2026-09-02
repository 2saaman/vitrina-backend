const cron = require('node-cron');
const { getDueListings, updateListing } = require('./db');
const { publishReel } = require('./instagramPublisher');

function startScheduler() {
  // Har daqiqada tekshiradi
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

  console.log('⏱  Scheduler ishga tushdi — har daqiqada tekshiradi');
}

module.exports = { startScheduler };
