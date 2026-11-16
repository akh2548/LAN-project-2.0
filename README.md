# Smart LAN Security System

A lightweight, reliable, and privacy-respecting local network monitoring solution designed for small-office and home-office (SOHO) networks. Built for standard routers connecting computers and devices over Ethernet LAN cables and Wi-Fi.

---

## 🎯 Key Capabilities & Honest Engineering

Unlike marketing tools that make exaggerated claims, this system is built on **verifiable networking realities**:

* **Safe Dual-Phase Discovery:** Combines instant Layer-2 ARP neighbor table interrogation with non-saturating synthetic ARP seeding (rate-limited ICMP ping + TCP probes) to find hosts on the administrator-approved local subnet.
* **Firewall-Resilient:** Discovers stealth devices that drop ICMP echo/ping by forcing the host OS kernel to resolve their MAC address via Layer-2 ARP.
* **Privacy & Randomized MAC Detection:** Accurately flags IEEE 802 Locally Administered Addresses (LAA privacy mode used by iOS, Android, and Windows) so administrators understand why mobile addresses may rotate.
* **Zero Cloud & Local-First:** Operates 100% offline with zero cloud relays, zero external telemetry, and zero third-party tracking. All device history and event logs are stored locally in an embedded SQLite database (`node:sqlite`).
* **Real-Time Web Dashboard:** Responsive dark-mode dashboard with Server-Sent Events (SSE) for live scan progress, device status changes, and audio chimes.
* **Honest Boundaries:** Clearly explains that standard PCs on switched networks cannot sniff third-party unicast traffic or forcibly kick devices off a router without router admin control. Provides guided links to the router administration portal (`http://192.168.31.1`).

---

## 💻 System Compatibility

| Operating System | Support Level | Implementation |
| :--- | :--- | :--- |
| **Windows 11 / 10** | **Primary (Verified)** | `ipconfig /all`, `route print`, `arp -a`, PowerShell `Get-NetNeighbor`, WinRT Toast |
| **Linux (Ubuntu, Debian, RHEL)** | **Full** | `ip route`, `ip addr`, `/proc/net/arp`, `ip neigh`, `notify-send` |
| **macOS (Darwin 12+)** | **Full** | `ifconfig`, `netstat -rn`, `arp -an`, `osascript` notification |

### Inspected Host Environment
* **OS:** Microsoft Windows 11 Build 26200
* **Host Adapter:** Realtek RTL8852BE-VS WiFi 6 802.11ax PCIe Adapter
* **Local IP:** `192.168.31.98` (`255.255.255.0` / `/24`)
* **Default Gateway:** `192.168.31.1`
* **Runtime:** Node.js v22.14.0 (with built-in `node:sqlite` SQLite 3.47.2)

---

## 🚀 Quick Start

### 1. Prerequisites
* **Node.js** v18.0.0 or higher (v22 LTS recommended, which includes built-in SQLite).
* No external npm dependencies required; uses native Node.js standard libraries.

### 2. Pre-Flight Diagnostics
Inspect the local network interface, subnet boundaries, and gateway reachability:
```bash
npm run diagnostics
# or
node src/index.js --diagnostics-only
```

### 3. Run a Single CLI Discovery Sweep
Perform a single rate-limited sweep and print discovered devices to the terminal:
```bash
npm run scan
# or
node src/index.js --scan-now
```

### 4. Start the Web Dashboard
Launch the real-time web dashboard:
```bash
npm start
# or
node src/index.js
```
Open your browser to:
👉 **`http://127.0.0.1:3000`**

On first launch, the app opens a one-time administrator setup page. Choose a login ID and a password of at least 12 characters; there is no built-in default account. The password is stored as a scrypt hash in the local SQLite database. After setup, sign in at `http://127.0.0.1:3000/admin-login.html`. The dashboard and API require an authenticated session, which expires after eight hours. Initial setup is restricted to the local computer.

---

## ⚙️ Configuration & Environment Variables

You can configure scanning parameters via environment variables or flags:

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `3000` | Web dashboard HTTP port. |
| `HOST` | `127.0.0.1` | Bind address (`127.0.0.1` keeps access local to this machine). |
| `SCAN_CONCURRENCY` | `16` | Maximum simultaneous host probes (prevents router packet congestion). |
| `SCAN_BATCH_DELAY` | `25` | Delay (ms) between IP probe batches. |
| `SCAN_PROBE_TIMEOUT` | `400` | Timeout (ms) for individual host ping/TCP connection attempt. |
| `AUTO_SCAN_INTERVAL` | `60` | Periodic background scan interval in seconds (`0` = manual only). |
| `DATA_DIR` | `./data` | Directory where SQLite database (`lan_security.db`) is stored. |
| `ENABLE_DESKTOP_TOAST` | `true` | Enables native Windows / Linux / macOS desktop notifications. |

Example running on a custom port with 2-minute auto-scan:
```powershell
$env:PORT="8080"; $env:AUTO_SCAN_INTERVAL="120"; npm start
```

---

## 🧪 Automated Testing

The project includes 17 automated unit and integration tests using Node.js's native test runner (`node:test` and `node:assert`):

```bash
npm test
```

### Test Coverage
1. **Network Calculation Tests (`tests/network-calc.test.js`):** Validates IPv4 integer conversions, CIDR prefix lengths, `/24` and `/28` subnet boundaries, and IP containment checks.
2. **MAC & OUI Tests (`tests/mac-oui.test.js`):** Tests MAC address normalization, offline vendor identification (Realtek, Apple, Xiaomi, Raspberry Pi, Espressif), and IEEE Locally Administered Address (randomized privacy MAC) detection.
3. **Platform Parser Tests (`tests/parsers.test.js`):** Tests output parsers for Windows `ipconfig /all`, `route print`, `arp -a`, Linux `/proc/net/arp`, and macOS `arp -an`.
4. **Database DAL Tests (`tests/database.test.js`):** In-memory SQLite test verifying device insertion, IP change tracking, `device_history` logs, and event acknowledgement.
5. **State Machine Tests (`tests/state-machine.test.js`):** Validates detection of new devices (`DEVICE_NEW`), offline transitions (`DEVICE_OFFLINE`), and critical gateway MAC spoofing (`GATEWAY_MISMATCH`).
6. **API Route Handler Tests (`tests/routes.test.js`):** Verifies all HTTP REST endpoints return valid JSON and proper status codes.

---

## 🛡️ Router & Security Boundaries (What Ordinary PCs Cannot Do)

1. **Switched Network Isolation:** On modern Ethernet switches and Wi-Fi networks, unicast packets are routed specifically to destination switch ports. A program running on one PC cannot capture or inspect general web browsing traffic from other devices without ARP spoofing (which is harmful and disruptive) or a managed mirror/SPAN port.
2. **Device Blocking:** A standard computer cannot physically disconnect another computer from a router. To block a rogue device:
   - Click the **"Router Security Guide"** button in the dashboard.
   - Access your router administration portal (`http://192.168.31.1`).
   - Configure **MAC Address Filtering / Blacklisting** or **Access Control**.
3. **Client / AP Isolation:** If your router has "Guest Wi-Fi" or "Client Isolation" enabled, clients are isolated from each other at Layer 2. In this mode, only the gateway router is visible.
4. **Sleeping Mobile Devices:** Smartphones (iOS and Android) enter deep sleep (Doze mode) to conserve battery, temporarily dropping Wi-Fi pings. The system debounces offline alerts to avoid false alarms.

---

## 📁 Project Structure

```
├── data/
│   └── lan_security.db        # SQLite database (auto-created on first run)
├── src/
│   ├── index.js               # CLI and application runner
│   ├── config.js              # Centralized defaults and environment options
│   ├── core/
│   │   ├── diagnostics.js     # Network interface and pre-flight checks
│   │   ├── discovery.js       # Dual-phase rate-limited discovery engine
│   │   ├── enrichment.js      # Hostname (reverse DNS/NetBIOS) & OUI resolution
│   │   ├── notifier.js        # Local toast & event dispatcher
│   │   ├── state-machine.js   # Device lifecycle & anomaly detection
│   │   └── platform/
│   │       ├── adapter.js     # PlatformAdapter base class
│   │       ├── windows.js     # Windows implementation (ipconfig, arp, route, WinRT)
│   │       ├── linux.js       # Linux implementation (ip, /proc/net/arp, notify-send)
│   │       └── darwin.js      # macOS implementation (ifconfig, arp, osascript)
│   ├── db/
│   │   ├── database.js        # SQLite DAL using node:sqlite with WAL
│   │   └── oui-data.js        # Offline IEEE OUI vendor dictionary
│   ├── server/
│   │   ├── app.js             # Native Node.js HTTP server & REST router
│   │   ├── sse.js             # Server-Sent Events manager
│   │   └── router-advisor.js  # Router administration guidance helper
│   └── public/
│       ├── index.html         # Responsive web dashboard
│       ├── styles.css         # Modern accessible styling
│       └── app.js             # Real-time frontend client
├── tests/                     # 17 automated unit and integration tests
├── PRD.md                     # Product Requirements Document
├── TRD.md                     # Technical Requirements Document
├── Design.md                  # System Architecture & Detailed Design
└── package.json               # Project manifest
```

---

## 📄 License
MIT License. Free for personal and commercial local network administration.
