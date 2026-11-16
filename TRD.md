# Technical Requirements Document (TRD)
## Smart LAN Security System (v1.0)

**Project Name:** Smart LAN Security System  
**Document Version:** 1.0.0  
**Status:** Approved for Implementation  
**Runtime:** Node.js v22.14.0 (Windows Native, cross-platform POSIX ready)  
**Database:** Built-in `node:sqlite` (SQLite 3.47.2) with WAL mode enabled  
**Storage Path:** `e:\Lan project 2.0\data\lan_security.db`  

---

### 1. Architectural Overview & Component Structure

The Smart LAN Security System is constructed as a modular, decoupled, event-driven Node.js application comprising seven core subsystems:

```
+-----------------------------------------------------------------------+
|                             Web Dashboard                             |
|        (Vanilla HTML5, Modern CSS Grid, ES6 SSE Client, Audio)        |
+-----------------------------------+-----------------------------------+
                                    | HTTP / REST & Server-Sent Events (SSE)
+-----------------------------------v-----------------------------------+
|                        Application Server API                         |
|             (Node.js HTTP Server, SSE Stream, Static Router)          |
+---------+-------------------------+-------------------------+---------+
          |                         |                         |
+---------v---------+     +---------v---------+     +---------v---------+
| Diagnostics &     |     | State Machine &   |     | Notification &    |
| Interface Engine  |     | Anomaly Detector  |     | Alert Dispatcher  |
+---------+---------+     +---------+---------+     +---------+---------+
          |                         |                         |
+---------v---------+     +---------v---------+     +---------v---------+
| Discovery Engine  |     | Persistent Store  |     | Router Security & |
| (ARP + Probing)   |     | (`node:sqlite`)   |     | Guidance Engine   |
+-------------------+     +-------------------+     +-------------------+
```

---

### 2. Technology Stack & Dependencies

| Component | Selected Technology | Technical Justification |
| :--- | :--- | :--- |
| **Runtime** | Node.js v22.14.0 | Verified installed on host; native ES modules, high-performance asynchronous event loop, built-in networking (`net`, `dgram`, `dns`). |
| **Embedded Database** | `node:sqlite` (SQLite 3.47.2) | Standard in Node.js 22+. Zero native compilation required (no `node-gyp`, no Python C++ toolchain needed). ACID compliant, zero latency. |
| **HTTP & API Server** | Native Node.js `node:http` | Eliminates heavy third-party framework dependencies; zero npm install risk; blazing fast startup (< 100 ms). |
| **Real-time Push** | Server-Sent Events (`text/event-stream`) | Lightweight, unidirectional HTTP streaming natively supported by all modern browsers. No WebSocket handshake overhead. |
| **Frontend UI** | Modern Vanilla HTML5 / CSS3 / ES Modules | Zero bundler (no Webpack/Vite build steps needed). Instant hot-reloading from static directory. |
| **OS Commands** | `node:child_process` (`execFile`, `spawn`) | Controlled execution of trusted platform binaries with sanitized parameters to prevent command injection. |

---

### 3. OS Abstraction Layer & Network Command Interop

The system defines a unified `PlatformAdapter` interface. At runtime, the application detects `process.platform` and instantiates the matching adapter.

```
                      +-------------------+
                      |  PlatformAdapter  | (Interface)
                      +---------+---------+
                                |
        +-----------------------+-----------------------+
        |                       |                       |
+-------v-------+       +-------v-------+       +-------v-------+
|  WindowsAdapter|      |  LinuxAdapter |       |  DarwinAdapter|
| (win32)       |       | (linux)       |       | (darwin)      |
+---------------+       +---------------+       +---------------+
```

#### 3.1 Platform Command Matrix

| Operation | Windows (win32) | Linux (linux) | macOS (darwin) |
| :--- | :--- | :--- | :--- |
| **Active Interface & IP** | `ipconfig /all` + `route print` | `ip -j addr` or `ip route show` | `ifconfig` + `netstat -rn -f inet` |
| **ARP Table Read** | `arp -a` or `Get-NetNeighbor -AddressFamily IPv4` | `ip -j neigh` or `/proc/net/arp` | `arp -an` |
| **Single Host Ping** | `ping -n 1 -w <ms> <ip>` | `ping -c 1 -W <sec> <ip>` | `ping -c 1 -t <sec> <ip>` |
| **NetBIOS Name Query** | `nbtstat -A <ip>` | `nmblookup -A <ip>` (if installed) | Direct UDP 137 NetBIOS packet |
| **Local Desktop Toast** | PowerShell `New-BurntToastNotification` / WinRT Toast | `notify-send` | `osascript -e 'display notification ...'` |

#### 3.2 Parsing Specification for Windows 11 (Inspected Host)
1. **`ipconfig /all` Parsing:**
   - Scan for adapter sections marked `Wireless LAN adapter` or `Ethernet adapter`.
   - Skip virtual adapters with `Media disconnected` or `Virtual Adapter`.
   - Extract `IPv4 Address: 192.168.31.98(Preferred)`, `Subnet Mask: 255.255.255.0`, `Default Gateway: 192.168.31.1`, `Physical Address: 28-2E-89-01-D4-2E`.
2. **`route print` Fallback:**
   - Detect primary route where `Network Destination` is `0.0.0.0` and `Netmask` is `0.0.0.0`.
   - Map `Gateway` (`192.168.31.1`) and `Interface` (`192.168.31.98`).
3. **`arp -a` Parsing:**
   - Parse lines matching regex: `^\s*([0-9.]+)\s+([0-9a-fA-F-]+)\s+dynamic|static`
   - Normalize MAC address to uppercase colon-separated format (`28:2E:89:01:D4:2E`).
   - Filter out multicast/broadcast IP addresses (`224.0.0.0` to `239.255.255.255`, `255.255.255.255`, `192.168.31.255`).

---

### 4. Discovery Engine Deep-Dive

#### 4.1 Safe Two-Stage Discovery Pipeline
Relying solely on ping fails when hosts run stealth firewalls (e.g., Windows Firewall dropping ICMP Echo by default). Relying solely on the ARP table misses idle devices whose ARP entries expired. The system employs a **safe two-stage discovery pipeline**:

```
[Start Scan]
     |
     v
[Phase 1: Direct ARP Interrogation] 
Reads current OS ARP table. Instant, zero network traffic.
     |
     v
[Phase 2: Concurrency-Controlled Active Seeding]
Iterates over subnet IPs (192.168.31.1 to 192.168.31.254).
Pings via ICMP Echo + lightweight TCP SYN probe on ports [80, 443, 22, 445, 5357].
*Note: A response is NOT required! Even if the remote firewall drops the TCP packet, 
the local host OS Kernel MUST issue an ARP request to find the target's MAC address!*
     |
     v
[Phase 3: Post-Probe ARP Re-interrogation]
OS ARP table now contains updated physical MAC entries for all responding Layer-2 devices.
     |
     v
[Phase 4: Hostname & Identity Enrichment]
Performs reverse DNS (PTR), NetBIOS (UDP 137), mDNS queries for active IPs.
     |
     v
[Phase 5: State Machine & Event Dispatch]
Compares snapshot with Database; fires alerts for new/offline devices; commits to SQLite.
```

#### 4.2 Rate-Limiting & Sliding Window Algorithm
- **Batch Size:** Concurrency limit $C = 16$.
- **Inter-Batch Delay:** $D = 25\text{ ms}$.
- **Probe Timeout:** $T = 400\text{ ms}$ per host.
- **Total Duration:** A full `/24` (254 addresses) scan finishes in:
  $$\text{Batches} = \lceil 254 / 16 \rceil = 16 \text{ batches} \implies 16 \times (400\text{ ms} + 25\text{ ms}) \approx 6.8\text{ seconds}$$
- **Bandwidth Consumption:** Total packets generated per scan $\approx 254 \text{ hosts} \times 2 \text{ packets} = 508 \text{ packets}$.
  $$508 \text{ packets} \times 64 \text{ bytes} \approx 32.5 \text{ KB total over } 7\text{ seconds} \approx 4.6 \text{ KB/sec}$$
  This is negligible and 100% safe for low-end home routers.

#### 4.3 Randomized MAC Address Detection
Modern iOS, Android, and Windows devices generate randomized MAC addresses to prevent tracking. The system detects locally administered addresses:
- In IEEE 802 MAC addressing, octet 0 bit 1 is the **U/L (Universal/Local)** bit:
  - `0`: Universally Administered Address (burned in by hardware manufacturer).
  - `1`: Locally Administered Address (software randomized).
- **Mask Check:** `(parseInt(mac.substring(0, 2), 16) & 0x02) !== 0`
- If set, the UI displays a badge: `[Private / Randomized MAC]` and explains: *"This device uses MAC randomization. Its MAC address may change on subsequent connections."*

---

### 5. Database Schema & Persistence Specification

Storage engine: SQLite 3 via Node 22 built-in `node:sqlite`.  
File: `data/lan_security.db`.

```sql
-- Pragmas for performance and data safety
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

-- 1. Devices Inventory
CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mac_address TEXT UNIQUE NOT NULL,            -- e.g. '28:2E:89:01:D4:2E' or 'UNAVAILABLE-192.168.31.50'
    last_ip TEXT NOT NULL,                       -- Current or last known IPv4
    hostname TEXT,                               -- Resolved or NULL
    custom_name TEXT,                            -- User-assigned alias (e.g. 'Ajit Work Laptop')
    vendor TEXT,                                 -- Resolved OUI vendor or 'Unknown'
    is_randomized_mac INTEGER DEFAULT 0,         -- 1 if bit 1 of byte 0 is 1
    trust_level TEXT DEFAULT 'untrusted',        -- 'trusted', 'familiar', 'untrusted'
    status TEXT DEFAULT 'online',                -- 'online', 'unreachable', 'stale'
    first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_devices_mac ON devices(mac_address);
CREATE INDEX IF NOT EXISTS idx_devices_last_ip ON devices(last_ip);
CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);

-- 2. Device IP History (Tracks DHCP reassignments and churn)
CREATE TABLE IF NOT EXISTS device_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER NOT NULL,
    ip_address TEXT NOT NULL,
    recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
);

-- 3. Security & Event Log
CREATE TABLE IF NOT EXISTS event_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,                    -- 'DEVICE_NEW', 'DEVICE_OFFLINE', 'DEVICE_ONLINE', 'IP_CHANGED', 'GATEWAY_ALERT'
    severity TEXT NOT NULL,                      -- 'INFO', 'WARNING', 'CRITICAL'
    device_id INTEGER,
    mac_address TEXT,
    ip_address TEXT,
    message TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    acknowledged INTEGER DEFAULT 0,
    FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_events_created ON event_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_type ON event_logs(event_type);

-- 4. Network Scan Execution Records
CREATE TABLE IF NOT EXISTS scan_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at DATETIME NOT NULL,
    completed_at DATETIME,
    hosts_scanned INTEGER DEFAULT 0,
    devices_found INTEGER DEFAULT 0,
    duration_ms INTEGER,
    trigger_type TEXT DEFAULT 'manual'          -- 'manual', 'scheduled'
);

-- 5. Persistent System Settings
CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

### 6. REST API & Server-Sent Events (SSE) Specification

All endpoints are hosted on `http://127.0.0.1:3000`.

#### 6.1 Endpoints Summary

| Method | Route | Description |
| :--- | :--- | :--- |
| `GET` | `/api/system/info` | Host interface diagnostics (adapter, IP, gateway, CIDR). |
| `GET` | `/api/devices` | List all discovered devices with current status and metadata. |
| `GET` | `/api/devices/:id` | Get single device profile with full historical IP changes. |
| `PATCH` | `/api/devices/:id` | Update custom alias, trust level, and admin notes. |
| `POST` | `/api/scan/start` | Trigger manual network discovery scan. |
| `POST` | `/api/scan/stop` | Abort or pause an in-progress scan sweep. |
| `GET` | `/api/events` | Query audit event log (filter by type, severity, date). |
| `POST` | `/api/events/:id/ack`| Acknowledge / dismiss an alert. |
| `GET` | `/api/stream` | Server-Sent Events stream for real-time UI synchronization. |
| `GET` | `/api/router/info` | Router configuration guidance and default portal links. |

#### 6.2 SSE Real-Time Event Stream (`GET /api/stream`)
Format: `text/event-stream`  
Clients receive events without polling:
```json
// Example: Scan progress update
event: scan_progress
data: {"scanned": 128, "total": 254, "percent": 50, "devicesFound": 4}

// Example: New device detected alert
event: new_device
data: {
  "id": 5,
  "ip": "192.168.31.142",
  "mac": "BC:D0:74:11:22:33",
  "vendor": "Espressif Inc.",
  "hostname": "esp32-sensor",
  "isRandomized": false,
  "timestamp": "2026-11-04T02:15:00.000Z"
}

// Example: Device state change
event: device_state
data: {"id": 2, "mac": "28:2E:89:01:D4:2E", "status": "online", "lastSeen": "2026-11-04T02:15:05.000Z"}
```

---

### 7. Security Architecture & Input Validation

1. **Localhost Isolation:** Default server listener binds to `127.0.0.1`. It does not expose administrative endpoints to the wider LAN unless explicitly commanded.
2. **Command Injection Prevention:** Never construct shell command strings with unsanitized user inputs. All parameters to `execFile` and `spawn` are strictly validated as valid IPv4 regex (`^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$`).
3. **No Plain-Text Credentials:** If router integration is enabled, API tokens or passwords are never committed to code, stored in logs, or displayed in the UI.
4. **Subnet Scope Enforcer:** Probing logic enforces that all target IPs must strictly reside inside the calculated network boundaries of the active local subnet mask. Requests targeting external or public IPs are discarded with HTTP 400.
5. **Administrator Bootstrap:** The first administrator is created through a one-time setup page available only from a loopback connection. There are no default credentials. Login IDs are normalized to lowercase; passwords require 12–128 characters and are stored as salted scrypt hashes in SQLite.
6. **Session Protection:** A successful sign-in receives a cryptographically random, HttpOnly, SameSite=Strict cookie. Sessions expire after eight hours and are invalidated on sign-out or server restart. Administrative API routes and the dashboard require a valid session; failed sign-ins are rate-limited.

---

### 8. Automated Testing Strategy

Automated tests are built using Node.js's native test runner (`node:test` and `node:assert`):
1. **Network Calculation Tests:**
   - Validates CIDR range generation for `/24`, `/23`, `/28` subnets.
   - Validates gateway and broadcast exclusion.
2. **Command Output Parser Tests:**
   - Unit tests feeding fixture outputs of Windows `ipconfig /all`, `route print`, `arp -a`, and `Get-NetNeighbor`.
   - Unit tests feeding fixture outputs of Linux `ip neigh` and macOS `arp -an`.
3. **MAC & OUI Tests:**
   - Tests detection of randomized MAC addresses (e.g. `2A:2E:89:...` -> `true`).
   - Tests OUI vendor matching for known prefixes.
4. **State Machine & Anomaly Tests:**
   - Tests device lifecycle transitions (`NEW` -> `ONLINE` -> `UNREACHABLE` -> `RECONNECTED`).
   - Tests `IP_CHANGED` trigger when MAC acquires new IP.
   - Tests `GATEWAY_MISMATCH` detection.
