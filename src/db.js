const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'data', 'vitrina.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS listings (
    id TEXT PRIMARY KEY,
    uyTuri TEXT,
    manzil TEXT,
    narx TEXT,
    xonalar TEXT,
    maydon TEXT,
    xususiyat TEXT,
    caption TEXT,
    hashtags TEXT,
    videoPath TEXT,
    status TEXT DEFAULT 'kutilmoqda',
    scheduledFor TEXT,
    postedAt TEXT,
    igPostId TEXT,
    createdAt TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

module.exports = db;
