const config = require('./config');
const DatabaseManager = require('./db/database');
const { createPlatformAdapter } = require('./core/platform');
const NetworkDiagnostics = require('./core/diagnostics');
const DiscoveryEngine = require('./core/discovery');
const DeviceStateMachine = require('./core/state-machine');
const AppServer = require('./server/app');

async function main() {
  const args = process.argv.slice(2);
  const isDiagnosticsOnly = args.includes('--diagnostics-only') || args.includes('-d');
  const isScanNowOnly = args.includes('--scan-now') || args.includes('-s');

  const customPortIndex = args.indexOf('--port') !== -1 ? args.indexOf('--port') : args.indexOf('-p');
  const port = customPortIndex !== -1 ? parseInt(args[customPortIndex + 1], 10) : config.server.port;

  const customHostIndex = args.indexOf('--host');
  const host = customHostIndex !== -1 ? args[customHostIndex + 1] : config.server.host;

  console.log('====================================================');
  console.log(`  ${config.appName} (v${config.version})`);
  console.log('====================================================');

  const adapter = createPlatformAdapter();
  const diagnostics = new NetworkDiagnostics(adapter);

  // 1. Run Pre-Flight Diagnostics
  console.log('[*] Running network pre-flight diagnostic check...');
  const report = await diagnostics.runPreFlightCheck();

  if (report.activeInterface) {
    console.log(`[+] Detected Adapter : ${report.activeInterface.description || report.activeInterface.name}`);
    console.log(`[+] Host IPv4 Address: ${report.activeInterface.ip}`);
    console.log(`[+] Subnet Mask      : ${report.activeInterface.netmask} (/${report.subnet ? report.subnet.cidr : '?'})`);
    console.log(`[+] Usable IP Range  : ${report.subnet ? `${report.subnet.firstUsableIp} - ${report.subnet.lastUsableIp} (${report.subnet.totalHosts} hosts)` : 'Unknown'}`);
    console.log(`[+] Default Gateway  : ${report.activeInterface.gateway || 'None'}`);
    console.log(`[+] Physical (MAC)   : ${report.activeInterface.mac || 'Unavailable'}`);
  } else {
    console.warn('[!] WARNING: No active network adapter with IPv4 configuration detected.');
  }

  if (report.warnings.length > 0) {
    console.log('\n[!] Network Notices & Warnings:');
    report.warnings.forEach(w => console.log(`    - ${w}`));
  }

  // If user only wanted diagnostics, print explanations and exit
  if (isDiagnosticsOnly) {
    console.log('\n[*] Common Network Environment Guidance:');
    report.explanations.forEach(e => {
      console.log(`\n  * ${e.topic}:`);
      console.log(`    ${e.detail}`);
    });
    process.exit(0);
  }

  // Initialize Database
  const db = new DatabaseManager();

  // If user wanted single command-line scan only
  if (isScanNowOnly) {
    console.log('\n[*] Initiating single subnet discovery sweep...');
    const discovery = new DiscoveryEngine({ platformAdapter: adapter });
    const stateMachine = new DeviceStateMachine({
      database: db,
      gatewayIp: report.activeInterface ? report.activeInterface.gateway : null
    });

    try {
      const scanResult = await discovery.runScan({
        onProgress: (p) => {
          process.stdout.write(`\r[*] Progress: ${p.percent}% (${p.scanned}/${p.total} hosts) - ${p.devicesFound} devices found`);
        }
      });
      process.stdout.write('\n');

      const processed = await stateMachine.processScanResults(scanResult.devices);

      console.log('\n================== Discovered Devices ==================');
      const allDevs = db.getAllDevices();
      allDevs.forEach(d => {
        const status = d.status === 'online' ? '[ONLINE]' : '[OFFLINE]';
        const vendor = d.is_randomized_mac ? 'Private MAC' : d.vendor;
        console.log(`  ${status.padEnd(10)} ${d.last_ip.padEnd(16)} ${(d.mac_address || 'Unavailable').padEnd(19)} ${(d.custom_name || d.hostname || '').padEnd(20)} ${vendor}`);
      });
      console.log(`========================================================\nSummary: ${allDevs.length} total recorded in database.`);
    } catch (err) {
      console.error('\n[!] Scan error:', err.message);
    } finally {
      db.close();
      process.exit(0);
    }
  }

  // 2. Start Full Web Application Server
  const appServer = new AppServer({ database: db, platformAdapter: adapter });
  await appServer.init();

  await appServer.start(port, host);
  console.log('\n----------------------------------------------------');
  console.log(`[✔] Web Dashboard live at: http://${host}:${port}`);
  console.log(`[✔] SQLite Database at   : ${config.paths.db}`);
  console.log(`[✔] Auto-scan interval   : ${config.scanner.autoScanIntervalSeconds}s (press Ctrl+C to stop)`);
  console.log('----------------------------------------------------');

  // Graceful shutdown handling
  const shutdown = async () => {
    console.log('\n[*] Stopping Smart LAN Security Server...');
    await appServer.stop();
    db.close();
    console.log('[✔] Cleanup complete. Goodbye.');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch(err => {
    console.error('Fatal initialization error:', err);
    process.exit(1);
  });
}

module.exports = { main };

