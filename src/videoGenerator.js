// videoGenerator.js
const ffmpegPath = require('ffmpeg-static');
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const SECONDS_PER_IMAGE = 2.5;
const FPS = 18;
const WIDTH = 720;
const HEIGHT = 900;
const TRANSITION_DURATION = 0.5;
const INTRO_DURATION = 1.5;
const OUTRO_DURATION = 2;
const FONT_PATH = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

let _drawtextSupported = null;
function isDrawtextSupported() {
  if (_drawtextSupported !== null) return _drawtextSupported;
  try {
    const res = spawnSync(ffmpegPath, ['-hide_banner', '-filters']);
    const output = (res.stdout || '').toString();
    _drawtextSupported = output.includes('drawtext');
    console.log('🎬 drawtext filteri mavjud:', _drawtextSupported);
  } catch (e) {
    console.log('🎬 drawtext tekshiruvida xatolik:', e.message);
    _drawtextSupported = false;
  }
  return _drawtextSupported;
}

function escapeDrawtext(text) {
  return String(text)
    .replace(/\\/g, '\\\\\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\u2019")
    .replace(/%/g, '\\%');
}

function generateVideoFromImages(imagePaths, outputPath, musicPath, overlayData) {
  return new Promise((resolve, reject) => {
    if (!imagePaths || imagePaths.length === 0) {
      return reject(new Error('Kamida bitta rasm kerak'));
    }

    const useText = isDrawtextSupported();
    if (!useText) {
      console.log('🎬 drawtext mavjud emas — matn/intro/outro o\'tkazib yuboriladi, faqat crossfade + musiqa ishlatiladi.');
    }

    const frames = Math.round(SECONDS_PER_IMAGE * FPS);
    const inputs = [];
    const filterParts = [];

    let introIdx, outroIdx, imageStartIdx;

    if (useText) {
      inputs.push('-f', 'lavfi', '-t', String(INTRO_DURATION), '-i',
