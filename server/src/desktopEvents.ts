import type { ServerResponse } from 'node:http';

// A single authenticated desktop connection. No timer runs when disconnected.
export class DesktopEvents {
  private response: ServerResponse | null = null;
  attach(response: ServerResponse): void {
    this.response?.end();
    this.response = response;
    response.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
    response.flushHeaders();
    this.send({ type: 'connected' });
    const heartbeat = setInterval(() => this.send({ type: 'heartbeat' }), 30000);
    heartbeat.unref();
    response.once('close', () => {
      clearInterval(heartbeat);
      if (this.response === response) this.response = null;
    });
  }
  send(event: unknown): boolean {
    const response = this.response;
    if (!response || response.destroyed || response.socket?.destroyed || response.writableEnded) return false;
    // Disconnect a stuck receiver instead of growing memory indefinitely.
    if (response.writableLength > 1024 * 1024) { response.destroy(); return false; }
    response.write(JSON.stringify(event) + '\n');
    return true;
  }
}
