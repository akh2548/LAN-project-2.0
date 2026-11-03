class SSEManager {
  constructor() {
    this.clients = new Set();
    this.keepAliveInterval = null;
    this.startKeepAlive();
  }

  handleRequest(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });

    res.write('retry: 3000\n\n');
    res.write(`event: connected\ndata: ${JSON.stringify({ time: new Date().toISOString() })}\n\n`);

    this.clients.add(res);

    req.on('close', () => {
      this.clients.delete(res);
    });
  }

  broadcast(eventType, data) {
    const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.clients) {
      try {
        client.write(payload);
      } catch {
        this.clients.delete(client);
      }
    }
  }

  startKeepAlive() {
    this.keepAliveInterval = setInterval(() => {
      for (const client of this.clients) {
        try {
          client.write(': keepalive\n\n');
        } catch {
          this.clients.delete(client);
        }
      }
    }, 15000);
    this.keepAliveInterval.unref();
  }

  close() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
    }
    for (const client of this.clients) {
      try {
        client.end();
      } catch {
        // Ignore
      }
    }
    this.clients.clear();
  }
}

module.exports = SSEManager;

