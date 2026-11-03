# Product Requirements Document (PRD)
## Smart LAN Security System (v1.0)

**Project Name:** Smart LAN Security System  
**Document Version:** 1.0.0  
**Status:** Approved for Implementation  
**Primary Target OS:** Windows 11 / 10 (Inspected Host: Windows 11 Build 26200, Node.js v22.14.0)  
**Secondary Supported OS:** Linux (Debian/Ubuntu, RHEL/Fedora), macOS (macOS 12+)  
**Repository Directory:** `e:\Lan project 2.0`  

---

### 1. Executive Summary & Objective

The **Smart LAN Security System** is a lightweight, privacy-respecting, and honest local network monitoring solution designed for small-office and home-office (SOHO) local networks. It monitors computers and devices connected to a standard router via Ethernet LAN cables or Wi-Fi.

Unlike commercial tools that make exaggerated marketing claims (e.g., claiming to "block any hacker" or "sniff all packet payloads" from an unmanaged client machine), this system is built on **verifiable networking realities**:
1. **Device Discovery & Inventory:** Discover hosts on the local administrator-approved subnet using documented OS mechanisms (ARP neighbor tables, rate-limited ICMP ping sweeps, and synthetic TCP connection probing).
2. **Device State & Reachability Tracking:** Continuously monitor whether devices are online, newly connected, or absent, tracking IP address fluctuations and MAC address stability.
3. **New Device & Anomaly Alerting:** Alert the administrator immediately via local notification mechanisms when an unknown or unfamiliar device joins the subnet.
4. **Transparent Boundaries:** Clearly report missing or unavailable metadata (e.g., hostnames blocked by firewalls, randomized MAC addresses, sleeping devices) without hallucinating false identities.
5. **Zero Cloud Requirement:** Function 100% locally with zero internet dependency, zero external cloud relays, and zero plain-text credential leaks.

---

### 2. Operating Environment & Compatibility Assumptions

#### 2.1 Target Environment Inspection (Current Host)
During pre-flight inspection on the host machine, the following operating parameters were determined:
- **Operating System:** Microsoft Windows 11 (NT Kernel 10.0.26200.0)
- **Host Name:** `LAPTOP-NGOP926R`
- **Active Adapter:** `Realtek RTL8852BE-VS WiFi 6 802.11ax PCIe Adapter` (`Wi-Fi`)
- **Physical Address (MAC):** `28-2E-89-01-D4-2E`
- **Assigned Local IPv4:** `192.168.31.98`
- **Subnet Mask:** `255.255.255.0` (`/24` CIDR, range `192.168.31.1` to `192.168.31.254`)
- **Default Gateway:** `192.168.31.1` (Router DHCP Server: `192.168.31.1`)
- **Runtime Environment:** Node.js v22.14.0 (with native `node:sqlite` SQLite 3.47.2 embedded support), standard Windows PowerShell.

#### 2.2 Supported Network Topologies
- **Standard Unmanaged Home/SOHO Routers:** Single broadcast domain subnet (e.g., `/24`, `/23`). Wired Ethernet connections and Wi-Fi access points sharing the same bridge interface.
- **Dual Connectivity:** Computers connected directly to router LAN switch ports (RJ-45) or through unmanaged Ethernet gigabit switches.
- **Cross-Platform Host Support:**
  - **Windows (Primary):** Interrogates Windows IP configuration, native routing tables (`route print`), and Neighbor Discovery / ARP cache (`Get-NetNeighbor` / `arp -a`).
  - **Linux (Secondary):** Interrogates `ip route`, `/proc/net/arp`, and `ip neigh`.
  - **macOS (Secondary):** Interrogates `ifconfig`, `netstat -rn`, and `arp -an`.

#### 2.3 Operating Boundaries & Limitations (What We Do NOT Claim)
1. **No Promiscuous Switched Sniffing:** Modern Ethernet switches and Wi-Fi access points do not broadcast unicast packets to all ports. A host on port 2 cannot see web traffic between port 3 and the router without ARP poisoning or a managed SPAN/mirror port. The system does *not* claim to inspect payload traffic of other devices.
2. **No Hardware Blocking Without Verified Router APIs:** A normal PC cannot physically disconnect another computer from a standard router switch port. Blocking can only be achieved by accessing the router's documented administration interface (e.g., MAC filtering API) or by advising the administrator to manually blacklist the MAC in their router portal (`http://192.168.31.1`).
3. **Client/AP Isolation:** When the router has "Client Isolation" or "Guest Wi-Fi" enabled, wireless clients are blocked from communicating with each other at Layer 2. The system explicitly flags this condition if only the gateway is discoverable.
4. **VLAN Separation:** Devices residing on a separate Virtual LAN or isolated corporate VLAN subnet are mathematically unreachable from the primary broadcast domain unless routed. The system limits scans strictly to the local subnet.

---

### 3. User Personas & Use Cases

| Persona | Environment | Primary Need |
| :--- | :--- | :--- |
| **SOHO / Homelab Admin** | Multi-device LAN (PCs, NAS, smart TVs, Raspberry Pi, phones) | Immediate notification when a new device joins the Wi-Fi or Ethernet LAN; fast lookup of device IPs and MACs. |
| **Small Office Manager** | 10–50 office computers, shared printers, wired workstations | Inventory audit of active devices; detection of unauthorized rogue laptops plugged into office Ethernet wall jacks. |
| **Privacy-Minded Worker** | Home router with multiple IoT/guest devices | Ensuring smart home appliances stay within their known IP ranges and receiving alerts if unexpected devices appear. |

---

### 4. Detailed Functional Requirements

#### 4.1 Module 1: Pre-Flight & Network Interface Diagnostics
- **FR-1.1:** System shall automatically detect and display the host machine's active network adapter name, interface description, MAC address, IPv4 address, subnet mask, CIDR prefix length, and default gateway IP.
- **FR-1.2:** System shall calculate and display the valid host IP range (e.g., `192.168.31.1` – `192.168.31.254` for a `/24` subnet).
- **FR-1.3:** System shall verify whether the gateway is reachable and test basic local network read permissions.
- **FR-1.4:** System shall output clear diagnostic warnings if:
  - The host is connected to a public/unidentified network profile.
  - Subnet mask is larger than `/22` (exceeds 1024 hosts), requiring administrator confirmation before sweeping.
  - Default gateway is missing or unresponsive.

#### 4.2 Module 2: Safe, Rate-Limited Discovery Engine
- **FR-2.1:** **Dual-Phase Discovery:**
  - *Phase A (Cache Interrogation):* Read OS ARP/Neighbor cache directly to capture all known Layer-2 bindings with zero network traffic.
  - *Phase B (Synthetic ARP Seeding):* Perform rate-limited, low-concurrency probes (ICMP Echo + TCP SYN checks to standard ports `80`, `443`, `22`, `445`, `5357`) against the local subnet IP addresses. This triggers the host OS kernel to issue standard ARP resolution requests without saturating the router.
- **FR-2.2:** **Rate Limiting & Concurrency Controls:**
  - Default concurrency shall not exceed 16 simultaneous host probes.
  - Delay between subnet batches shall be configurable (default 25 ms per batch).
  - Maximum scan packet rate shall remain under 50 packets per second.
- **FR-2.3:** **Scanning Controls:**
  - Administrator can start, pause, resume, or abort an active scan at any time.
  - Periodic background scan interval can be scheduled (e.g., every 60s, 5m, 15m, or Manual only).
- **FR-2.4:** **Strict Subnet Boundary:** The system shall refuse to scan any IP address outside the administrator-approved local subnet. Public IP ranges (RFC 1918 exceptions) are strictly rejected.

#### 4.3 Module 3: Device Attribution & Metadata Resolution
For every discovered device, the system shall record and display:
- **FR-3.1 IP Address:** Current IPv4 address assigned to the host.
- **FR-3.2 MAC Address:** Hardware physical address (format: `XX:XX:XX:XX:XX:XX`). If unavailable, explicitly labeled `"Unavailable (Silent/Hidden)"`.
- **FR-3.3 MAC Type (Randomized vs. Hardware):**
  - Detect IEEE 802 Locally Administered Addresses (LAA) where bit 1 of the first octet is set to `1` (e.g., `x2:`, `x6:`, `xA:`, `xE:`).
  - Label as `"Private / Randomized MAC"` (common on iOS 14+, Android 10+, Windows 10/11 Wi-Fi privacy) and explain that device tracking across reconnects may vary.
- **FR-3.4 Hardware Vendor (OUI):** Resolved via an offline IEEE Organizational Unique Identifier database (e.g., "Apple, Inc.", "Raspberry Pi Foundation", "Realtek Semiconductor"). If not found, labeled `"Unknown Vendor"`.
- **FR-3.5 Hostname:** Resolved non-intrusively via:
  1. Local DNS reverse lookup (PTR query).
  2. NetBIOS Name Service query (UDP 137) for Windows/Samba hosts.
  3. Multicast DNS (mDNS / Bonjour `.local`) query.
  - If unresolvable, displayed as `"(Unassigned / Hidden Hostname)"`.
- **FR-3.6 Reachability State:**
  - `Online` (Responded to probe or active ARP entry within last cycle).
  - `Unreachable` (ARP entry timed out or failed ping verification).
  - `Stale` (Not seen for > 10 minutes).
- **FR-3.7 Timestamps:** `First Seen`, `Last Active Scan`, `Last State Change`.

#### 4.4 Module 4: Device History & Anomaly Detection
- **FR-4.1 Persistent Inventory:** Maintain a local SQLite database of all devices ever detected on the network.
- **FR-4.2 Custom Device Labeling:** Administrator can assign custom aliases (e.g., "Ajit-Work-Laptop", "LivingRoom-SmartTV", "Router-Gateway") and trust levels (`Trusted`, `Familiar`, `Suspicious / Unknown`).
- **FR-4.3 Event Engine:** Generate auditable log events with timestamps for:
  - `DEVICE_NEW`: A previously unseen MAC or IP address appeared.
  - `DEVICE_OFFLINE`: A previously active device stopped responding.
  - `DEVICE_ONLINE`: A known device reappeared.
  - `IP_CHANGED`: Known MAC address acquired a new IP address (DHCP renewal).
  - `IP_CONFLICT`: An existing IP address is suddenly claimed by a different MAC address.
  - `GATEWAY_MISMATCH`: Gateway IP address mapped to an unexpected MAC address (possible ARP spoofing / rogue DHCP alert).

#### 4.5 Module 5: Local Alerting & Notification System
- **FR-5.1 Zero-Cloud Operation:** All alerts must operate without requiring SMTP configuration, external cloud webhooks, or internet access.
- **FR-5.2 Notification Channels:**
  - **In-App Visual & Audio Alerts:** Prominent toast notification banners in the web dashboard + optional subtle audio chime.
  - **OS Desktop Toast Notifications:** Native Windows Notifications (via PowerShell WinRT toast or native notification utility), Linux `notify-send`, macOS `osascript`.
  - **Persistent Event Log:** Filterable, searchable in-app audit log stored in local database.
- **FR-5.3 Alert Throttling:** Debounce repeated flapping alerts (e.g., when a mobile device sleeps and wakes repeatedly) within a 5-minute suppression window.

#### 4.6 Module 6: Web Dashboard & User Interface
- **FR-6.1 Clean Responsive Interface:** Modern, high-performance web dashboard accessible via any browser at `http://localhost:3000` (or local LAN IP if bound).
- **FR-6.2 Network Overview Card:** Displays current adapter, local IP, gateway, CIDR subnet, total devices online, new devices today, and scan engine state.
- **FR-6.3 Device Table:**
  - Searchable by IP, MAC, Vendor, Hostname, and Custom Alias.
  - Filterable by Status (`All`, `Online`, `Unreachable`, `Untrusted / New`).
  - Sortable by IP address (natural numerical order), Last Seen timestamp, or Status.
- **FR-6.4 Control Bar:** Manual "Scan Now" button, Scan Progress bar, Scan Interval selector, Pause/Resume toggle.
- **FR-6.5 Device Detail Drawer/Modal:** Click on any device to view full history, IP reassignment logs, raw ARP/packet response stats, and edit custom alias/trust tags.
- **FR-6.6 Router Guidance Section:** Direct link to local router admin portal (`http://192.168.31.1`) with instructions for configuring MAC filtering, parental controls, or static DHCP reservations.

---

### 5. Non-Functional Requirements (NFR)

| Category | Requirement | Target Metric |
| :--- | :--- | :--- |
| **Performance** | Subnet scan execution time | Full `/24` (254 hosts) discovery sweep completes in < 15 seconds. |
| **Resource Usage** | Host CPU & Memory footprint | Idle CPU < 1%, Scan CPU < 5%, Memory usage < 75 MB RAM. |
| **Network Overhead**| Bandwidth consumption | Peak network throughput during scan < 100 KB/s; strictly rate-limited. |
| **Reliability** | Local storage durability | ACID compliance using embedded SQLite with Write-Ahead Logging (WAL). |
| **Security** | Localhost binding by default | Binds to `127.0.0.1`. If LAN binding enabled, requires optional admin API token. |
| **Zero Bloat** | Standalone runtime | Zero heavy build toolchains; native Node.js ES/CommonJS execution. |

---

### 6. Acceptance Criteria

1. **Host Verification:** System automatically detects and prints Windows 11 host IP (`192.168.31.98`), subnet (`255.255.255.0`), and gateway (`192.168.31.1`).
2. **Multi-Device Discovery:** System discovers at least two distinct active LAN devices (e.g., host PC + router gateway + any secondary phone or PC).
3. **Accuracy & Labeling:** Every device entry displays accurate IP and MAC address; non-resolvable hostnames are explicitly marked as `Unavailable` without dummy text.
4. **State Change Verification:** Disconnecting or re-connecting a device triggers a corresponding state transition event (`DEVICE_OFFLINE` / `DEVICE_ONLINE`) in the event log.
5. **Rate-Limiting & Stability:** Running 5 consecutive scans does not saturate the router, cause packet drops, or interrupt other network streaming.
6. **Self-Contained Integrity:** Application starts cleanly from a single command (`npm start` or `node src/index.js`) and passes automated test suites without external network access.

