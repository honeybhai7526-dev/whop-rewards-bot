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
      let processedCount = 0;

      for (const video of videos) {
        let existing = dbService.getSubmissionByVideoId(video.videoId);
        if (existing) {
          // Keep views up to date in real-time
          if (video.views && video.views !== existing.views) {
            dbService.updateSubmission(video.videoId, { views: video.views });
          }

          // If already submitted or failed (all 3 attempts exhausted), skip automatic retries
          if (existing.status === 'submitted' || existing.status === 'failed' || (existing.attempts || 0) >= 3) {
            continue;
          }
        } else {
          newCount++;
          console.log(`[Scheduler] 🚀 New Short detected: "${video.title}" (${video.views || '0 views'}). Submitting to "${activeCampaign.name}"...`);
          dbService.createSubmission({
            video_id: video.videoId,
            video_title: video.title,
            video_url: video.url,
            published_at: video.publishedAt,
            campaign_id: activeCampaign.id,
            campaign_name: activeCampaign.name,
            status: 'pending',
            views: video.views || '0 views'
          });
        }

        // Process only if attempts < 3
        existing = dbService.getSubmissionByVideoId(video.videoId);
        if (existing && (existing.attempts || 0) < 3 && existing.status !== 'submitted') {
          await this.processSubmission(video.videoId, false);
          processedCount++;
        }
      }

      // Process any pending retries (only items with attempts < 3)
      await this.processRetryQueue();

      console.log(`[Scheduler] Check complete. ${newCount} new videos detected, ${processedCount} processed.`);
      return { status: 'success', newCount, processedCount };
    } catch (err) {
      console.error('[Scheduler] Error in runCheck:', err);
      return { status: 'error', message: err.message };
    } finally {
      isPollingRunning = false;
    }
  },

  // Process a single video submission
  // isManual = true when user clicked "Retry" / "Submit" on the dashboard
  async processSubmission(videoId, isManual = false) {
    const item = dbService.getSubmissionByVideoId(videoId);
    if (!item) return;

    // Guard: Don't auto-process already submitted or failed items unless manual retry
    if (!isManual && (item.status === 'submitted' || item.status === 'failed' || item.attempts >= 3)) {
      return;
    }

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
        campaignName: activeCampaign.name,
        forceNotify: isManual
      });
    } catch (err) {
      console.error(`[Scheduler] ❌ Failed to submit "${item.video_title}":`, err.message);

      const isExhausted = currentAttempts >= 3;
      const newStatus = isExhausted ? 'failed' : 'retrying';

      dbService.updateSubmission(videoId, {
        status: newStatus,
        attempts: currentAttempts,
        last_error: err.message
      });

      // Notification rules:
      // 1. Sends notification on first 3 times of new short
      // 2. OR sends notification whenever user clicks retry on rejected/failed short (isManual = true)
      if (currentAttempts <= 3 || isManual) {
        await telegramService.sendSubmissionFailedAlert({
          videoTitle: item.video_title,
          videoUrl: item.video_url,
          campaignName: activeCampaign.name,
          error: err.message,
          attempts: Math.min(currentAttempts, 3),
          isManual
        });
      }
    }
  },

  // Process retries with backoff (only retries items where attempts < 3)
  async processRetryQueue() {
    const pending = dbService.getPendingRetries();
    if (!pending || pending.length === 0) return;

    console.log(`[Scheduler] Processing ${pending.length} pending retries...`);
    for (const item of pending) {
      if (item.attempts < 3) {
        console.log(`[Scheduler] Retrying video "${item.video_title}" (Attempt ${item.attempts + 1}/3)...`);
        await this.processSubmission(item.video_id, false);
      }
    }
  },

  // Manual trigger for a specific video ID (from "Submit" or "Retry" button on dashboard)
  async submitManual(videoId) {
    const item = dbService.getSubmissionByVideoId(videoId);
    if (!item) {
      throw new Error(`Video with ID ${videoId} not found in database`);
    }

    dbService.updateSubmission(videoId, {
      status: 'retrying',
      last_error: null
    });

    await this.processSubmission(videoId, true);
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
