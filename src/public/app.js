// Smart LAN Security System - Frontend Client

let devices = [];
let events = [];
let systemInfo = null;
let soundEnabled = true;
let isScanning = false;
let eventSource = null;

// DOM Elements
const sseIndicator = document.getElementById('sseIndicator');
const sseStatusText = document.getElementById('sseStatusText');
const btnAudioToggle = document.getElementById('btnAudioToggle');
const audioStatusText = document.getElementById('audioStatusText');
const btnRouterHelp = document.getElementById('btnRouterHelp');
const btnScanNow = document.getElementById('btnScanNow');
const btnStopScan = document.getElementById('btnStopScan');
const scanSpinner = document.getElementById('scanSpinner');
const scanProgressContainer = document.getElementById('scanProgressContainer');
const scanProgressBar = document.getElementById('scanProgressBar');
const scanProgressLabel = document.getElementById('scanProgressLabel');
const scanProgressPercent = document.getElementById('scanProgressPercent');
const autoScanSelect = document.getElementById('autoScanSelect');

const valAdapter = document.getElementById('valAdapter');
const valHostIp = document.getElementById('valHostIp');
const valSubnet = document.getElementById('valSubnet');
const valGateway = document.getElementById('valGateway');
const hostPlatformBadge = document.getElementById('hostPlatformBadge');
const diagnosticsWarnings = document.getElementById('diagnosticsWarnings');

const statTotalDevices = document.getElementById('statTotalDevices');
const statOnlineDevices = document.getElementById('statOnlineDevices');
const statUntrustedDevices = document.getElementById('statUntrustedDevices');
const statLastScan = document.getElementById('statLastScan');
const deviceCountLabel = document.getElementById('deviceCountLabel');

const searchInput = document.getElementById('searchInput');
const filterStatus = document.getElementById('filterStatus');
const filterTrust = document.getElementById('filterTrust');
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

// Web Audio Chime generator (offline, no external audio files required)
function playAlertChime(severity = 'INFO') {
  if (!soundEnabled) return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    const freq = severity === 'CRITICAL' ? 880 : 587.33; // A5 or D5
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.5, ctx.currentTime + 0.15);

    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch {
    // Ignore audio permission or context restrictions
  }
}

// Initial Boot
async function init() {
  setupEventListeners();
  connectSSE();
  await Promise.all([
    loadSystemInfo(),
    loadStats(),
    loadDevices(),
    loadEvents()
  ]);
}

function setupEventListeners() {
  btnAudioToggle.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    audioStatusText.textContent = soundEnabled ? 'Sound ON' : 'Sound OFF';
    btnAudioToggle.style.opacity = soundEnabled ? '1' : '0.6';
  });

  btnScanNow.addEventListener('click', startScan);
  btnStopScan.addEventListener('click', stopScan);

  searchInput.addEventListener('input', renderDevices);
  filterStatus.addEventListener('change', renderDevices);
  filterTrust.addEventListener('change', renderDevices);

  eventFilterType.addEventListener('change', () => loadEvents(eventFilterType.value));

  btnRouterHelp.addEventListener('click', openRouterModal);
  btnCloseRouterModal.addEventListener('click', () => routerModal.style.display = 'none');
  routerModal.addEventListener('click', (e) => {
    if (e.target === routerModal) routerModal.style.display = 'none';
  });

  btnCloseEditModal.addEventListener('click', () => editDeviceModal.style.display = 'none');
  btnCancelEdit.addEventListener('click', () => editDeviceModal.style.display = 'none');
  editDeviceModal.addEventListener('click', (e) => {
    if (e.target === editDeviceModal) editDeviceModal.style.display = 'none';
  });

  editDeviceForm.addEventListener('submit', handleSaveDeviceProfile);
}

// API Loaders
async function loadSystemInfo() {
  try {
    const res = await fetch('/api/system/info');
    systemInfo = await res.json();
    renderDiagnostics(systemInfo);
  } catch (err) {
    console.error('Failed to load system info:', err);
  }
}

function renderDiagnostics(info) {
  if (!info) return;

  hostPlatformBadge.textContent = info.platform.toUpperCase();

  if (info.activeInterface) {
    valAdapter.textContent = info.activeInterface.description || info.activeInterface.name || 'Unknown';
    valHostIp.textContent = info.activeInterface.ip || 'Unavailable';
    valGateway.textContent = info.activeInterface.gateway || 'None';
  } else {
    valAdapter.textContent = 'None Detected';
    valHostIp.textContent = 'Unavailable';
    valGateway.textContent = 'None';
  }

  if (info.subnet) {
    valSubnet.textContent = `${info.subnet.networkAddress}/${info.subnet.cidr} (${info.subnet.totalHosts} hosts)`;
  } else {
    valSubnet.textContent = 'Unknown';
  }

  // Warnings & Guidance
  diagnosticsWarnings.innerHTML = '';
  if (info.warnings && info.warnings.length > 0) {
    info.warnings.forEach(w => {
      const el = document.createElement('div');
      el.className = 'warning-banner';
      el.textContent = `⚠️ ${w}`;
      diagnosticsWarnings.appendChild(el);
    });
  }
}

async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    const stats = await res.json();
    statTotalDevices.textContent = stats.totalDevices;
    statOnlineDevices.textContent = stats.onlineDevices;
    statUntrustedDevices.textContent = stats.untrustedDevices;

    if (stats.lastScan && stats.lastScan.completed_at) {
      statLastScan.textContent = formatRelativeTime(stats.lastScan.completed_at);
    } else {
      statLastScan.textContent = 'Never';
    }
  } catch (err) {
    console.error('Failed to load stats:', err);
  }
}

async function loadDevices() {
  try {
    const res = await fetch('/api/devices');
    devices = await res.json();
    renderDevices();
  } catch (err) {
    console.error('Failed to load devices:', err);
  }
}

async function loadEvents(filterType = '') {
  try {
    const url = filterType ? `/api/events?type=${encodeURIComponent(filterType)}` : '/api/events';
    const res = await fetch(url);
    events = await res.json();
    renderEvents();
  } catch (err) {
    console.error('Failed to load events:', err);
  }
}

// Device Table Rendering & Filtering
function renderDevices() {
  const query = searchInput.value.toLowerCase().trim();
  const statusFilter = filterStatus.value;
  const trustFilter = filterTrust.value;

  const filtered = devices.filter(dev => {
    if (statusFilter !== 'all' && dev.status !== statusFilter) return false;
    if (trustFilter !== 'all' && dev.trust_level !== trustFilter) return false;

    if (query) {
      const matchIp = (dev.last_ip || '').toLowerCase().includes(query);
      const matchMac = (dev.mac_address || '').toLowerCase().includes(query);
      const matchName = (dev.custom_name || '').toLowerCase().includes(query);
      const matchHost = (dev.hostname || '').toLowerCase().includes(query);
      const matchVendor = (dev.vendor || '').toLowerCase().includes(query);
      return matchIp || matchMac || matchName || matchHost || matchVendor;
    }
    return true;
  });

  deviceCountLabel.textContent = filtered.length;

  if (filtered.length === 0) {
    devicesTableBody.innerHTML = `
      <tr>
        <td colspan="8" class="text-center py-4 text-muted">
          No matching devices found.
        </td>
      </tr>
    `;
    return;
  }

  devicesTableBody.innerHTML = filtered.map(dev => {
    const isOnline = dev.status === 'online';
    const statusBadge = isOnline 
      ? '<span class="badge badge-success">ONLINE</span>' 
      : '<span class="badge badge-warning">OFFLINE</span>';

    let trustBadge = '<span class="badge badge-danger">UNTRUSTED</span>';
    if (dev.trust_level === 'trusted') {
      trustBadge = '<span class="badge badge-info">TRUSTED</span>';
    } else if (dev.trust_level === 'familiar') {
      trustBadge = '<span class="badge badge-purple">FAMILIAR</span>';
    }

    const randomBadge = dev.is_randomized_mac 
      ? '<span class="badge badge-purple" title="Locally Administered / Privacy MAC">RANDOM</span> ' 
      : '';

    const hostnameDisplay = dev.hostname 
      ? `<div class="device-hostname">${escapeHtml(dev.hostname)}</div>`
      : '<div class="device-hostname text-muted">(Unavailable / Blocked)</div>';

    const customNameDisplay = dev.custom_name
      ? `<div class="device-name">${escapeHtml(dev.custom_name)}</div>`
      : `<div class="device-name text-muted">Unnamed Device</div>`;

    const vendorDisplay = dev.is_randomized_mac
      ? 'Private / Randomized'
      : (dev.vendor || 'Unknown Vendor');

    return `
      <tr>
        <td>${statusBadge}</td>
        <td class="ip-cell">${escapeHtml(dev.last_ip)}</td>
        <td>
          ${customNameDisplay}
          ${hostnameDisplay}
        </td>
        <td class="mac-cell">
          ${randomBadge}${escapeHtml(dev.mac_address)}
        </td>
        <td>${escapeHtml(vendorDisplay)}</td>
        <td>${trustBadge}</td>
        <td title="${dev.last_seen}">${formatRelativeTime(dev.last_seen)}</td>
        <td>
          <button class="btn btn-secondary btn-icon" onclick="openEditDeviceModal(${dev.id})">
            ✏️ Edit
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

// Render Event Audit Log
function renderEvents() {
  if (events.length === 0) {
    eventList.innerHTML = '<div class="empty-events">No security events recorded yet.</div>';
    return;
  }

  eventList.innerHTML = events.slice(0, 30).map(ev => {
    return `
      <div class="event-item severity-${ev.severity}">
        <div>
          <strong>${escapeHtml(ev.event_type)}:</strong> ${escapeHtml(ev.message)}
        </div>
        <div class="event-time" title="${ev.created_at}">${formatRelativeTime(ev.created_at)}</div>
      </div>
    `;
  }).join('');
}

// Scan Execution
async function startScan() {
  if (isScanning) return;
  setScanningUi(true);

  try {
    const res = await fetch('/api/scan/start', { method: 'POST' });
    if (!res.ok && res.status !== 202) {
      const err = await res.json();
      showFloatingAlert('Error', err.error || 'Failed to start scan', 'CRITICAL');
      setScanningUi(false);
    }
  } catch (err) {
    showFloatingAlert('Error', err.message, 'CRITICAL');
    setScanningUi(false);
  }
}

async function stopScan() {
  try {
    await fetch('/api/scan/stop', { method: 'POST' });
    setScanningUi(false);
    showFloatingAlert('Scan Paused', 'Discovery scan stopped by administrator.', 'INFO');
  } catch (err) {
    console.error('Stop error:', err);
  }
}

function setScanningUi(scanning) {
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
  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource('/api/stream');

  eventSource.onopen = () => {
    sseIndicator.classList.add('online');
    sseStatusText.textContent = 'Live Synced';
  };

  eventSource.onerror = () => {
    sseIndicator.classList.remove('online');
    sseStatusText.textContent = 'Reconnecting...';
  };

  eventSource.addEventListener('scan_started', (e) => {
    setScanningUi(true);
    scanProgressLabel.textContent = 'Initiating rate-limited subnet scan...';
  });

  eventSource.addEventListener('scan_progress', (e) => {
    const prog = JSON.parse(e.data);
    scanProgressBar.style.width = `${prog.percent}%`;
    scanProgressPercent.textContent = `${prog.percent}%`;
    scanProgressLabel.textContent = `Probing ${prog.currentIp || 'hosts'} (${prog.scanned}/${prog.total}) - ${prog.devicesFound} devices found`;
  });

  eventSource.addEventListener('scan_completed', (e) => {
    const data = JSON.parse(e.data);
    setScanningUi(false);
    loadStats();
    loadDevices();
    loadEvents();

    showFloatingAlert(
      'Scan Completed',
      `Found ${data.devicesFound} devices in ${Math.round(data.summary.durationMs / 1000)}s.`,
      'INFO'
    );
  });

  eventSource.addEventListener('alert', (e) => {
    const alertData = JSON.parse(e.data);
    playAlertChime(alertData.severity);
    showFloatingAlert(alertData.eventType, alertData.message, alertData.severity);
    loadEvents();
    loadStats();
  });

  eventSource.addEventListener('device_updated', () => {
    loadDevices();
    loadStats();
  });
}

// Floating Live Alert Toast
function showFloatingAlert(title, message, severity = 'INFO') {
  const card = document.createElement('div');
  card.className = `live-alert-card ${severity.toLowerCase()}`;
  card.innerHTML = `
    <strong>${escapeHtml(title)}</strong>
    <div>${escapeHtml(message)}</div>
  `;
  liveAlertContainer.appendChild(card);

  setTimeout(() => {
    card.style.opacity = '0';
    card.style.transition = 'opacity 0.5s ease';
    setTimeout(() => card.remove(), 500);
  }, 6000);
}

// Edit Device Profile Modal
window.openEditDeviceModal = function(id) {
  const dev = devices.find(d => d.id === id);
  if (!dev) return;

  editDeviceId.value = dev.id;
  editDeviceIp.value = dev.last_ip;
  editDeviceMac.value = dev.mac_address;
  editDeviceName.value = dev.custom_name || '';
  editDeviceTrust.value = dev.trust_level || 'untrusted';
  editDeviceNotes.value = dev.notes || '';

  editDeviceModal.style.display = 'flex';
};

async function handleSaveDeviceProfile(e) {
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
      await loadDevices();
      await loadStats();
      showFloatingAlert('Profile Updated', 'Device alias and trust settings saved.', 'INFO');
    }
  } catch (err) {
    alert('Failed to save device profile: ' + err.message);
  }
}

// Router Advisor Modal
async function openRouterModal() {
  try {
    const res = await fetch('/api/router/info');
    const guidance = await res.json();

    routerPortalIpText.textContent = guidance.gatewayIp;
    routerPortalLink.href = guidance.portalUrl;

    routerGuidesContainer.innerHTML = guidance.routerGuides.map(g => `
      <div class="router-brand-guide">
        <h4>${escapeHtml(g.brand)} (${escapeHtml(g.defaultIp)})</h4>
        <ol>
          ${g.steps.map(s => `<li>${escapeHtml(s)}</li>`).join('')}
        </ol>
      </div>
    `).join('');

    routerModal.style.display = 'flex';
  } catch (err) {
    console.error('Failed to load router guide:', err);
  }
}

// Helpers
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatRelativeTime(dateString) {
  if (!dateString) return 'Never';
  const now = new Date();
  const date = new Date(dateString);
  const diffSec = Math.floor((now - date) / 1000);

  if (diffSec < 10) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

// Boot application
window.addEventListener('DOMContentLoaded', init);

