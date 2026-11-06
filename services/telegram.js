import { dbService } from './db.js';

export const telegramService = {
  async sendTelegramMessage(botToken, chatId, text) {
    if (!botToken || !chatId) {
      console.log('[Telegram] Bot token or chat ID missing, skipping alert.');
      return { success: false, error: 'Bot token or chat ID is missing.' };
    }

    try {
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'HTML',
          disable_web_page_preview: false
        })
      });

      const data = await response.json();
      if (!data.ok) {
        console.error('[Telegram] API Error:', data.description);
        let msg = data.description || 'Unknown Telegram error';
        if (msg.toLowerCase().includes('chat not found')) {
          msg = "Chat not found! Please open your bot on Telegram and tap 'Start' first so it has permission to message you.";
        }
        return { success: false, error: msg };
      }
      return { success: true };
    } catch (err) {
      console.error('[Telegram] Network Error:', err.message);
      return { success: false, error: err.message };
    }
  },

  async sendTestNotification(botToken, chatId) {
    const text = `🎉 <b>Whop Automation Bot Connected!</b>\n\nYour Telegram alerts are successfully configured. You will receive real-time push notifications on your phone lock-screen and desktop if any clip submission fails or requires attention.`;
    return await this.sendTelegramMessage(botToken, chatId, text);
  },

  async sendSubmissionFailedAlert({ videoTitle, videoUrl, campaignName, error, attempts, isManual = false }) {
    const botToken = dbService.getSetting('telegram_bot_token');
    const chatId = dbService.getSetting('telegram_chat_id');

    const titleHeader = isManual
      ? `🔄 <b>Manual Retry: Submission Failed</b>`
      : `⚠️ <b>Whop Clip Submission Notice (Attempt ${attempts}/3)</b>`;

    const footer = isManual
      ? `<i>Triggered manually from your dashboard.</i>`
      : (attempts >= 3 
          ? `<i>Auto-retry paused after 3 attempts. Background checker continues silently every 5 minutes for new Shorts. You can retry from your dashboard.</i>` 
          : `<i>Will retry automatically.</i>`);

    const text = `${titleHeader}\n\n` +
      `<b>Video:</b> ${videoTitle}\n` +
      `<b>URL:</b> ${videoUrl}\n` +
      `<b>Campaign:</b> ${campaignName || 'None'}\n` +
      `<b>Reason:</b> <code>${error}</code>\n\n` +
      footer;

    return await this.sendTelegramMessage(botToken, chatId, text);
  },

  async sendSubmissionSuccessAlert({ videoTitle, videoUrl, campaignName, forceNotify = false }) {
    const notifyOnSuccess = dbService.getSetting('notify_on_success', '0') === '1';
    if (!notifyOnSuccess && !forceNotify) return;

    const botToken = dbService.getSetting('telegram_bot_token');
    const chatId = dbService.getSetting('telegram_chat_id');

    const header = forceNotify ? `🎉 <b>Manual Submission Successful!</b>` : `✅ <b>Clip Submitted to Whop!</b>`;

    const text = `${header}\n\n` +
      `<b>Video:</b> ${videoTitle}\n` +
      `<b>Campaign:</b> ${campaignName}\n` +
      `<b>Link:</b> ${videoUrl}`;

    return await this.sendTelegramMessage(botToken, chatId, text);
  },

  async sendTokenExpiredAlert() {
    const botToken = dbService.getSetting('telegram_bot_token');
    const chatId = dbService.getSetting('telegram_chat_id');

    const text = `⚠️ <b>Whop Session Expired!</b>\n\n` +
      `Your Whop session token has expired or is invalid. Automatic clip submissions are paused.\n\n` +
      `<i>Please open your dashboard and update your Whop session token in Settings.</i>`;

    return await this.sendTelegramMessage(botToken, chatId, text);
  }
};
