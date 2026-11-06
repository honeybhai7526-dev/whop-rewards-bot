// State
let masterPin = localStorage.getItem('whop_bot_pin') || '';
let currentCampaign = null;
let inspectedCampaign = null;

// DOM Elements
const pinOverlay = document.getElementById('pinOverlay');
const pinInput = document.getElementById('pinInput');
const unlockBtn = document.getElementById('unlockBtn');
const pinError = document.getElementById('pinError');
const lockBtn = document.getElementById('lockBtn');

const checkNowBtn = document.getElementById('checkNowBtn');
const checkNowIcon = document.getElementById('checkNowIcon');

const campaignTitleDisplay = document.getElementById('campaignTitleDisplay');
const campaignMetaDisplay = document.getElementById('campaignMetaDisplay');
const activeBadge = document.getElementById('activeBadge');
const toggleChangeCampaignBtn = document.getElementById('toggleChangeCampaignBtn');
const campaignDrawer = document.getElementById('campaignDrawer');
const campaignUrlInput = document.getElementById('campaignUrlInput');
const inspectCampaignBtn = document.getElementById('inspectCampaignBtn');
const campaignPreviewCard = document.getElementById('campaignPreviewCard');
const previewTitle = document.getElementById('previewTitle');
const previewCommunity = document.getElementById('previewCommunity');
const previewRate = document.getElementById('previewRate');
const confirmCampaignBtn = document.getElementById('confirmCampaignBtn');

const statTotal = document.getElementById('statTotal');
const statSubmitted = document.getElementById('statSubmitted');
const statPending = document.getElementById('statPending');
const statFailed = document.getElementById('statFailed');
const channelDisplay = document.getElementById('channelDisplay');
const editChannelBtn = document.getElementById('editChannelBtn');
const submissionsTableBody = document.getElementById('submissionsTableBody');

// Settings modal
const settingsModal = document.getElementById('settingsModal');
const openSettingsBtn = document.getElementById('openSettingsBtn');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const cancelSettingsBtn = document.getElementById('cancelSettingsBtn');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const sendTgTestBtn = document.getElementById('sendTgTestBtn');
const tokenHelpTrigger = document.getElementById('tokenHelpTrigger');
const tokenHelpBox = document.getElementById('tokenHelpBox');

const settingYtHandle = document.getElementById('settingYtHandle');
const settingYtApiKey = document.getElementById('settingYtApiKey');
const settingWhopToken = document.getElementById('settingWhopToken');
const settingTgToken = document.getElementById('settingTgToken');
const settingTgChatId = document.getElementById('settingTgChatId');
const settingNotifySuccess = document.getElementById('settingNotifySuccess');
const settingMasterPin = document.getElementById('settingMasterPin');

// --- TOAST HELPER ---
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `p-4 rounded-2xl shadow-xl border text-sm font-semibold pointer-events-auto transition-all duration-300 transform translate-y-2 flex items-center justify-between gap-3 ${
    type === 'success' ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-200' :
    type === 'error' ? 'bg-rose-950/90 border-rose-500/50 text-rose-200' :
    'bg-slate-900/90 border-slate-700 text-slate-200'
  }`;

  toast.innerHTML = `
    <span>${message}</span>
    <button class="opacity-60 hover:opacity-100">&times;</button>
  `;

  toast.querySelector('button').onclick = () => toast.remove();
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.remove('translate-y-2');
  }, 10);

  setTimeout(() => {
    toast.remove();
  }, 4500);
}

// --- API FETCH WRAPPER WITH PIN ---
async function apiFetch(endpoint, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'x-app-pin': masterPin,
    ...(options.headers || {})
  };

  const res = await fetch(endpoint, { ...options, headers });
  if (res.status === 401) {
    showPinOverlay();
    throw new Error('Unauthorized Master PIN');
  }
  return res;
}

// --- PIN OVERLAY HANDLING ---
function showPinOverlay() {
  pinOverlay.classList.remove('hidden');
  pinInput.value = '';
  pinError.classList.add('hidden');
  pinInput.focus();
}

function hidePinOverlay() {
  pinOverlay.classList.add('hidden');
}

unlockBtn.onclick = async () => {
  const pin = pinInput.value.trim();
  if (!pin) return;

  try {
    const res = await fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin })
    });

    if (res.ok) {
      masterPin = pin;
      localStorage.setItem('whop_bot_pin', pin);
      hidePinOverlay();
      loadAllData();
      showToast('Dashboard unlocked', 'success');
    } else {
      pinError.textContent = 'Incorrect Master PIN. Please try again.';
      pinError.classList.remove('hidden');
    }
  } catch (err) {
    pinError.textContent = 'Connection error. Check server.';
    pinError.classList.remove('hidden');
  }
};

pinInput.onkeydown = (e) => {
  if (e.key === 'Enter') unlockBtn.click();
};

lockBtn.onclick = () => {
  masterPin = '';
  localStorage.removeItem('whop_bot_pin');
  showPinOverlay();
};

// --- DATA LOADING ---
async function loadStatus() {
  try {
    const res = await apiFetch('/api/status');
    const data = await res.json();

    // Stats
    statTotal.textContent = data.stats.total || 0;
    statSubmitted.textContent = data.stats.submitted || 0;
    statPending.textContent = data.stats.pending || 0;
    statFailed.textContent = data.stats.failed || 0;

    // Active campaign
    currentCampaign = data.activeCampaign;
    if (currentCampaign) {
      campaignTitleDisplay.textContent = currentCampaign.name;
      campaignMetaDisplay.textContent = `${currentCampaign.community_name || 'Whop Campaign'} ${currentCampaign.reward_rate ? '• ' + currentCampaign.reward_rate : ''}`;
      activeBadge.classList.remove('hidden');
    } else {
      campaignTitleDisplay.textContent = 'No Campaign Configured';
      campaignMetaDisplay.textContent = 'Paste a Whop Content Rewards campaign URL below to begin auto-submitting.';
      activeBadge.classList.add('hidden');
    }

    // YouTube Channel
    const channelAvatar = document.getElementById('channelAvatar');
    const channelDefaultIcon = document.getElementById('channelDefaultIcon');
    const channelTitleDisplay = document.getElementById('channelTitleDisplay');
    const channelHandleDisplay = document.getElementById('channelHandleDisplay');
    const channelVerifiedBadge = document.getElementById('channelVerifiedBadge');

    if (data.channel.handle) {
      channelTitleDisplay.textContent = data.channel.title || data.channel.handle;
      channelHandleDisplay.textContent = `${data.channel.handle} ${data.channel.channelId ? '• ' + data.channel.channelId : ''}`;
      channelVerifiedBadge.classList.remove('hidden');

      if (data.channel.avatar) {
        channelAvatar.src = data.channel.avatar;
        channelAvatar.classList.remove('hidden');
        channelDefaultIcon.classList.add('hidden');
      } else {
        channelAvatar.classList.add('hidden');
        channelDefaultIcon.classList.remove('hidden');
      }
    } else {
      channelTitleDisplay.textContent = 'Not Configured';
      channelHandleDisplay.textContent = 'Enter your handle in settings';
      channelVerifiedBadge.classList.add('hidden');
      channelAvatar.classList.add('hidden');
      channelDefaultIcon.classList.remove('hidden');
    }
  } catch (err) {
    console.error('Failed to load status:', err);
  }
}

async function loadSubmissions() {
  try {
    const res = await apiFetch('/api/submissions');
    const data = await res.json();
    renderSubmissions(data.submissions || []);
  } catch (err) {
    console.error('Failed to load submissions:', err);
  }
}

function renderSubmissions(list) {
  if (list.length === 0) {
    submissionsTableBody.innerHTML = `
      <tr>
        <td colspan="5" class="px-6 py-12 text-center text-slate-500">
          <i data-lucide="inbox" class="w-8 h-8 mx-auto mb-2 opacity-50"></i>
          No clips detected yet. Connect your YouTube channel in settings to begin!
        </td>
      </tr>
    `;
    lucide.createIcons();
    return;
  }

  submissionsTableBody.innerHTML = list.map(item => {
    let statusBadge = '';
    let actionBtn = '';

    const dateFormatted = new Date(item.published_at).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    if (item.status === 'submitted') {
      statusBadge = `
        <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          <i data-lucide="check" class="w-3.5 h-3.5"></i> Submitted
        </span>
      `;
      actionBtn = `
        <a href="${item.video_url}" target="_blank" class="text-xs font-semibold text-slate-400 hover:text-white inline-flex items-center gap-1">
          <span>View</span> <i data-lucide="external-link" class="w-3 h-3"></i>
        </a>
      `;
    } else if (item.status === 'retrying') {
      statusBadge = `
        <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20" title="${item.last_error || ''}">
          <i data-lucide="clock" class="w-3.5 h-3.5"></i> Retrying (${item.attempts}/3)
        </span>
      `;
      actionBtn = `
        <button onclick="submitItem('${item.video_id}')" class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-orange-400 hover:text-orange-300 rounded-lg border border-slate-700 transition">
          Retry Now
        </button>
      `;
    } else if (item.status === 'failed') {
      statusBadge = `
        <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20" title="${item.last_error || ''}">
          <i data-lucide="alert-circle" class="w-3.5 h-3.5"></i> Failed
        </span>
      `;
      actionBtn = `
        <button onclick="submitItem('${item.video_id}')" class="px-3 py-1.5 bg-rose-950/60 hover:bg-rose-900/60 text-xs font-semibold text-rose-300 rounded-lg border border-rose-800/50 transition">
          Retry
        </button>
      `;
    } else {
      statusBadge = `
        <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-800 text-slate-400 border border-slate-700">
          Pending
        </span>
      `;
      actionBtn = `
        <button onclick="submitItem('${item.video_id}')" class="px-3 py-1.5 bg-orange-500/10 hover:bg-orange-500/20 text-xs font-semibold text-orange-400 rounded-lg border border-orange-500/30 transition">
          Submit
        </button>
      `;
    }

    return `
      <tr class="hover:bg-slate-900/40 transition">
        <td class="px-6 py-4 font-semibold text-white max-w-xs truncate">
          <a href="${item.video_url}" target="_blank" class="hover:text-orange-400 transition flex items-center gap-2">
            <i data-lucide="play-circle" class="w-4 h-4 text-red-500 shrink-0"></i>
            <span class="truncate">${item.video_title}</span>
          </a>
        </td>
        <td class="px-6 py-4">
          <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <i data-lucide="eye" class="w-3.5 h-3.5"></i> ${item.views || '0 views'}
          </span>
        </td>
        <td class="px-6 py-4 text-xs text-slate-400">${dateFormatted}</td>
        <td class="px-6 py-4 text-xs text-slate-300">${item.campaign_name || '—'}</td>
        <td class="px-6 py-4">${statusBadge}</td>
        <td class="px-6 py-4 text-right">${actionBtn}</td>
      </tr>
    `;
  }).join('');

  lucide.createIcons();
}

// Refresh real-time views button
const refreshViewsBtn = document.getElementById('refreshViewsBtn');
if (refreshViewsBtn) {
  refreshViewsBtn.onclick = async () => {
    try {
      showToast('Refreshing real-time views from YouTube...', 'info');
      refreshViewsBtn.classList.add('animate-pulse');
      const res = await apiFetch('/api/submissions/refresh-views', { method: 'POST' });
      const data = await res.json();
      if (data.success && data.submissions) {
        renderSubmissions(data.submissions);
        showToast('Real-time views updated!', 'success');
      }
    } catch (e) {
      showToast('Failed to refresh views', 'error');
    } finally {
      refreshViewsBtn.classList.remove('animate-pulse');
    }
  };
}

window.submitItem = async (videoId) => {
  try {
    showToast('Retrying submission to Whop...', 'info');
    const res = await apiFetch(`/api/submissions/${videoId}/retry`, { method: 'POST' });
    const data = await res.json();

    if (data.success && data.submission.status === 'submitted') {
      showToast('Clip submitted successfully to Whop! Telegram notified.', 'success');
    } else {
      const errMsg = data.submission?.last_error || 'Submission error';
      showToast(`Retry failed: ${errMsg}. Telegram notified.`, 'error');
    }
    loadAllData();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

// --- CAMPAIGN MANAGEMENT ---
toggleChangeCampaignBtn.onclick = () => {
  campaignDrawer.classList.toggle('hidden');
};

inspectCampaignBtn.onclick = async () => {
  const url = campaignUrlInput.value.trim();
  if (!url) {
    showToast('Please enter a Whop campaign link', 'error');
    return;
  }

  inspectCampaignBtn.disabled = true;
  inspectCampaignBtn.innerHTML = `<span class="animate-spin mr-1">⏳</span> Verifying...`;

  try {
    const res = await apiFetch('/api/campaign/inspect', {
      method: 'POST',
      body: JSON.stringify({ url })
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error);

    inspectedCampaign = data.campaign;
    previewTitle.textContent = inspectedCampaign.name;
    previewCommunity.textContent = inspectedCampaign.community_name || 'Whop Community';
    previewRate.textContent = inspectedCampaign.reward_rate || '';
    campaignPreviewCard.classList.remove('hidden');

    showToast(`Found: ${inspectedCampaign.name}`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    inspectCampaignBtn.disabled = false;
    inspectCampaignBtn.innerHTML = `<i data-lucide="search" class="w-4 h-4"></i><span>Verify Campaign</span>`;
    lucide.createIcons();
  }
};

confirmCampaignBtn.onclick = async () => {
  if (!inspectedCampaign) return;

  try {
    const res = await apiFetch('/api/campaign/set-active', {
      method: 'POST',
      body: JSON.stringify(inspectedCampaign)
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error);

    showToast(`Locked in "${data.activeCampaign.name}" as active campaign!`, 'success');
    campaignDrawer.classList.add('hidden');
    campaignPreviewCard.classList.add('hidden');
    campaignUrlInput.value = '';
    loadAllData();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

// --- MANUAL CHECK NOW ---
checkNowBtn.onclick = async () => {
  checkNowBtn.disabled = true;
  checkNowIcon.classList.add('animate-spin');

  try {
    const res = await apiFetch('/api/check-now', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showToast(`Scan complete: ${data.result.newCount || 0} new Shorts detected`, 'success');
      loadAllData();
    } else {
      showToast(data.result?.message || 'Check error', 'error');
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    checkNowBtn.disabled = false;
    checkNowIcon.classList.remove('animate-spin');
  }
};

// --- SETTINGS MODAL ---
openSettingsBtn.onclick = async () => {
  try {
    const res = await apiFetch('/api/settings');
    const data = await res.json();

    settingYtHandle.value = data.youtube_handle || '';
    settingYtApiKey.value = data.youtube_api_key || '';
    settingWhopToken.value = data.whop_session_token || '';
    settingTgToken.value = data.telegram_bot_token || '';
    settingTgChatId.value = data.telegram_chat_id || '';
    settingNotifySuccess.checked = data.notify_on_success === '1';
    settingMasterPin.value = '';

    settingsModal.classList.remove('hidden');
    lucide.createIcons();
  } catch (err) {
    showToast('Failed to load settings', 'error');
  }
};

editChannelBtn.onclick = () => openSettingsBtn.click();
closeSettingsBtn.onclick = () => settingsModal.classList.add('hidden');
cancelSettingsBtn.onclick = () => settingsModal.classList.add('hidden');

tokenHelpTrigger.onclick = () => {
  tokenHelpBox.classList.toggle('hidden');
};

saveSettingsBtn.onclick = async () => {
  try {
    const payload = {
      youtube_handle: settingYtHandle.value,
      youtube_api_key: settingYtApiKey.value,
      whop_session_token: settingWhopToken.value,
      telegram_bot_token: settingTgToken.value,
      telegram_chat_id: settingTgChatId.value,
      notify_on_success: settingNotifySuccess.checked,
      master_pin: settingMasterPin.value || undefined
    };

    const res = await apiFetch('/api/settings', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error);

    if (payload.master_pin) {
      masterPin = payload.master_pin;
      localStorage.setItem('whop_bot_pin', masterPin);
    }

    showToast('Settings saved successfully!', 'success');
    settingsModal.classList.add('hidden');
    loadAllData();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

sendTgTestBtn.onclick = async () => {
  sendTgTestBtn.disabled = true;
  sendTgTestBtn.textContent = 'Sending...';

  try {
    const res = await apiFetch('/api/telegram/test', {
      method: 'POST',
      body: JSON.stringify({
        bot_token: settingTgToken.value,
        chat_id: settingTgChatId.value
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast('Test alert sent to your Telegram!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    sendTgTestBtn.disabled = false;
    sendTgTestBtn.textContent = 'Test Alert';
  }
};

// --- INIT ---
function loadAllData() {
  loadStatus();
  loadSubmissions();
}

if (!masterPin) {
  showPinOverlay();
} else {
  hidePinOverlay();
  loadAllData();
}

lucide.createIcons();

// Periodic live refresh every 30 seconds
setInterval(() => {
  if (masterPin && pinOverlay.classList.contains('hidden')) {
    loadAllData();
  }
}, 30000);
