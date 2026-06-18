# USTOZ AI — Deploy Qo'llanmasi

## Loyiha tuzilmasi
```
ustoz-ai-deploy/
├── api/
│   └── claude.js        ← Anthropic API proxy (xavfsiz)
├── src/
│   ├── main.jsx         ← React kirish nuqtasi
│   └── App.jsx          ← Asosiy ilova
├── index.html
├── package.json
├── vite.config.js
├── vercel.json
└── .env.example
```

---

## 🚀 Vercel orqali Deploy (Eng oson)

### 1-qadam: GitHub ga yuklang

1. [github.com](https://github.com) ga kiring yoki ro'yxatdan o'ting
2. "New repository" tugmasini bosing
3. Repo nomini kiriting: `ustoz-ai-lms`
4. "Create repository" bosing
5. Barcha fayllarni yuklang (upload files)

### 2-qadam: Vercel ga ulang

1. [vercel.com](https://vercel.com) ga kiring
2. "Sign up with GitHub" bosing
3. "Add New Project" → GitHub repo ni tanlang (`ustoz-ai-lms`)
4. "Deploy" tugmasini bosing

### 3-qadam: API Key qo'shing (MUHIM!)

1. Vercel dashboard → loyihangizni oching
2. **Settings** → **Environment Variables**
3. Qo'shing:
   - **Name:** `ANTHROPIC_API_KEY`
   - **Value:** `sk-ant-api03-...` (sizning Anthropic API kalit)
4. **Save** bosing
5. **Deployments** → **Redeploy** bosing

### 4-qadam: Tayyor!

Vercel sizga `https://ustoz-ai-lms.vercel.app` kabi URL beradi.
Bu URL ni istalgan qurilmadan (telefon, kompyuter, tablet) ochsa bo'ladi.

---

## 💻 Lokal (o'z kompyuterda) ishlatish

```bash
# 1. Fayllarni yuklab oling va papkaga kiring
cd ustoz-ai-deploy

# 2. Paketlarni o'rnating
npm install

# 3. .env fayl yarating
cp .env.example .env
# .env faylini oching va ANTHROPIC_API_KEY ni kiriting

# 4. Dev server ni ishga tushiring
npm run dev

# 5. Brauzerda oching
# http://localhost:5173
```

---

## 🔑 Anthropic API Key olish

1. [console.anthropic.com](https://console.anthropic.com) ga kiring
2. "API Keys" → "Create Key"
3. Kalitni nusxalab oling (`sk-ant-api03-...`)
4. Vercel Environment Variables ga kiriting

---

## 📱 Boshqa qurilmalardan ochish

Deploy qilingandan keyin Vercel URL ni istalgan joydan oching:
- 📱 Telefon (iOS/Android)
- 💻 Laptop/Desktop
- 📟 Tablet

---

## ⚠️ Muhim eslatmalar

- **API Key** ni hech kimga bermang — pul sarflanadi
- Vercel Free plan: oyiga 100GB traffic — bu loyiha uchun yetarli
- Foydalanuvchi ma'lumotlari brauzer `localStorage` da saqlanadi
- Har qurilmada alohida account yaratiladi (shared database yo'q)

---

## 🆓 Bepul limiti (Free tier)

| Xizmat | Bepul limit |
|--------|-------------|
| Vercel Hosting | 100GB/oy, unlimited requests |
| Anthropic API | Har oyda $5 kredit (boshlang'ich) |

---

## Yordam kerakmi?

Savollar bo'lsa: GitHub Issues yoki to'g'ridan-to'g'ri murojaat qiling.
