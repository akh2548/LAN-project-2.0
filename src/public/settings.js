/**
 * Ethernet Network Settings Controller
 * Pure vanilla JavaScript, plain DOM operations, standard fetch API.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const navLinkStatus = document.getElementById('navLinkStatus');
  const navStatusText = document.getElementById('navStatusText');
  const navUserLabel = document.getElementById('navUserLabel');
  const btnLogout = document.getElementById('btnLogout');

  const statusAlert = document.getElementById('statusAlert');
  const badgeConnectionState = document.getElementById('badgeConnectionState');
  const valAdapterName = document.getElementById('valAdapterName');
  const valLinkStatus = document.getElementById('valLinkStatus');
  const valMacAddress = document.getElementById('valMacAddress');
  const cableNotice = document.getElementById('cableNotice');

  const detIpAssignment = document.getElementById('detIpAssignment');
  const detIpAddress = document.getElementById('detIpAddress');
  const detSubnetMask = document.getElementById('detSubnetMask');
  const detSubnetCidr = document.getElementById('detSubnetCidr');
  const detGateway = document.getElementById('detGateway');
  const detDhcpServer = document.getElementById('detDhcpServer');
  const detDnsServers = document.getElementById('detDnsServers');
  const badgePing = document.getElementById('badgePing');
  const textPingLatency = document.getElementById('textPingLatency');
  const valLastUpdated = document.getElementById('valLastUpdated');

  const settingsForm = document.getElementById('settingsForm');
  const ipModeDhcp = document.getElementById('ipModeDhcp');
  const ipModeStatic = document.getElementById('ipModeStatic');
  const cfgIpAddress = document.getElementById('cfgIpAddress');
  const cfgSubnetMask = document.getElementById('cfgSubnetMask');
  const cfgGateway = document.getElementById('cfgGateway');
  const cfgDns1 = document.getElementById('cfgDns1');
  const cfgDns2 = document.getElementById('cfgDns2');
  const cfgLanOnly = document.getElementById('cfgLanOnly');
  const cfgNotifyNew = document.getElementById('cfgNotifyNew');
  const cfgSoundAlerts = document.getElementById('cfgSoundAlerts');
  const cfgDesktopNotifications = document.getElementById('cfgDesktopNotifications');
  const cfgScanInterval = document.getElementById('cfgScanInterval');

  const btnSave = document.getElementById('btnSave');
  const btnTestGateway = document.getElementById('btnTestGateway');
  const btnRefresh = document.getElementById('btnRefresh');

  let currentInfo = null;

  function showAlert(message, type = 'info', durationMs = 5000) {
    statusAlert.className = `alert alert-${type}`;
    statusAlert.textContent = message;
    statusAlert.style.display = 'block';
    if (durationMs > 0) {
      setTimeout(() => {
        statusAlert.style.display = 'none';
      }, durationMs);
    }
  }

  // Verify User Session
  async function checkAuth() {
    try {
      const res = await fetch('/api/auth/status');
      if (!res.ok) throw new Error('Auth check failed');
      const data = await res.json();
      if (!data.authenticated) {
        window.location.replace(data.setupComplete ? '/login.html' : '/register.html');
        return false;
      }
      if (data.user) {
        navUserLabel.textContent = data.user.full_name || data.user.username;
      }
      return true;
    } catch {
      window.location.replace('/login.html');
      return false;
    }
  }

  // Load Network Status & Settings
  async function loadData() {
    try {
      const [infoRes, settingsRes] = await Promise.all([
        fetch('/api/system/info'),
        fetch('/api/settings')
      ]);

      if (infoRes.ok) {
        const info = await infoRes.json();
        currentInfo = info;
        renderConnectionStatus(info);
      }

      if (settingsRes.ok) {
        const settings = await settingsRes.json();
        renderSettingsForm(settings);
      }

      valLastUpdated.textContent = 'Updated at ' + new Date().toLocaleTimeString();
    } catch (err) {
      console.error('Failed to load settings data:', err);
      showAlert('Unable to query network status from server.', 'danger');
    }
  }

  function renderConnectionStatus(info) {
    const active = info.activeInterface;
    const isWired = active && (active.isWired || active.mediaType === 'ethernet');

    if (active && active.ip && isWired) {
      navLinkStatus.className = 'status-indicator status-online';
      navStatusText.textContent = 'Ethernet Connected';

      badgeConnectionState.className = 'badge badge-success';
      badgeConnectionState.textContent = 'Connected (RJ-45)';

      valAdapterName.textContent = active.description || active.name || 'Ethernet Adapter';
      valLinkStatus.textContent = 'Active (Ethernet Link OK)';
      valLinkStatus.className = 'status-value text-success';
      valMacAddress.textContent = active.mac || 'Unavailable';
      cableNotice.style.display = 'none';

      detIpAssignment.textContent = active.dhcpServer ? 'Automatic (DHCP)' : 'Static IP';
      detIpAddress.textContent = active.ip || '0.0.0.0';
      detSubnetMask.textContent = active.netmask || '255.255.255.0';
      detSubnetCidr.textContent = info.subnet ? `/${info.subnet.cidr} (${info.subnet.networkAddress})` : '/24';
      detGateway.textContent = active.gateway || 'None';
      detDhcpServer.textContent = active.dhcpServer || active.gateway || 'Not detected';
      detDnsServers.textContent = active.dnsServers && active.dnsServers.length ? active.dnsServers.join(', ') : (active.gateway || '192.168.0.1');

      if (info.gatewayStatus && info.gatewayStatus.reachable) {
        badgePing.className = 'badge badge-success';
        badgePing.textContent = 'Reachable';
        textPingLatency.textContent = info.gatewayStatus.latencyMs ? `(${info.gatewayStatus.latencyMs} ms)` : '';
      } else {
        badgePing.className = 'badge badge-warning';
        badgePing.textContent = 'No ICMP Reply';
        textPingLatency.textContent = '(Router may filter ping)';
      }
    } else {
      navLinkStatus.className = 'status-indicator status-offline';
      navStatusText.textContent = 'Ethernet Disconnected';

      badgeConnectionState.className = 'badge badge-warning';
      badgeConnectionState.textContent = 'Cable Unplugged';

      valAdapterName.textContent = 'No Wired Adapter Detected';
      valLinkStatus.textContent = 'Disconnected (No Link)';
      valLinkStatus.className = 'status-value text-danger';
      valMacAddress.textContent = '--:--:--:--:--:--';
      cableNotice.style.display = 'block';

      detIpAssignment.textContent = 'None';
      detIpAddress.textContent = 'Disconnected';
      detSubnetMask.textContent = '-';
      detSubnetCidr.textContent = '-';
      detGateway.textContent = '-';
      detDhcpServer.textContent = '-';
      detDnsServers.textContent = '-';

      badgePing.className = 'badge badge-offline';
      badgePing.textContent = 'Offline';
      textPingLatency.textContent = '';
    }
  }

  function renderSettingsForm(settings) {
    if (settings.ipMode === 'static') {
      ipModeStatic.checked = true;
      enableStaticFields(true);
    } else {
      ipModeDhcp.checked = true;
      enableStaticFields(false);
    }

    if (settings.ipAddress) cfgIpAddress.value = settings.ipAddress;
    if (settings.subnetMask) cfgSubnetMask.value = settings.subnetMask;
    if (settings.gateway) cfgGateway.value = settings.gateway;
    if (settings.preferredDns) cfgDns1.value = settings.preferredDns;
    if (settings.alternateDns) cfgDns2.value = settings.alternateDns;

    cfgNotifyNew.checked = settings.notifyNewDevices !== false;
    cfgSoundAlerts.checked = settings.soundAlerts !== false;
    cfgDesktopNotifications.checked = settings.desktopNotifications !== false;
    cfgScanInterval.value = String(settings.scanInterval ?? 60);
  }

  function enableStaticFields(enable) {
    if (enable) {
      cfgIpAddress.removeAttribute('readonly');
      cfgSubnetMask.removeAttribute('readonly');
      cfgGateway.removeAttribute('readonly');
    } else {
      cfgIpAddress.setAttribute('readonly', 'readonly');
      cfgSubnetMask.setAttribute('readonly', 'readonly');
      cfgGateway.setAttribute('readonly', 'readonly');
    }
  }

  // Event Listeners
  ipModeDhcp.addEventListener('change', () => enableStaticFields(false));
  ipModeStatic.addEventListener('change', () => enableStaticFields(true));

  btnRefresh.addEventListener('click', async () => {
    btnRefresh.disabled = true;
    btnRefresh.textContent = 'Refreshing...';
    await loadData();
    btnRefresh.disabled = false;
    btnRefresh.textContent = 'Refresh Connection Status';
    showAlert('Connection status refreshed.', 'info', 3000);
  });

  btnTestGateway.addEventListener('click', async () => {
    btnTestGateway.disabled = true;
    btnTestGateway.textContent = 'Testing...';
    try {
      const res = await fetch('/api/settings/test', { method: 'POST' });
      const data = await res.json();
      if (data.reachable) {
        showAlert(`Gateway ${data.targetIp} is reachable (${data.timeMs ? data.timeMs + ' ms' : '< 1 ms'}).`, 'success', 6000);
      } else {
        showAlert(`Gateway ${data.targetIp} did not respond to ICMP ping. Router may have ICMP Echo disabled.`, 'warning', 6000);
      }
    } catch {
      showAlert('Gateway connectivity test failed.', 'danger', 5000);
    } finally {
      btnTestGateway.disabled = false;
      btnTestGateway.textContent = 'Test Gateway Reachability';
    }
  });

  settingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    btnSave.disabled = true;
    btnSave.textContent = 'Saving...';

    const payload = {
      ipMode: ipModeStatic.checked ? 'static' : 'dhcp',
      ipAddress: cfgIpAddress.value.trim(),
      subnetMask: cfgSubnetMask.value.trim(),
      gateway: cfgGateway.value.trim(),
      preferredDns: cfgDns1.value.trim(),
      alternateDns: cfgDns2.value.trim(),
      notifyNewDevices: cfgNotifyNew.checked,
      soundAlerts: cfgSoundAlerts.checked,
      desktopNotifications: cfgDesktopNotifications.checked,
      scanInterval: parseInt(cfgScanInterval.value, 10)
    };

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok) {
        showAlert('Settings saved successfully.', 'success', 5000);
      } else {
        showAlert(data.error || 'Failed to save settings.', 'danger', 5000);
      }
    } catch {
      showAlert('Network error while saving settings.', 'danger', 5000);
    } finally {
      btnSave.disabled = false;
      btnSave.textContent = 'Save Settings';
    }
  });

  btnLogout.addEventListener('click', async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {
      console.error(e);
    }
    window.location.replace('/login.html');
  });

  // Init
  checkAuth().then(ok => {
    if (ok) loadData();
  });
});
