/**
 * Router Advisor & Security Boundary Helper
 * 
 * Provides honest educational guidance for router administration,
 * MAC filtering, client isolation, and hardware limits.
 */
class RouterAdvisor {
  static getGuidance(gatewayIp = '192.168.31.1') {
    return {
      gatewayIp,
      portalUrl: `http://${gatewayIp}`,
      boundaryNotice: {
        title: 'Router & Switched Network Security Realities',
        points: [
          'A program running on a standard computer cannot forcibly disconnect another device from your router without router credentials or harmful network de-authentication attacks.',
          'Modern Ethernet switches and Wi-Fi access points separate traffic so that unicast traffic between other devices does not pass through this computer.',
          'To block or blacklist a device, you must configure MAC Filtering or Access Control directly on your router administration portal.'
        ]
      },
      routerGuides: [
        {
          brand: 'Xiaomi / Mi Wi-Fi',
          defaultIp: '192.168.31.1',
          steps: [
            'Log into http://192.168.31.1 or miwifi.com using your router admin password.',
            'Navigate to "Security" or "Device Control".',
            'Find the unfamiliar MAC address in the connected list and click "Blacklist" or toggle "Access Permitted" to OFF.',
            'To isolate smart home devices, enable "Guest Wi-Fi" from the Wi-Fi settings.'
          ]
        },
        {
          brand: 'TP-Link',
          defaultIp: '192.168.0.1 or 192.168.1.1',
          steps: [
            'Open http://tplinkwifi.net or http://192.168.0.1.',
            'Go to Advanced > Security > Access Control.',
            'Toggle Access Control to ON, select "Blacklist Mode", and add the target device MAC.',
            'Under Advanced > Wireless > Wireless Settings, check "Enable AP Isolation" if you want to prevent Wi-Fi clients from communicating with each other.'
          ]
        },
        {
          brand: 'Asus (AsusWRT)',
          defaultIp: '192.168.50.1 or 192.168.1.1',
          steps: [
            'Open http://router.asus.com in your browser.',
            'Go to Wireless > Wireless MAC Filter.',
            'Set MAC Filter Mode to "Reject" and add the MAC address to block it.',
            'Under Guest Network, enable "Access Intranet: OFF" for guest devices.'
          ]
        },
        {
          brand: 'Netgear',
          defaultIp: '192.168.1.1',
          steps: [
            'Log into http://routerlogin.net.',
            'Navigate to Advanced > Security > Access Control.',
            'Check "Turn on Access Control" and choose "Block all new devices from connecting".',
            'Select the target device from the list and click "Block".'
          ]
        },
        {
          brand: 'OpenWrt / DD-WRT',
          defaultIp: '192.168.1.1',
          steps: [
            'Log into LuCI web interface at http://192.168.1.1.',
            'Navigate to Network > Wireless > Edit Interface > Wireless Security > MAC-Filter.',
            'Select "Allow all except listed (Blacklist)" and enter the MAC address.',
            'Click Save & Apply to enforce rule in hostapd.'
          ]
        }
      ]
    };
  }
}

module.exports = RouterAdvisor;

