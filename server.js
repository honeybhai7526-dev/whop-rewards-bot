import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { dbService } from './services/db.js';
import { youtubeService } from './services/youtube.js';
import { whopService } from './services/whop.js';
import { telegramService } from './services/telegram.js';
import { schedulerService } from './services/scheduler.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize default settings if empty
if (!dbService.getSetting('master_pin')) {
  dbService.setSetting('master_pin', '1234');
}

// --- PUBLIC AUTH ROUTE (NO PIN REQUIRED TO VERIFY PIN) ---
app.post('/api/auth/verify', (req, res) => {
  const { pin } = req.body;
  const currentPin = dbService.getSetting('master_pin', '1234');
  if (pin && String(pin).trim() === String(currentPin).trim()) {
    return res.json({ success: true });
  }
  return res.status(401).json({ error: 'Incorrect PIN' });
});

// PIN Authentication Middleware for protected /api routes
const requirePin = (req, res, next) => {
  if (req.path === '/auth/verify' || req.originalUrl === '/api/auth/verify') return next();

  const currentPin = dbService.getSetting('master_pin', '1234');
  const userPin = req.headers['x-app-pin'];

  if (!userPin || String(userPin).trim() !== String(currentPin).trim()) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or missing Master PIN' });
  }
  next();
};

app.use('/api', requirePin);

// --- DASHBOARD STATUS & STATS ---
app.get('/api/status', (req, res) => {
  const stats = dbService.getStats();
  const activeCampaign = dbService.getActiveCampaign();
  const channelHandle = dbService.getSetting('youtube_handle', '');
  const channelId = dbService.getSetting('youtube_channel_id', '');
  const hasWhopToken = !!dbService.getSetting('whop_session_token');
  const hasTelegram = !!(dbService.getSetting('telegram_bot_token') && dbService.getSetting('telegram_chat_id'));

  res.json({
    stats,
    activeCampaign,
    channel: {
      handle: channelHandle,
      channelId,
      title: dbService.getSetting('youtube_channel_title', ''),
      avatar: dbService.getSetting('youtube_channel_avatar', '')
    },
    integrations: {
      hasWhopToken,
      hasTelegram
    }
  });
});

// --- CAMPAIGN ROUTES ---
app.get('/api/campaigns', (req, res) => {
  const campaigns = dbService.getAllCampaigns();
  res.json({ campaigns });
});

app.post('/api/campaign/inspect', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'Whop Campaign URL is required' });
    }
    const metadata = await whopService.inspectCampaign(url);
    res.json({ campaign: metadata });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/campaign/set-active', (req, res) => {
  try {
    const { id, whop_url, name, community_name, reward_rate } = req.body;
    if (!id || !whop_url || !name) {
      return res.status(400).json({ error: 'Missing required campaign details' });
    }
    const saved = dbService.saveAndActivateCampaign({
      id,
      whop_url,
      name,
      community_name,
      reward_rate
    });
    res.json({ success: true, activeCampaign: saved });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- SUBMISSIONS ROUTES ---
app.get('/api/submissions', (req, res) => {
  const submissions = dbService.getSubmissions(150);
  res.json({ submissions });
});

app.post('/api/submissions/:videoId/submit', async (req, res) => {
  try {
    const { videoId } = req.params;
    const updated = await schedulerService.submitManual(videoId);
    res.json({ success: true, submission: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/submissions/:videoId/retry', async (req, res) => {
  try {
    const { videoId } = req.params;
    const updated = await schedulerService.submitManual(videoId);
    res.json({ success: true, submission: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/submissions/refresh-views', async (req, res) => {
  try {
    const updatedSubmissions = await youtubeService.refreshAllViews();
    res.json({ success: true, submissions: updatedSubmissions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/check-now', async (req, res) => {
  try {
    const result = await schedulerService.runCheck();
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- SETTINGS ROUTES ---
app.get('/api/settings', (req, res) => {
  const all = dbService.getAllSettings();
  // Mask sensitive tokens for security
  res.json({
    youtube_handle: all.youtube_handle || '',
    youtube_api_key: all.youtube_api_key ? '••••••••' + all.youtube_api_key.slice(-4) : '',
    has_api_key: !!all.youtube_api_key,
    whop_session_token: all.whop_session_token ? '••••••••' + all.whop_session_token.slice(-6) : '',
    has_whop_token: !!all.whop_session_token,
    telegram_bot_token: all.telegram_bot_token ? '••••••••' + all.telegram_bot_token.slice(-4) : '',
    has_telegram_token: !!all.telegram_bot_token,
    telegram_chat_id: all.telegram_chat_id || '',
    notify_on_success: all.notify_on_success || '0',
    master_pin: all.master_pin || '1234'
  });
});

app.post('/api/settings', async (req, res) => {
  try {
    const {
      youtube_handle,
      youtube_api_key,
      whop_session_token,
      telegram_bot_token,
      telegram_chat_id,
      notify_on_success,
      master_pin
    } = req.body;

    if (youtube_handle !== undefined) {
      dbService.setSetting('youtube_handle', youtube_handle.trim());
      // Re-resolve channel ID
      const newChannelId = await youtubeService.resolveChannelId(youtube_handle.trim());
      if (newChannelId) {
        dbService.setSetting('youtube_channel_id', newChannelId);
      }
    }

    if (youtube_api_key && !youtube_api_key.startsWith('••••')) {
      dbService.setSetting('youtube_api_key', youtube_api_key.trim());
    }

    if (whop_session_token && !whop_session_token.startsWith('••••')) {
      dbService.setSetting('whop_session_token', whop_session_token.trim());
    }

    if (telegram_bot_token && !telegram_bot_token.startsWith('••••')) {
      dbService.setSetting('telegram_bot_token', telegram_bot_token.trim());
    }

    if (telegram_chat_id !== undefined) {
      dbService.setSetting('telegram_chat_id', telegram_chat_id.trim());
    }

    if (notify_on_success !== undefined) {
      dbService.setSetting('notify_on_success', notify_on_success ? '1' : '0');
    }

    if (master_pin && master_pin.trim().length >= 4) {
      dbService.setSetting('master_pin', master_pin.trim());
    }

    res.json({ success: true, message: 'Settings saved successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/telegram/test', async (req, res) => {
  try {
    const { bot_token, chat_id } = req.body;
    const token = bot_token && !bot_token.startsWith('••••') ? bot_token : dbService.getSetting('telegram_bot_token');
    const chatId = chat_id || dbService.getSetting('telegram_chat_id');

    if (!token || !chatId) {
      return res.status(400).json({ error: 'Please provide both Telegram Bot Token and Chat ID.' });
    }

    const result = await telegramService.sendTestNotification(token, chatId);
    if (result && result.success) {
      res.json({ success: true, message: 'Test notification sent to Telegram!' });
    } else {
      res.status(400).json({ error: result?.error || 'Failed to send test message. Check token and chat ID.' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fallback to index.html for single-page dashboard
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Background Poller and HTTP Server
app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Whop Content Rewards Bot is running!`);
  console.log(`🌐 Dashboard URL: http://localhost:${PORT}`);
  console.log(`🔑 Master PIN: ${dbService.getSetting('master_pin', '1234')}`);
  console.log(`======================================================\n`);

  schedulerService.initScheduler();

  // Self-ping every 8 minutes to prevent Render Free Tier from spinning down
  const renderExternalUrl = process.env.RENDER_EXTERNAL_URL || 'https://whop-rewards-bot.onrender.com';
  if (renderExternalUrl && renderExternalUrl.includes('onrender.com')) {
    console.log(`[KeepAlive] Self-ping active for ${renderExternalUrl} (every 8 minutes)`);
    setInterval(async () => {
      try {
        await fetch(`${renderExternalUrl}/api/status`, {
          headers: { 'x-app-pin': dbService.getSetting('master_pin', '1234') }
        });
        console.log(`[KeepAlive] Ping successful to prevent cloud sleep.`);
      } catch (e) {
        console.log(`[KeepAlive] Ping notice:`, e.message);
      }
    }, 8 * 60 * 1000);
  }
});
