const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'listings.json');

function ensureFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, '[]', 'utf-8');
}

function readAll() {
  ensureFile();
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
  } catch (e) {
    return [];
  }
}

function writeAll(listings) {
  ensureFile();
  fs.writeFileSync(DB_FILE, JSON.stringify(listings, null, 2), 'utf-8');
}

function addListing(listing) {
  const listings = readAll();
  listings.push(listing);
  writeAll(listings);
}

function updateListing(id, updates) {
  const listings = readAll();
  const idx = listings.findIndex((l) => l.id === id);
  if (idx !== -1) {
    listings[idx] = { ...listings[idx], ...updates };
    writeAll(listings);
  }
}

function getAllListings() {
  return readAll().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function getDueListings(nowISO) {
  return readAll().filter((l) => l.status === 'kutilmoqda' && l.scheduledFor && l.scheduledFor <= nowISO);
}

module.exports = { addListing, updateListing, getAllListings, getDueListings, readAll };
