const { createPlatformAdapter } = require('./platform');
const config = require('../config');

class Notifier {
  constructor({ platformAdapter = null, sseManager = null } = {}) {
    this.adapter = platformAdapter || createPlatformAdapter();
    this.sse = sseManager;
    this.enableDesktopToast = config.alerts.enableDesktopToast;
  }

  setSseManager(sseManager) {
    this.sse = sseManager;
  }

  /**
   * Dispatches a notification event across all available local channels.
   * @param {object} event 
   */
  async notify(event) {
    const title = this.formatTitle(event);
    const message = event.message;

    // 1. Broadcast via SSE to connected browser clients
    if (this.sse) {
      this.sse.broadcast('alert', {
        id: event.id,
        eventType: event.event_type,
        severity: event.severity,
        mac: event.mac_address,
        ip: event.ip_address,
        message: event.message,
        createdAt: event.created_at
      });
    }

    // 2. Local OS Desktop Toast Notification
    if (this.enableDesktopToast && this.adapter && typeof this.adapter.showToast === 'function') {
      try {
        await this.adapter.showToast(title, message);
      } catch {
        // Desktop notification failure should never crash the app
      }
    }
  }

  formatTitle(event) {
    switch (event.event_type) {
      case 'DEVICE_NEW':
        return 'LAN Alert: New Device Detected';
      case 'GATEWAY_MISMATCH':
        return 'CRITICAL: Gateway Security Warning';
      case 'IP_CHANGED':
        return 'LAN Notice: Device IP Reassigned';
      case 'DEVICE_OFFLINE':
        return 'LAN Notice: Device Offline';
      case 'DEVICE_ONLINE':
        return 'LAN Notice: Device Reconnected';
      default:
        return 'LAN Security Notification';
    }
  }
}

module.exports = Notifier;

