import * as cheerio from 'cheerio';
import { dbService } from './db.js';
import { telegramService } from './telegram.js';

export const whopService = {
  // Extract identifiers from Whop URL
  parseCampaignUrl(url) {
    if (!url) return null;
    try {
      const u = new URL(url.trim());
      const queryId = u.searchParams.get('id') || u.searchParams.get('bounty_id') || u.searchParams.get('campaign_id');
      const parts = u.pathname.split('/').filter(Boolean);
      const id = queryId || parts[parts.length - 1] || 'camp_' + Date.now();
      return {
        id,
        cleanUrl: u.href,
        hostname: u.hostname
      };
    } catch (err) {
      return null;
    }
  },

  // Inspect Whop Campaign Page to extract exact Campaign Name, Company/Creator, and Reward Rate
  async inspectCampaign(url, customToken = null) {
    const parsed = this.parseCampaignUrl(url);
    if (!parsed) {
      throw new Error('Invalid Whop URL format. Please paste a valid https://whop.com link.');
    }

    const token = customToken || dbService.getSetting('whop_session_token');

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9'
    };

    if (token) {
      const cleanToken = token.trim();
      headers['Cookie'] = cleanToken.includes('=') ? cleanToken : `whop.core.access_token=${cleanToken}; whop_session=${cleanToken}`;
      headers['Authorization'] = `Bearer ${cleanToken.replace(/^Bearer\s+/i, '')}`;
    }

    try {
      console.log(`[Whop] Inspecting campaign URL: ${parsed.cleanUrl}`);
      const res = await fetch(parsed.cleanUrl, { headers });

      if (res.status === 401 || res.status === 403) {
        throw new Error('Whop authentication failed. Please check your Whop Session Token.');
      }

      if (!res.ok) {
        throw new Error(`Failed to load Whop page: HTTP ${res.status}`);
      }

      const html = await res.text();
      const $ = cheerio.load(html);

      let name = '';
      let communityName = '';
      let rewardRate = '';
      let campaignId = parsed.id;

      // 1. Try Next.js __NEXT_DATA__
      const nextDataRaw = $('#__NEXT_DATA__').html();
      if (nextDataRaw) {
        try {
          const nextData = JSON.parse(nextDataRaw);
          const pageProps = nextData?.props?.pageProps || {};
          const bounty = pageProps.bounty || pageProps.campaign || pageProps.reward;
          if (bounty) {
            name = bounty.name || bounty.title || '';
            communityName = bounty.company?.name || bounty.creator?.name || '';
            rewardRate = bounty.rate || bounty.payout_rate || bounty.reward_amount || '';
            if (bounty.id) campaignId = String(bounty.id);
          }
        } catch (e) {
          // fallback to HTML tags
        }
      }

      // 2. OpenGraph Meta Tags fallback
      if (!name) {
        name = $('meta[property="og:title"]').attr('content') ||
               $('meta[name="twitter:title"]').attr('content') ||
               $('title').text().replace(/\|\s*Whop/i, '').trim();
      }

      if (!communityName) {
        communityName = $('meta[property="og:site_name"]').attr('content') || 'Whop Community';
      }

      if (!rewardRate) {
        const desc = $('meta[property="og:description"]').attr('content') || '';
        if (desc.includes('$') || desc.toLowerCase().includes('views')) {
          rewardRate = desc.substring(0, 80);
        }
      }

      // Final cleanups
      name = name.trim() || `Campaign ${campaignId}`;

      return {
        id: campaignId,
        whop_url: parsed.cleanUrl,
        name,
        community_name: communityName.trim(),
        reward_rate: rewardRate.trim()
      };
    } catch (err) {
      console.error('[Whop] Campaign Inspection Error:', err.message);
      throw err;
    }
  },

  // Submit a YouTube Short to the active Whop campaign
  async submitClip({ videoUrl, videoTitle, campaignId, campaignUrl }) {
    const token = dbService.getSetting('whop_session_token');
    if (!token) {
      throw new Error('Whop Session Token is not configured. Please paste your token in Settings.');
    }

    // Whop API endpoints for bounties / content rewards
    // Endpoint 1: https://whop.com/api/v2/content_rewards/submissions
    // Endpoint 2: GraphQL submission mutation
    const cleanToken = token.trim();
    const isFullCookie = cleanToken.includes('=');
    
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Content-Type': 'application/json',
      'Origin': 'https://whop.com',
      'Referer': campaignUrl || 'https://whop.com'
    };

    if (isFullCookie) {
      headers['Cookie'] = cleanToken;
    } else {
      headers['Authorization'] = `Bearer ${cleanToken.replace(/^Bearer\s+/i, '')}`;
      headers['Cookie'] = `whop.core.access_token=${cleanToken}; whop_session=${cleanToken}`;
    }

    console.log(`[Whop] Submitting clip ${videoUrl} to campaign ${campaignId}...`);

    try {
      // Primary Whop Content Rewards Submission API
      const response = await fetch('https://whop.com/api/v2/content_rewards/submissions', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          campaign_id: campaignId,
          content_url: videoUrl,
          platform: 'youtube',
          title: videoTitle
        })
      });

      // Handle Authentication Failure
      if (response.status === 401 || response.status === 403) {
        await telegramService.sendTokenExpiredAlert();
        throw new Error('Whop session expired or unauthorized (HTTP 401/403). Telegram alert sent.');
      }

      const text = await response.text();
      let data = {};
      try {
        data = JSON.parse(text);
      } catch (e) {
        data = { raw: text };
      }

      if (!response.ok) {
        const errorMsg = data.message || data.error || `HTTP ${response.status}: ${text.slice(0, 100)}`;
        throw new Error(errorMsg);
      }

      const submissionId = data.id || data.submission_id || 'sub_' + Date.now();
      console.log(`[Whop] Successfully submitted! Whop Submission ID: ${submissionId}`);

      return {
        success: true,
        submissionId,
        data
      };
    } catch (err) {
      console.error('[Whop] Submission Error:', err.message);
      throw err;
    }
  }
};
