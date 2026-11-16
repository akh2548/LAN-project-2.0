// LAN Monitor — Handcrafted Client Controller

let devices = [];
let events = [];
let systemInfo = null;
let soundEnabled = true;
let isScanning = false;
let activeFilter = 'all';
let eventSource = null;

// DOM Elements
const sseStatusBadge = document.getElementById('sseStatusBadge');
const sseDot = document.getElementById('sseDot');
const sseStatusText = document.getElementById('sseStatusText');

const btnAudioToggle = document.getElementById('btnAudioToggle');
const audioIcon = document.getElementById('audioIcon');
const audioText = document.getElementById('audioText');
const btnRouterHelp = document.getElementById('btnRouterHelp');
const btnLogout = document.getElementById('btnLogout');
const userProfileBadge = document.getElementById('userProfileBadge');
const userNameLabel = document.getElementById('userNameLabel');
const userRoleBadge = document.getElementById('userRoleBadge');
const btnManageUsers = document.getElementById('btnManageUsers');
const usersModal = document.getElementById('usersModal');
const btnCloseUsersModal = document.getElementById('btnCloseUsersModal');
const btnCloseUsersModalBtn = document.getElementById('btnCloseUsersModalBtn');
const usersTableBody = document.getElementById('usersTableBody');

let currentUser = null;

const valAdapter = document.getElementById('valAdapter');
const valHostIp = document.getElementById('valHostIp');
const valSubnet = document.getElementById('valSubnet');
const valGateway = document.getElementById('valGateway');
const ifaceTag = document.getElementById('ifaceTag');
const interfaceNoticeText = document.getElementById('interfaceNoticeText');

const statTotalDevices = document.getElementById('statTotalDevices');
const statOnlineDevices = document.getElementById('statOnlineDevices');
const statUntrustedDevices = document.getElementById('statUntrustedDevices');
const statLastScan = document.getElementById('statLastScan');
const statLastScanDuration = document.getElementById('statLastScanDuration');

const btnScanNow = document.getElementById('btnScanNow');
const btnStopScan = document.getElementById('btnStopScan');
const scanSpinner = document.getElementById('scanSpinner');
const scanProgressContainer = document.getElementById('scanProgressContainer');
const scanProgressBar = document.getElementById('scanProgressBar');
const scanProgressLabel = document.getElementById('scanProgressLabel');
const scanProgressPercent = document.getElementById('scanProgressPercent');
const autoScanSelect = document.getElementById('autoScanSelect');

const searchInput = document.getElementById('searchInput');
const filterTabs = document.querySelectorAll('.filter-tab');
const countAll = document.getElementById('countAll');
const countOnline = document.getElementById('countOnline');
const countOffline = document.getElementById('countOffline');
const countUntrusted = document.getElementById('countUntrusted');

const devicesTableBody = document.getElementById('devicesTableBody');
const eventList = document.getElementById('eventList');
const eventFilterType = document.getElementById('eventFilterType');

const routerModal = document.getElementById('routerModal');
const btnCloseRouterModal = document.getElementById('btnCloseRouterModal');
const routerPortalLink = document.getElementById('routerPortalLink');
const routerPortalIpText = document.getElementById('routerPortalIpText');
const routerGuidesContainer = document.getElementById('routerGuidesContainer');

const editDeviceModal = document.getElementById('editDeviceModal');
const btnCloseEditModal = document.getElementById('btnCloseEditModal');
const btnCancelEdit = document.getElementById('btnCancelEdit');
const editDeviceForm = document.getElementById('editDeviceForm');
const editDeviceId = document.getElementById('editDeviceId');
const editDeviceIp = document.getElementById('editDeviceIp');
const editDeviceMac = document.getElementById('editDeviceMac');
const editDeviceName = document.getElementById('editDeviceName');
const editDeviceTrust = document.getElementById('editDeviceTrust');
const editDeviceNotes = document.getElementById('editDeviceNotes');

const liveAlertContainer = document.getElementById('liveAlertContainer');

// Subtle Web Audio Chime (Offline, synthesized)
function playNotificationChime(severity = 'INFO') {
  if (!soundEnabled) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    const baseFreq = severity === 'CRITICAL' ? 784 : 523.25; // G5 or C5
    osc.frequency.setValueAtTime(baseFreq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.33, ctx.currentTime + 0.12);

    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.28);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.28);
  } catch {
    // Ignore audio permission blocks
  }
}

// Lifecycle Init
async function init() {
  bindEvents();
  try {
    const response = await fetch('/api/auth/status');
    if (!response.ok) throw new Error('Unable to verify user session.');
    const authStatus = await response.json();
    if (!authStatus.authenticated) {
      if (!authStatus.setupComplete && !authStatus.hasUsers) {
        window.location.replace('/register.html');
      } else {
        window.location.replace('/login.html');
      }
      return;
    }

    currentUser = authStatus.user;
    if (currentUser) {
      userNameLabel.textContent = currentUser.full_name || currentUser.username;
      userRoleBadge.textContent = currentUser.role.toUpperCase();
      userRoleBadge.className = currentUser.role === 'admin' ? 'tag tag-blue' : 'tag tag-gray';
      userProfileBadge.style.display = 'inline-flex';

      if (currentUser.role === 'admin') {
        btnManageUsers.style.display = 'inline-flex';
      } else {
        btnScanNow.disabled = true;
        btnScanNow.title = 'Administrator privileges required to initiate sweeps.';
        btnScanNow.style.opacity = '0.5';
      }
    }
  } catch (error) {
    console.error('Session check failed:', error);
    return;
  }

  window.setInterval(async () => {
    try {
      const response = await fetch('/api/auth/status');
      if (!response.ok) throw new Error('Unable to verify user session.');
      const authStatus = await response.json();
      if (!authStatus.authenticated) window.location.replace('/login.html');
    } catch (error) {
      console.error('Session refresh failed:', error);
    }
  }, 60 * 1000);

  connectSSE();
  await Promise.all([
    fetchSystemInfo(),
    fetchStats(),
    fetchDevices(),
    fetchEvents()
  ]);
}

function bindEvents() {
  btnAudioToggle.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    audioIcon.textContent = soundEnabled ? '🔔' : '🔕';
    audioText.textContent = soundEnabled ? 'Sound On' : 'Muted';
    btnAudioToggle.style.opacity = soundEnabled ? '1' : '0.6';
  });

  btnScanNow.addEventListener('click', triggerScan);
  btnStopScan.addEventListener('click', cancelScan);

  searchInput.addEventListener('input', renderDeviceTable);

  filterTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      filterTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeFilter = tab.dataset.filter;
      renderDeviceTable();
    });
  });

  eventFilterType.addEventListener('change', () => fetchEvents(eventFilterType.value));

  btnRouterHelp.addEventListener('click', showRouterModal);
  btnManageUsers.addEventListener('click', showUsersModal);
  btnCloseUsersModal.addEventListener('click', () => usersModal.style.display = 'none');
  btnCloseUsersModalBtn.addEventListener('click', () => usersModal.style.display = 'none');
  usersModal.addEventListener('click', (e) => {
    if (e.target === usersModal) usersModal.style.display = 'none';
  });

  btnLogout.addEventListener('click', async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.assign('/login.html');
    } catch (error) {
      console.error('Sign out failed:', error);
      window.location.assign('/login.html');
    }
  });
  btnCloseRouterModal.addEventListener('click', () => routerModal.style.display = 'none');
  routerModal.addEventListener('click', (e) => {
    if (e.target === routerModal) routerModal.style.display = 'none';
  });

  btnCloseEditModal.addEventListener('click', () => editDeviceModal.style.display = 'none');
  btnCancelEdit.addEventListener('click', () => editDeviceModal.style.display = 'none');
  editDeviceModal.addEventListener('click', (e) => {
    if (e.target === editDeviceModal) editDeviceModal.style.display = 'none';
  });

  editDeviceForm.addEventListener('submit', saveDeviceProfile);

  // Keyboard shortcut '/' to search
  window.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== searchInput) {
      e.preventDefault();
      searchInput.focus();
    }
  });
}

// System Diagnostics & Network Info
async function fetchSystemInfo() {
  try {
    const res = await fetch('/api/system/info');
    systemInfo = await res.json();
    updateInterfaceView(systemInfo);
  } catch (err) {
    console.error('System info fetch failed:', err);
  }
}

function updateInterfaceView(info) {
  if (!info) return;

  const active = info.activeInterface;
  if (active) {
    valAdapter.textContent = active.description || active.name || 'Wired Adapter';
    valHostIp.textContent = active.ip || 'Unavailable';
    valGateway.textContent = active.gateway || 'None detected';
    ifaceTag.textContent = active.isWired ? 'Wired Ethernet' : 'Local Adapter';
  } else {
    valAdapter.textContent = 'No Wired Adapter';
    valHostIp.textContent = 'Disconnected';
    valGateway.textContent = 'None';
  }

  if (info.subnet) {
    valSubnet.textContent = `${info.subnet.networkAddress}/${info.subnet.cidr} (${info.subnet.totalHosts} hosts)`;
  } else {
    valSubnet.textContent = 'Unknown';
  }

  if (info.modeNotice) {
    interfaceNoticeText.textContent = info.modeNotice;
  }
}

// Stats & Metrics
async function fetchStats() {
  try {
    const res = await fetch('/api/stats');
    const data = await res.json();
    statTotalDevices.textContent = data.totalDevices;
    statOnlineDevices.textContent = data.onlineDevices;
    statUntrustedDevices.textContent = data.untrustedDevices;

    if (data.lastScan && data.lastScan.completed_at) {
      statLastScan.textContent = formatHumanTime(data.lastScan.completed_at);
      if (data.lastScan.duration_ms) {
        statLastScanDuration.textContent = `Completed in ${(data.lastScan.duration_ms / 1000).toFixed(1)}s`;
      }
    } else {
      statLastScan.textContent = 'Never';
    }
  } catch (err) {
    console.error('Stats fetch failed:', err);
  }
}

// Discovered Devices
async function fetchDevices() {
  try {
    const res = await fetch('/api/devices');
    devices = await res.json();
    updateFilterCounts();
    renderDeviceTable();
  } catch (err) {
    console.error('Device fetch failed:', err);
  }
}

function updateFilterCounts() {
  countAll.textContent = devices.length;
  countOnline.textContent = devices.filter(d => d.status === 'online').length;
  countOffline.textContent = devices.filter(d => d.status === 'unreachable').length;
  countUntrusted.textContent = devices.filter(d => d.trust_level === 'untrusted').length;
}

function renderDeviceTable() {
  const query = searchInput.value.toLowerCase().trim();
  const hostIp = systemInfo?.activeInterface?.ip;
  const gatewayIp = systemInfo?.activeInterface?.gateway;

  const filtered = devices.filter(dev => {
    // Filter tab check
    if (activeFilter === 'online' && dev.status !== 'online') return false;
    if (activeFilter === 'offline' && dev.status === 'online') return false;
    if (activeFilter === 'untrusted' && dev.trust_level !== 'untrusted') return false;

    // Search query check
    if (query) {
      const haystack = [
        dev.last_ip,
        dev.mac_address,
        dev.custom_name,
        dev.hostname,
        dev.vendor
      ].join(' ').toLowerCase();
      return haystack.includes(query);
    }
    return true;
  });

  if (filtered.length === 0) {
    devicesTableBody.innerHTML = `
      <tr>
        <td colspan="8" class="empty-state">
          No devices match the current filter or search criteria.
        </td>
      </tr>
    `;
    return;
  }

  devicesTableBody.innerHTML = filtered.map(dev => {
    const isOnline = dev.status === 'online';
    const isHostPc = hostIp && dev.last_ip === hostIp;
    const isGateway = gatewayIp && dev.last_ip === gatewayIp;

    // Status pill
    const statusHtml = isOnline
      ? '<span class="status-pill status-online"><span class="status-dot"></span>Online</span>'
      : '<span class="status-pill status-offline"><span class="status-dot"></span>Offline</span>';

    // Role tags
    let roleTag = '';
    if (isHostPc) {
      roleTag = '<span class="tag tag-blue">This PC (Wired)</span>';
    } else if (isGateway) {
      roleTag = '<span class="tag tag-purple">Router Gateway</span>';
    }

    // Name display
    const primaryName = dev.custom_name || (isGateway ? 'Router Gateway' : (isHostPc ? 'This Computer' : 'Wired Device'));
    const hostnameSub = dev.hostname 
      ? `<div class="device-sub">${escape(dev.hostname)}</div>`
      : `<div class="device-sub" style="opacity: 0.5;">Hostname unassigned</div>`;

    // Trust badge
    let trustHtml = '<span class="tag tag-amber">Untrusted</span>';
    if (dev.trust_level === 'trusted') {
      trustHtml = '<span class="tag tag-green">Trusted</span>';
    } else if (dev.trust_level === 'familiar') {
      trustHtml = '<span class="tag tag-blue">Familiar</span>';
    }

    // Randomized MAC indicator
    const randomBadge = dev.is_randomized_mac
      ? '<span class="tag tag-purple" title="Locally Administered / Privacy MAC">Private MAC</span> '
      : '';

    return `
      <tr>
        <td>${statusHtml}</td>
        <td>
          <span class="mono-ip" title="Click to copy IP" onclick="copyText('${dev.last_ip}')" style="cursor: pointer;">
            ${escape(dev.last_ip)}
          </span>
        </td>
        <td>
          <div class="device-title">
            <span>${escape(primaryName)}</span>
            ${roleTag}
          </div>
          ${hostnameSub}
        </td>
        <td>
          <span class="mono-mac" title="Click to copy MAC" onclick="copyText('${dev.mac_address}')" style="cursor: pointer;">
            ${randomBadge}${escape(dev.mac_address || 'Unavailable')}
          </span>
        </td>
        <td>
          <span class="tag tag-gray">${escape(dev.vendor || 'Unknown')}</span>
        </td>
        <td>${trustHtml}</td>
        <td title="${dev.last_seen}">${formatHumanTime(dev.last_seen)}</td>
        <td style="text-align: right;">
          <button class="btn btn-outline btn-sm" onclick="openEditModal(${dev.id})">
            Edit
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

// Activity Log & Audit Trail
async function fetchEvents(typeFilter = '') {
  try {
    const url = typeFilter ? `/api/events?type=${encodeURIComponent(typeFilter)}` : '/api/events';
    const res = await fetch(url);
    events = await res.json();
    renderEventFeed();
  } catch (err) {
    console.error('Events fetch failed:', err);
  }
}

function renderEventFeed() {
  if (events.length === 0) {
    eventList.innerHTML = '<div class="empty-state">No security events recorded in this session.</div>';
    return;
  }

  eventList.innerHTML = events.slice(0, 25).map(ev => {
    let tagClass = 'tag-gray';
    if (ev.severity === 'CRITICAL') tagClass = 'tag-amber';
    else if (ev.event_type === 'DEVICE_NEW') tagClass = 'tag-purple';
    else if (ev.event_type === 'DEVICE_ONLINE') tagClass = 'tag-green';

    return `
      <div class="event-entry">
        <div class="event-entry-left">
          <span class="tag ${tagClass}">${escape(ev.event_type)}</span>
          <span>${escape(ev.message)}</span>
        </div>
        <span class="event-time" title="${ev.created_at}">${formatHumanTime(ev.created_at)}</span>
      </div>
    `;
  }).join('');
}

// Trigger / Stop Subnet Scans
async function triggerScan() {
  if (isScanning) return;
  setScanningState(true);

  try {
    const res = await fetch('/api/scan/start', { method: 'POST' });
    if (!res.ok && res.status !== 202) {
      const err = await res.json();
      showToast('Scan Error', err.error || 'Failed to start sweep', 'danger');
      setScanningState(false);
    }
  } catch (err) {
    showToast('Scan Error', err.message, 'danger');
    setScanningState(false);
  }
}

async function cancelScan() {
  try {
    await fetch('/api/scan/stop', { method: 'POST' });
    setScanningState(false);
    showToast('Scan Paused', 'Wired discovery stopped by admin.', 'info');
  } catch (err) {
    console.error('Cancel error:', err);
  }
}

function setScanningState(scanning) {
  isScanning = scanning;
  btnScanNow.style.display = scanning ? 'none' : 'inline-flex';
  btnStopScan.style.display = scanning ? 'inline-flex' : 'none';
  scanSpinner.style.display = scanning ? 'inline-block' : 'none';
  scanProgressContainer.style.display = scanning ? 'block' : 'none';

  if (!scanning) {
    scanProgressBar.style.width = '0%';
  }
}

// Real-Time Server-Sent Events (SSE)
function connectSSE() {
  if (eventSource) eventSource.close();

  eventSource = new EventSource('/api/stream');

  eventSource.onopen = () => {
    sseDot.classList.add('connected');
    sseStatusText.textContent = 'Live Synced';
  };

  eventSource.onerror = () => {
    sseDot.classList.remove('connected');
    sseStatusText.textContent = 'Reconnecting...';
  };

  eventSource.addEventListener('scan_started', () => {
    setScanningState(true);
    scanProgressLabel.textContent = 'Broadcasting rate-limited probes across wired subnet...';
  });

  eventSource.addEventListener('scan_progress', (e) => {
    const p = JSON.parse(e.data);
    scanProgressBar.style.width = `${p.percent}%`;
    scanProgressPercent.textContent = `${p.percent}%`;
    scanProgressLabel.textContent = `Probing ${p.currentIp || 'hosts'} (${p.scanned}/${p.total}) — ${p.devicesFound} devices identified`;
  });

  eventSource.addEventListener('scan_completed', (e) => {
    const d = JSON.parse(e.data);
    setScanningState(false);
    fetchStats();
    fetchDevices();
    fetchEvents();

    showToast(
      'Sweep Complete',
      `Found ${d.devicesFound} active hosts on wired switch in ${(d.summary.durationMs / 1000).toFixed(1)}s.`,
      'info'
    );
  });

  eventSource.addEventListener('alert', (e) => {
    const alertData = JSON.parse(e.data);
    playNotificationChime(alertData.severity);
    showToast(alertData.eventType, alertData.message, alertData.severity === 'CRITICAL' ? 'danger' : 'warning');
    fetchEvents();
    fetchStats();
    fetchDevices();
  });

  eventSource.addEventListener('device_updated', () => {
    fetchDevices();
    fetchStats();
  });
}

// Toast Notifications
function showToast(title, message, severity = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${severity}`;
  toast.innerHTML = `
    <strong>${escape(title)}</strong>
    <div style="margin-top: 2px; color: var(--text-secondary); font-size: 12px;">${escape(message)}</div>
  `;
  liveAlertContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

// Modal Handlers
window.openEditModal = function(id) {
  const dev = devices.find(d => d.id === id);
  if (!dev) return;

  editDeviceId.value = dev.id;
  editDeviceIp.value = dev.last_ip;
  editDeviceMac.value = dev.mac_address || '';
  editDeviceName.value = dev.custom_name || '';
  editDeviceTrust.value = dev.trust_level || 'untrusted';
  editDeviceNotes.value = dev.notes || '';

  editDeviceModal.style.display = 'flex';
};

async function saveDeviceProfile(e) {
  e.preventDefault();
  const id = editDeviceId.value;
  const payload = {
    custom_name: editDeviceName.value.trim() || null,
    trust_level: editDeviceTrust.value,
    notes: editDeviceNotes.value.trim() || null
  };

  try {
    const res = await fetch(`/api/devices/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      editDeviceModal.style.display = 'none';
      await fetchDevices();
      await fetchStats();
      showToast('Profile Saved', 'Custom device alias and trust settings updated.', 'info');
    }
  } catch (err) {
    alert('Failed to save profile: ' + err.message);
  }
}

async function showRouterModal() {
  try {
    const res = await fetch('/api/router/info');
    const guidance = await res.json();

    routerPortalIpText.textContent = guidance.gatewayIp;
    routerPortalLink.href = guidance.portalUrl;

    routerGuidesContainer.innerHTML = guidance.routerGuides.map(g => `
      <div class="router-guide-card">
        <h4>${escape(g.brand)} (${escape(g.defaultIp)})</h4>
        <ol>
          ${g.steps.map(s => `<li>${escape(s)}</li>`).join('')}
        </ol>
      </div>
    `).join('');

    routerModal.style.display = 'flex';
  } catch (err) {
    console.error('Failed to load router info:', err);
  }
}

async function showUsersModal() {
  usersModal.style.display = 'flex';
  usersTableBody.innerHTML = '<tr><td colspan="5" class="empty-state">Loading users...</td></tr>';
  try {
    const res = await fetch('/api/users');
    if (!res.ok) {
      usersTableBody.innerHTML = '<tr><td colspan="5" class="empty-state">Failed to load users.</td></tr>';
      return;
    }
    const userList = await res.json();
    if (userList.length === 0) {
      usersTableBody.innerHTML = '<tr><td colspan="5" class="empty-state">No users registered.</td></tr>';
      return;
    }
    usersTableBody.innerHTML = userList.map(u => `
      <tr>
        <td class="mono-ip">${escape(u.username)}</td>
        <td>${escape(u.full_name || '—')}</td>
        <td>
          <select class="select-input select-sm" onchange="changeUserRole(${u.id}, this.value)" ${u.id === currentUser?.id ? 'disabled' : ''}>
            <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
            <option value="user" ${u.role === 'user' ? 'selected' : ''}>User</option>
          </select>
        </td>
        <td>${formatHumanTime(u.created_at)}</td>
        <td>
          ${u.id !== currentUser?.id ? `
            <button class="btn btn-danger btn-sm" onclick="deleteUserAccount(${u.id})">Delete</button>
          ` : '<span class="tag tag-blue">You</span>'}
        </td>
      </tr>
    `).join('');
  } catch (err) {
    usersTableBody.innerHTML = `<tr><td colspan="5" class="empty-state">${escape(err.message)}</td></tr>`;
  }
}

window.changeUserRole = async function(id, role) {
  try {
    const res = await fetch(`/api/users/${id}/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role })
    });
    if (!res.ok) throw new Error('Failed to update role');
    showToast('Role Updated', 'User role has been updated.', 'info');
  } catch (err) {
    showToast('Update Failed', err.message, 'danger');
  }
};

window.deleteUserAccount = async function(id) {
  if (!confirm('Are you sure you want to delete this user account?')) return;
  try {
    const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete user');
    showToast('User Deleted', 'Account removed.', 'info');
    showUsersModal();
  } catch (err) {
    showToast('Delete Failed', err.message, 'danger');
  }
};

// Utilities
function copyText(str) {
  if (!str) return;
  navigator.clipboard.writeText(str).then(() => {
    showToast('Copied to Clipboard', str, 'info');
  }).catch(() => {});
}

function escape(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatHumanTime(dateString) {
  if (!dateString) return 'Never';
  const diffSec = Math.floor((new Date() - new Date(dateString)) / 1000);
  if (diffSec < 10) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

// Boot application
window.addEventListener('DOMContentLoaded', init);
