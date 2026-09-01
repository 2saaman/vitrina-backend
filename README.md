# Vitrina Backend

Ko'chmas mulk uchun avtomatik video yaratish va Instagram'ga rejalashtirilgan holda joylash tizimi. To'liq bepul komponentlardan tuzilgan (ffmpeg, SQLite, node-cron).

## 1. GitHub'ga joylash

```bash
cd vitrina-backend
git init
git add .
git commit -m "Vitrina backend - birinchi versiya"
git branch -M main
git remote add origin https://github.com/FOYDALANUVCHI_NOMI/vitrina-backend.git
git push -u origin main
```

`.env` faylini **hech qachon** GitHub'ga yuklamang — `.gitignore` fayli buni avtomatik oldini oladi.

## 2. Render.com'da bepul deploy qilish

1. render.com'da ro'yxatdan o'ting, GitHub akkountingizni ulang
2. "New +" → "Web Service" → repo'ingizni tanlang
3. Sozlamalar:
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: **Free**
4. "Environment" bo'limida `.env.example`dagi barcha o'zgaruvchilarni qo'shing (haqiqiy qiymatlar bilan)
5. Deploy tugagach, Render sizga ochiq URL beradi (masalan `https://vitrina-backend.onrender.com`) — shu manzilni `PUBLIC_BASE_URL` ga yozing va qayta deploy qiling

## 3. Test qilish

```bash
curl https://your-app.onrender.com/health
```

`{"ok":true,...}` chiqsa, server ishlayapti.

## 4. Yangi e'lon qo'shish (misol)

```bash
curl -X POST https://your-app.onrender.com/api/listings \
  -H "x-admin-secret: SIZNING_ADMIN_SECRET" \
  -F "images=@/yol/rasm1.jpg" \
  -F "images=@/yol/rasm2.jpg" \
  -F "uyTuri=Kvartira" \
  -F "manzil=Yunusobod tumani" \
  -F "narx=\$85000" \
  -F "xonalar=3" \
  -F "maydon=78" \
  -F "qavat=5/9" \
  -F "xususiyat=Yevroremont, metro yaqin" \
  -F "scheduledFor=2026-09-01T15:00:00.000Z"
```

`scheduledFor` — ISO formatda, qachon Instagram'ga joylanishi kerakligi. Shu vaqt kelganda scheduler avtomatik topib, joylab qo'yadi.

## Muhim eslatma

Bepul Render tarifi harakatsiz qolganda "uxlab qoladi" va qayta ishga tushishi ~30-60 soniya vaqt oladi. Bu scheduler ishlashiga xalaqit bermasligi uchun, keyinchalik oyiga bir necha dollarlik "Starter" tarifga o'tish tavsiya etiladi — lekin boshlash uchun Free yetarli.
