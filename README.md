# Whop Content Rewards — Auto Submitter Bot 🚀

An automated 24/7 cloud service and mobile-responsive web dashboard that automatically monitors your YouTube channel for newly published Shorts and submits them to your active **Whop Content Rewards** campaign.

---

## ✨ Features

- **24/7 Cloud or Local PC Execution:** Runs continuously in the cloud (or on your PC) even when your computer and phone are turned off.
- **Mobile & Desktop Dashboard:** Responsive UI protected by a Master PIN (default: `1234`).
- **Dynamic Campaign Verification:** Paste any Whop campaign URL to automatically inspect and preview the exact campaign title, creator/community, and payout rates before locking it in.
- **YouTube Shorts Auto-Polling:** Monitors your YouTube channel every 5 minutes. Enter your channel handle (`@YourChannel`) with zero Google login required (or add an optional YouTube Data API key).
- **Auto-Retry & Telegram Alerts:** Submissions that fail due to temporary network issues are retried 3 times with exponential backoff. If failures persist or your Whop session token expires, an instant push notification is sent to your Telegram on phone lock-screen and PC.
- **Single Submission Safety:** Deduplicates videos using SQLite so a clip is never submitted twice.

---

## 🛠️ Quick Start (Local PC)

1. **Install Dependencies:**
   ```bash
   npm install
   ```

2. **Start the Application:**
   ```bash
   npm start
   ```

3. **Open the Dashboard:**
   Visit `http://localhost:3000` in your browser.
   - **Default Master PIN:** `1234` (you can change this in Settings).

---

## ☁️ 24/7 Cloud Hosting (Run Always-On for Free)

To keep the bot running even when your computer is off:

### Deploying to Render.com:
1. Push this project folder to your GitHub repository.
2. Sign up on [Render.com](https://render.com) (free).
3. Click **New +** &rarr; **Web Service**.
4. Connect your GitHub repository.
5. Set:
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
6. Click **Create Web Service**. You will receive a live URL (e.g., `https://whop-rewards-bot.onrender.com`) that you can open on your phone and PC anytime!

### Deploying to Railway.app:
1. Push to GitHub.
2. In [Railway.app](https://railway.app), click **New Project** &rarr; **Deploy from GitHub repo**.
3. Railway automatically detects Node.js and starts the app.

---

## 📱 Setting Up Telegram Screen Alerts (Phone & PC)

1. Open Telegram on your phone and search for `@BotFather`.
2. Send `/newbot`, give it a name (e.g. `MyWhopNotifierBot`), and copy the **API Bot Token**.
3. Search for `@userinfobot` on Telegram, click Start, and copy your **Id** (this is your Chat ID).
4. In the app dashboard, click **Settings**, paste your **Bot Token** and **Chat ID**, and click **Test Alert**!

---

## 🔑 Whop Session Token Setup

To submit clips headlessly without solving captchas:
1. Log in to [Whop.com](https://whop.com) in your browser.
2. Press `F12` (Developer Tools) &rarr; Go to **Application** &rarr; **Cookies** &rarr; `https://whop.com`.
3. Copy the value of the `whop_session` cookie.
4. In the bot dashboard, paste it into **Settings** &rarr; **Whop Session Token**.
