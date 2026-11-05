import cron from 'node-cron';
import { dbService } from './db.js';
import { youtubeService } from './youtube.js';
import { whopService } from './whop.js';
import { telegramService } from './telegram.js';

let isPollingRunning = false;

export const schedulerService = {
  // Main polling routine
  async runCheck() {
    if (isPollingRunning) {
      console.log('[Scheduler] Poll already in progress, skipping duplicate run.');
      return { status: 'already_running' };
    }

    isPollingRunning = true;
    console.log(`\n[Scheduler] --- Starting YouTube Shorts check at ${new Date().toISOString()} ---`);

    try {
      const activeCampaign = dbService.getActiveCampaign();
      if (!activeCampaign) {
        console.log('[Scheduler] No active campaign configured. Skipping submissions.');
        return { status: 'no_active_campaign' };
      }

      const res = await youtubeService.getLatestShorts();
      if (res.error) {
        console.log(`[Scheduler] YouTube check notice: ${res.error}`);
        return { status: 'youtube_error', message: res.error };
      }

      const videos = res.videos || [];
      console.log(`[Scheduler] Found ${videos.length} videos from channel ${res.channelId}`);

      let newCount = 0;
      let submittedCount = 0;

      // Check if this is the very first time we see any videos in database
      const existingStats = dbService.getStats();
      const isFirstRunEver = existingStats.total === 0;

      for (const video of videos) {
        const existing = dbService.getSubmissionByVideoId(video.videoId);
        if (existing) {
          // Already recorded
          continue;
        }

        newCount++;

        if (isFirstRunEver) {
          // As decided: On initial setup, record existing videos so only future uploads are auto-submitted,
          // while leaving them available in dashboard with a "Submit" button
          console.log(`[Scheduler] Recording existing video: "${video.title}" (${video.videoId})`);
          dbService.createSubmission({
            video_id: video.videoId,
            video_title: video.title,
            video_url: video.url,
            published_at: video.publishedAt,
            campaign_id: activeCampaign.id,
            campaign_name: activeCampaign.name,
            status: 'pending'
          });
          continue;
        }

        // New video detected after initial setup! Submit to active campaign
        console.log(`[Scheduler] 🚀 New Short detected: "${video.title}". Submitting to "${activeCampaign.name}"...`);
        dbService.createSubmission({
          video_id: video.videoId,
          video_title: video.title,
          video_url: video.url,
          published_at: video.publishedAt,
          campaign_id: activeCampaign.id,
          campaign_name: activeCampaign.name,
          status: 'pending'
        });

        await this.processSubmission(video.videoId);
        submittedCount++;
      }

      // Process any pending retries
      await this.processRetryQueue();

      console.log(`[Scheduler] Check complete. ${newCount} new videos detected, ${submittedCount} submitted.`);
      return { status: 'success', newCount, submittedCount };
    } catch (err) {
      console.error('[Scheduler] Error in runCheck:', err);
      return { status: 'error', message: err.message };
    } finally {
      isPollingRunning = false;
    }
  },

  // Process a single video submission
  async processSubmission(videoId) {
    const item = dbService.getSubmissionByVideoId(videoId);
    if (!item) return;

    const activeCampaign = dbService.getActiveCampaign();
    if (!activeCampaign) {
      console.log('[Scheduler] Cannot submit: no active campaign.');
      return;
    }

    const currentAttempts = (item.attempts || 0) + 1;

    try {
      const result = await whopService.submitClip({
        videoUrl: item.video_url,
        videoTitle: item.video_title,
        campaignId: activeCampaign.id,
        campaignUrl: activeCampaign.whop_url
      });

      // Update as submitted
      dbService.updateSubmission(videoId, {
        status: 'submitted',
        attempts: currentAttempts,
        whop_submission_id: result.submissionId,
        submitted_at: new Date().toISOString(),
        campaign_id: activeCampaign.id,
        campaign_name: activeCampaign.name,
        last_error: null
      });

      console.log(`[Scheduler] ✅ Video "${item.video_title}" submitted successfully!`);
      await telegramService.sendSubmissionSuccessAlert({
        videoTitle: item.video_title,
        videoUrl: item.video_url,
        campaignName: activeCampaign.name
      });
    } catch (err) {
      console.error(`[Scheduler] ❌ Failed to submit "${item.video_title}":`, err.message);

      if (currentAttempts >= 3) {
        // Retries exhausted
        dbService.updateSubmission(videoId, {
          status: 'failed',
          attempts: currentAttempts,
          last_error: err.message
        });

        // Send Telegram alert on final failure
        await telegramService.sendSubmissionFailedAlert({
          videoTitle: item.video_title,
          videoUrl: item.video_url,
          campaignName: activeCampaign.name,
          error: err.message,
          attempts: currentAttempts
        });
      } else {
        // Enqueue for next retry
        dbService.updateSubmission(videoId, {
          status: 'retrying',
          attempts: currentAttempts,
          last_error: err.message
        });
      }
    }
  },

  // Process retries with backoff
  async processRetryQueue() {
    const pending = dbService.getPendingRetries();
    if (!pending || pending.length === 0) return;

    console.log(`[Scheduler] Processing ${pending.length} pending retries...`);
    for (const item of pending) {
      // Only retry if it has failed attempts < 3
      if (item.attempts < 3) {
        console.log(`[Scheduler] Retrying video "${item.video_title}" (Attempt ${item.attempts + 1}/3)...`);
        await this.processSubmission(item.video_id);
      }
    }
  },

  // Manual trigger for a specific video ID (from "Submit Existing" button)
  async submitManual(videoId) {
    const item = dbService.getSubmissionByVideoId(videoId);
    if (!item) {
      throw new Error(`Video with ID ${videoId} not found in database`);
    }
    await this.processSubmission(videoId);
    return dbService.getSubmissionByVideoId(videoId);
  },

  // Start cron scheduling
  initScheduler() {
    // Run every 5 minutes: */5 * * * *
    cron.schedule('*/5 * * * *', async () => {
      console.log('[Scheduler] 5-minute cron interval triggered.');
      await this.runCheck();
    });

    console.log('[Scheduler] Background cron poller initialized (runs every 5 minutes).');

    // Run first check 10 seconds after server start
    setTimeout(() => {
      this.runCheck();
    }, 10000);
  }
};
