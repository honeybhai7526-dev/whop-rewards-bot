import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Data directory
const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'whop_rewards.db');
const db = new DatabaseSync(dbPath);

// Initialize schema
db.exec(`
  PRAGMA journal_mode = WAL;
  
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    whop_url TEXT NOT NULL,
    name TEXT NOT NULL,
    community_name TEXT,
    reward_rate TEXT,
    is_active INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id TEXT NOT NULL UNIQUE,
    video_title TEXT NOT NULL,
    video_url TEXT NOT NULL,
    published_at TEXT NOT NULL,
    campaign_id TEXT,
    campaign_name TEXT,
    status TEXT CHECK(status IN ('pending', 'retrying', 'submitted', 'failed')) DEFAULT 'pending',
    attempts INTEGER DEFAULT 0,
    last_error TEXT,
    whop_submission_id TEXT,
    submitted_at DATETIME,
    views TEXT DEFAULT '0 views',
    alert_sent INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Safe migrations for existing databases
try {
  db.exec(`ALTER TABLE submissions ADD COLUMN views TEXT DEFAULT '0 views';`);
} catch (e) {}
try {
  db.exec(`ALTER TABLE submissions ADD COLUMN alert_sent INTEGER DEFAULT 0;`);
} catch (e) {}

// Auto-populate from Environment Variables if present (ensures cloud persistence on Render)
const initFromEnv = () => {
  const envMap = {
    master_pin: process.env.MASTER_PIN,
    youtube_handle: process.env.YOUTUBE_HANDLE,
    youtube_channel_id: process.env.YOUTUBE_CHANNEL_ID,
    youtube_channel_title: process.env.YOUTUBE_CHANNEL_TITLE,
    youtube_channel_avatar: process.env.YOUTUBE_CHANNEL_AVATAR,
    whop_session_token: process.env.WHOP_SESSION_TOKEN,
    telegram_bot_token: process.env.TELEGRAM_BOT_TOKEN,
    telegram_chat_id: process.env.TELEGRAM_CHAT_ID,
    notify_on_success: process.env.NOTIFY_ON_SUCCESS
  };

  for (const [k, v] of Object.entries(envMap)) {
    if (v) {
      db.prepare(`
        INSERT INTO settings (key, value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(k, String(v));
    }
  }

  if (process.env.ACTIVE_CAMPAIGN_ID && process.env.ACTIVE_CAMPAIGN_URL && process.env.ACTIVE_CAMPAIGN_NAME) {
    db.prepare('UPDATE campaigns SET is_active = 0').run();
    db.prepare(`
      INSERT INTO campaigns (id, whop_url, name, community_name, reward_rate, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET 
        whop_url = excluded.whop_url,
        name = excluded.name,
        community_name = excluded.community_name,
        reward_rate = excluded.reward_rate,
        is_active = 1
    `).run(
      process.env.ACTIVE_CAMPAIGN_ID,
      process.env.ACTIVE_CAMPAIGN_URL,
      process.env.ACTIVE_CAMPAIGN_NAME,
      process.env.ACTIVE_CAMPAIGN_COMMUNITY || 'Content Rewards',
      process.env.ACTIVE_CAMPAIGN_RATE || ''
    );
  }
};
initFromEnv();

export const dbService = {
  // Settings operations
  getSetting(key, defaultValue = null) {
    const stmt = db.prepare('SELECT value FROM settings WHERE key = ?');
    const row = stmt.get(key);
    return row ? row.value : defaultValue;
  },

  getAllSettings() {
    const stmt = db.prepare('SELECT key, value FROM settings');
    const rows = stmt.all();
    const settings = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    return settings;
  },

  setSetting(key, value) {
    const stmt = db.prepare(`
      INSERT INTO settings (key, value, updated_at) 
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `);
    stmt.run(key, String(value));
  },

  // Campaigns operations
  getActiveCampaign() {
    const stmt = db.prepare('SELECT * FROM campaigns WHERE is_active = 1 LIMIT 1');
    return stmt.get() || null;
  },

  getAllCampaigns() {
    const stmt = db.prepare('SELECT * FROM campaigns ORDER BY created_at DESC');
    return stmt.all();
  },

  saveAndActivateCampaign({ id, whop_url, name, community_name, reward_rate }) {
    // Deactivate all first
    db.prepare('UPDATE campaigns SET is_active = 0').run();

    const stmt = db.prepare(`
      INSERT INTO campaigns (id, whop_url, name, community_name, reward_rate, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET 
        whop_url = excluded.whop_url,
        name = excluded.name,
        community_name = excluded.community_name,
        reward_rate = excluded.reward_rate,
        is_active = 1
    `);
    stmt.run(id, whop_url, name, community_name || '', reward_rate || '');
    return this.getActiveCampaign();
  },

  // Submissions operations
  getSubmissionByVideoId(videoId) {
    const stmt = db.prepare('SELECT * FROM submissions WHERE video_id = ?');
    return stmt.get(videoId) || null;
  },

  getSubmissions(limit = 100) {
    const stmt = db.prepare('SELECT * FROM submissions ORDER BY published_at DESC LIMIT ?');
    return stmt.all(limit);
  },

  createSubmission({ video_id, video_title, video_url, published_at, campaign_id, campaign_name, status = 'pending', views = '0 views' }) {
    const stmt = db.prepare(`
      INSERT INTO submissions (video_id, video_title, video_url, published_at, campaign_id, campaign_name, status, attempts, views, alert_sent)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, 0)
    `);
    return stmt.run(video_id, video_title, video_url, published_at, campaign_id || null, campaign_name || null, status, views);
  },

  updateSubmission(videoId, { status, attempts, last_error, whop_submission_id, submitted_at, campaign_id, campaign_name, views, alert_sent }) {
    const existing = this.getSubmissionByVideoId(videoId);
    if (!existing) return null;

    const newAttempts = attempts !== undefined ? attempts : existing.attempts;
    const newStatus = status !== undefined ? status : existing.status;
    const newError = last_error !== undefined ? last_error : existing.last_error;
    const newWhopId = whop_submission_id !== undefined ? whop_submission_id : existing.whop_submission_id;
    const newSubmittedAt = submitted_at !== undefined ? submitted_at : existing.submitted_at;
    const newCampaignId = campaign_id !== undefined ? campaign_id : existing.campaign_id;
    const newCampaignName = campaign_name !== undefined ? campaign_name : existing.campaign_name;
    const newViews = views !== undefined ? views : (existing.views || '0 views');
    const newAlertSent = alert_sent !== undefined ? alert_sent : (existing.alert_sent || 0);

    const stmt = db.prepare(`
      UPDATE submissions 
      SET status = ?, attempts = ?, last_error = ?, whop_submission_id = ?, submitted_at = ?, campaign_id = ?, campaign_name = ?, views = ?, alert_sent = ?
      WHERE video_id = ?
    `);
    stmt.run(newStatus, newAttempts, newError, newWhopId, newSubmittedAt, newCampaignId, newCampaignName, newViews, newAlertSent, videoId);
    return this.getSubmissionByVideoId(videoId);
  },

  getPendingRetries() {
    const stmt = db.prepare(`
      SELECT * FROM submissions 
      WHERE status IN ('pending', 'retrying') AND attempts < 3
      ORDER BY id ASC
    `);
    return stmt.all();
  },

  getStats() {
    const total = db.prepare('SELECT COUNT(*) as count FROM submissions').get().count;
    const submitted = db.prepare("SELECT COUNT(*) as count FROM submissions WHERE status = 'submitted'").get().count;
    const failed = db.prepare("SELECT COUNT(*) as count FROM submissions WHERE status = 'failed'").get().count;
    const pending = db.prepare("SELECT COUNT(*) as count FROM submissions WHERE status IN ('pending', 'retrying')").get().count;
    return { total, submitted, failed, pending };
  }
};
