const path = require('node:path');
const os = require('node:os');

const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT_DIR, 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'lan_security.db');

module.exports = {
  appName: 'Smart LAN Security System',
  version: '1.0.0',
  paths: {
    root: ROOT_DIR,
    data: DATA_DIR,
    db: DB_PATH,
    public: path.join(__dirname, 'public')
  },
  server: {
    host: process.env.HOST || '127.0.0.1', // Binds to localhost by default for security
    port: parseInt(process.env.PORT || '3000', 10)
  },
  network: {
    // Restrict strictly to wired LAN (Ethernet cable), ignoring Wi-Fi adapters
    lanOnly: process.env.LAN_ONLY !== 'false',
    preferEthernet: true
  },
  scanner: {
    // Concurrency limit for active probes (prevents saturating router)
    concurrency: parseInt(process.env.SCAN_CONCURRENCY || '16', 10),
    // Delay between batches in milliseconds
    batchDelayMs: parseInt(process.env.SCAN_BATCH_DELAY || '25', 10),
    // Timeout for individual host ping/TCP probe in milliseconds
    probeTimeoutMs: parseInt(process.env.SCAN_PROBE_TIMEOUT || '400', 10),
    // Automatic periodic scan interval in seconds (0 = manual only)
    autoScanIntervalSeconds: parseInt(process.env.AUTO_SCAN_INTERVAL || '60', 10),
    // Common ports to probe to induce ARP resolution if ping is blocked by target firewall
    probePorts: [80, 443, 22, 445, 5357, 8080],
    // Safety check: refuse to sweep subnets larger than /22 (1024 hosts) without explicit flag
    maxSubnetHosts: 1024
  },
  alerts: {
    // Suppression window in ms for repeated device online/offline transitions (debounces flapping)
    debounceWindowMs: 5 * 60 * 1000,
    // Enable native desktop notifications (e.g. Windows Toast via PowerShell)
    enableDesktopToast: process.env.ENABLE_DESKTOP_TOAST !== 'false'
  }
};

