// captionsGenerator.js
// Video ustiga "karaoke" uslubidagi — so'z-so'z yorishib boradigan —
// subtitr (.ass fayl) yaratadi. FFmpeg'ning "subtitles" filtri orqali
// videoga "kuydiriladi" (burn-in), TikTok/Reels'dagi trend uslub kabi.
//
// DIZAYN: yorqin, katta, diqqatni tortuvchi uslub — oltin/sariq rangda
// yorishib boruvchi matn, qalin qora chegara bilan (har qanday fon
// rangida ham o'qilishi oson bo'lishi uchun).

const fs = require('fs');

function escapeAssText(text) {
  return String(text).replace(/\{/g, '(').replace(/\}/g, ')');
}

function formatAssTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}

function generateKaraokeSubtitles(text, totalDuration, outputPath, width, height) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || totalDuration <= 0) return null;

  const weights = words.map((w) => w.length + 2);
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  const WORDS_PER_LINE = 4;
  const lines = [];
  for (let i = 0; i < words.length; i += WORDS_PER_LINE) {
    lines.push({ words: words.slice(i, i + WORDS_PER_LINE), weights: weights.slice(i, i + WORDS_PER_LINE) });
  }

  let cursor = 0;
  const events = [];

  lines.forEach((line) => {
    const lineWeight = line.weights.reduce((a, b) => a + b, 0);
    const lineDuration = totalDuration * (lineWeight / totalWeight);
    const lineStart = cursor;
    const lineEnd = cursor + lineDuration;

    let karaokeText = '';
    line.words.forEach((w, idx) => {
      const wordDuration = lineDuration * (line.weights[idx] / lineWeight);
      const centiseconds = Math.max(1, Math.round(wordDuration * 100));
      karaokeText += `{\\k${centiseconds}}${escapeAssText(w.toUpperCase())} `;
    });

    events.push(
      `Dialogue: 0,${formatAssTime(lineStart)},${formatAssTime(lineEnd)},Karaoke,,0,0,0,,${karaokeText.trim()}`
    );

    cursor = lineEnd;
  });

  const fontSize = Math.round(width / 11);
  const marginV = Math.round(height * 0.16);

  const assContent = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Karaoke,DejaVu Sans,${fontSize},&H00FFFFFF,&H0000D7FF,&H00000000,&HB0000000,1,0,0,0,100,100,0,0,1,4,1,2,30,30,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join('\n')}
`;

  fs.writeFileSync(outputPath, assContent, 'utf8');
  return outputPath;
}

module.exports = { generateKaraokeSubtitles };
