const cron = require('node-cron');
const db = require('./db');
const { publishReel } = require('./instagramPublisher');

function startScheduler() {
  // Har daqiqada tekshiradi
  cron.schedule('* * * * *', async () => {
    const now = new Date().toISOString();
    const due = db.prepare(
      `SELECT * FROM listings WHERE status = 'kutilmoqda' AND scheduledFor <= ?`
    ).all(now);

    for (const listing of due) {
      try {
        const videoUrl = `${process.env.PUBLIC_BASE_URL}/videos/${listing.videoPath}`;
        const fullCaption = `${listing.caption}\n\n${JSON.parse(listing.hashtags).join(' ')}`;

        const igPostId = await publishReel({
          igUserId: process.env.IG_USER_ID,
          accessToken: process.env.IG_ACCESS_TOKEN,
          videoUrl,
          caption: fullCaption
        });

        db.prepare(
          `UPDATE listings SET status = 'joylandi', postedAt = ?, igPostId = ? WHERE id = ?`
        ).run(new Date().toISOString(), igPostId, listing.id);

        console.log(`✅ Joylandi: ${listing.id} -> IG post ${igPostId}`);
      } catch (err) {
        db.prepare(`UPDATE listings SET status = 'xato' WHERE id = ?`).run(listing.id);
        console.error(`❌ Xatolik (${listing.id}):`, err.message);
      }
    }
  });

  console.log('⏱  Scheduler ishga tushdi — har daqiqada tekshiradi');
}

module.exports = { startScheduler };
