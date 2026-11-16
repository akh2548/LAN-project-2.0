/**
 * Router Advisor & Security Boundary Helper
 * 
 * Provides honest educational guidance for router administration,
 * MAC filtering, client isolation, and hardware limits.
 */
class RouterAdvisor {
  static getGuidance(gatewayIp = '192.168.0.1') {
    return {
      gatewayIp,
      portalUrl: `http://${gatewayIp}`,
      boundaryNotice: {
        title: 'Router & Switched Ethernet Security Realities',
        points: [
          'A program running on a standard computer cannot forcibly disconnect another wired device from an Ethernet switch without managed switch port control or router access.',
          'Switched Ethernet segments direct unicast frames only to the physical port where the destination MAC resides.',
          'To restrict or isolate a device, configure MAC Filtering, Static DHCP bindings, or Port Isolation directly on your router or switch administration portal.'
        ]
      },
      routerGuides: [
        {
          brand: 'TP-Link / Archer',
          defaultIp: '192.168.0.1 or 192.168.1.1',
          steps: [
            'Open http://tplinkwifi.net or http://192.168.0.1.',
            'Go to Advanced > Security > Access Control.',
            'Toggle Access Control to ON, select "Blacklist Mode", and add the target device MAC address.',
            'Under Network > DHCP Server, reserve static IP addresses for your recognized wired computers.'
          ]
        },
        {
          brand: 'Netgear',
          defaultIp: '192.168.1.1 or 192.168.0.1',
          steps: [
            'Open http://routerlogin.net or your gateway IP in your browser.',
            'Go to ADVANCED > Security > Access Control.',
            'Select "Turn on Access Control" and block unfamiliar MAC addresses.'
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

