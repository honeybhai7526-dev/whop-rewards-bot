import { dbService } from './db.js';

export const youtubeService = {
  // Extract channel handle or ID from input string
  cleanInput(input) {
    if (!input) return '';
    let val = input.trim();
    if (val.startsWith('http://') || val.startsWith('https://')) {
      try {
        const u = new URL(val);
        const parts = u.pathname.split('/').filter(Boolean);
        const handlePart = parts.find(p => p.startsWith('@'));
        const channelIndex = parts.indexOf('channel');
        if (handlePart) {
          val = handlePart;
        } else if (channelIndex !== -1 && parts[channelIndex + 1]) {
          val = parts[channelIndex + 1];
        } else if (parts.length > 0) {
          val = parts[0];
        }
      } catch (e) {
        // keep val as is
      }
    }
    return val;
  },

  // Resolve @handle or custom name to canonical channel_id (UC...)
  async resolveChannelId(input) {
    const raw = this.cleanInput(input);
    if (!raw) return null;

    // If already in UC... format
    if (/^UC[a-zA-Z0-9_-]{22}$/.test(raw)) {
      return raw;
    }

    const handle = raw.startsWith('@') ? raw : `@${raw}`;

    try {
      console.log(`[YouTube] Resolving handle ${handle} to Channel ID...`);
      const response = await fetch(`https://www.youtube.com/${handle}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch channel page: HTTP ${response.status}`);
      }

      const html = await response.text();

      // Search for channelId in various common YouTube meta/scripts
      const channelIdMatch = 
        html.match(/<meta itemprop="identifier" content="(UC[a-zA-Z0-9_-]{22})"/i) ||
        html.match(/<meta property="og:url" content="https:\/\/www\.youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})"/i) ||
        html.match(/"channelId":"(UC[a-zA-Z0-9_-]{22})"/i) ||
        html.match(/"externalId":"(UC[a-zA-Z0-9_-]{22})"/i);

      // Extract Avatar and Channel Title for UI verification
      const imgMatch = html.match(/<meta property="og:image" content="([^"]+)"/i);
      const titleMatch = html.match(/<meta property="og:title" content="([^"]+)"/i);

      if (imgMatch && imgMatch[1]) {
        dbService.setSetting('youtube_channel_avatar', imgMatch[1]);
      }
      if (titleMatch && titleMatch[1]) {
        dbService.setSetting('youtube_channel_title', titleMatch[1]);
      }

      if (channelIdMatch && channelIdMatch[1]) {
        console.log(`[YouTube] Resolved ${handle} -> ${channelIdMatch[1]} (${titleMatch ? titleMatch[1] : ''})`);
        return channelIdMatch[1];
      }

      throw new Error(`Could not locate Channel ID for ${handle}`);
    } catch (err) {
      console.error('[YouTube] Resolve Error:', err.message);
      return null;
    }
  },

  // Check if a video is a YouTube Short
  async checkIfShort(videoId) {
    try {
      const response = await fetch(`https://www.youtube.com/shorts/${videoId}`, {
        method: 'HEAD',
        redirect: 'manual',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      // Shorts return 200 or 302 to shorts URL. Regular videos usually 303/302 redirect to /watch?v=
      const location = response.headers.get('location') || '';
      if (response.status === 200 || location.includes('/shorts/')) {
        return true;
      }
      return false;
    } catch (e) {
      // Default to true so we don't miss valid submissions
      return true;
    }
  },

  // Fetch real Shorts directly from the channel's /shorts tab
  async fetchFromShortsPage(handle) {
    if (!handle) return [];
    const cleanHandle = handle.startsWith('@') ? handle : `@${handle}`;
    try {
      console.log(`[YouTube] Scraping Shorts tab for ${cleanHandle}...`);
      const response = await fetch(`https://www.youtube.com/${cleanHandle}/shorts`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch /shorts: HTTP ${response.status}`);
      }

      const html = await response.text();
      const rawMatches = [...html.matchAll(/\/shorts\/([a-zA-Z0-9_-]{11})/g)];
      const uniqueIds = [...new Set(rawMatches.map(m => m[1]))];

      if (uniqueIds.length === 0) {
        console.log(`[YouTube] No Shorts found on /shorts page.`);
        return [];
      }

      console.log(`[YouTube] Found ${uniqueIds.length} Short(s) on ${cleanHandle}:`, uniqueIds);

      const shorts = [];
      for (const id of uniqueIds.slice(0, 10)) {
        let title = `YouTube Short (${id})`;
        try {
          const vRes = await fetch(`https://www.youtube.com/shorts/${id}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
          });
          const vHtml = await vRes.text();
          const tMatch = vHtml.match(/<meta property="og:title" content="([^"]+)"/);
          if (tMatch && tMatch[1]) {
            title = tMatch[1].replace(/ - YouTube$/i, '').trim();
          }
        } catch (e) {}

        shorts.push({
          videoId: id,
          title,
          url: `https://www.youtube.com/shorts/${id}`,
          publishedAt: new Date().toISOString()
        });
      }

      return shorts;
    } catch (err) {
      console.error('[YouTube] Error scraping /shorts:', err.message);
      return [];
    }
  },

  // Fetch recent videos via RSS Atom feed
  async fetchFromRss(channelId) {
    try {
      const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
      const response = await fetch(rssUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });

      if (!response.ok) {
        throw new Error(`RSS feed returned status ${response.status}`);
      }

      const xml = await response.text();
      const entries = [];
      const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
      let match;

      while ((match = entryRegex.exec(xml)) !== null) {
        const item = match[1];
        const idMatch = item.match(/<yt:videoId>(.*?)<\/yt:videoId>/);
        const titleMatch = item.match(/<title>(.*?)<\/title>/);
        const pubMatch = item.match(/<published>(.*?)<\/published>/);

        if (idMatch && titleMatch) {
          const videoId = idMatch[1];
          entries.push({
            videoId,
            title: titleMatch[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
            url: `https://www.youtube.com/shorts/${videoId}`,
            publishedAt: pubMatch ? pubMatch[1] : new Date().toISOString()
          });
        }
      }

      return entries;
    } catch (err) {
      console.error('[YouTube] RSS Fetch error:', err.message);
      return [];
    }
  },

  // Fetch recent videos via YouTube Data API v3 (if key provided)
  async fetchFromApi(channelId, apiKey) {
    try {
      // Upload playlist is UC... with UC replaced by UU
      const uploadsPlaylistId = 'UU' + channelId.substring(2);
      const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=15&key=${apiKey}`;
      const response = await fetch(url);
      const data = await response.json();

      if (!data.items) {
        console.error('[YouTube API] Error response:', data.error?.message);
        return [];
      }

      return data.items.map(item => ({
        videoId: item.snippet.resourceId.videoId,
        title: item.snippet.title,
        url: `https://www.youtube.com/shorts/${item.snippet.resourceId.videoId}`,
        publishedAt: item.snippet.publishedAt
      }));
    } catch (err) {
      console.error('[YouTube API] Fetch error:', err.message);
      return [];
    }
  },

  // Master method to get latest shorts for connected channel
  async getLatestShorts() {
    let channelId = dbService.getSetting('youtube_channel_id');
    const handleOrInput = dbService.getSetting('youtube_handle');
    const apiKey = dbService.getSetting('youtube_api_key');

    if (!channelId && handleOrInput) {
      channelId = await this.resolveChannelId(handleOrInput);
      if (channelId) {
        dbService.setSetting('youtube_channel_id', channelId);
      }
    }

    if (!channelId) {
      return { error: 'No YouTube channel configured or could not resolve channel ID' };
    }

    let videos = [];
    // 1. Primary: Scrape /shorts page (always accurate for Shorts)
    if (handleOrInput) {
      videos = await this.fetchFromShortsPage(handleOrInput);
    }

    // 2. If API key provided and no videos found, try API
    if ((!videos || videos.length === 0) && apiKey) {
      videos = await this.fetchFromApi(channelId, apiKey);
    }

    // 3. Fallback to RSS
    if (!videos || videos.length === 0) {
      videos = await this.fetchFromRss(channelId);
    }

    return { channelId, videos };
  }
};
