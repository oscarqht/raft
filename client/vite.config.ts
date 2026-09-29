import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

function isTailscaleIp(ip: string): boolean {
  if (!ip) return false;
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return false;
  const octets = parts.map((p) => parseInt(p, 10));
  if (octets.some((o) => isNaN(o) || o < 0 || o > 255)) return false;
  return octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127;
}

function resolveHost(): string {
  const envHost = process.env.HOST || process.env.TAILSCALE_IP || process.env.HOSTNAME;
  if (envHost && envHost.trim().length > 0) {
    return envHost.trim();
  }
  try {
    const interfaces = os.networkInterfaces();
    for (const [_name, addrs] of Object.entries(interfaces)) {
      if (!addrs) continue;
      for (const addr of addrs) {
        if (addr.family === 'IPv4' && !addr.internal && isTailscaleIp(addr.address)) {
          return addr.address;
        }
      }
    }
  } catch {}

  const candidateCommands = [
    'tailscale',
    '/opt/homebrew/bin/tailscale',
    '/usr/local/bin/tailscale',
    '/usr/bin/tailscale',
  ];
  for (const cmd of candidateCommands) {
    try {
      const output = execFileSync(cmd, ['ip', '-4'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 2000,
      }).trim();
      for (const line of output.split(/[\r\n]+/)) {
        if (isTailscaleIp(line.trim())) {
          return line.trim();
        }
      }
    } catch {}
  }
  return '127.0.0.1';
}

const host = resolveHost();

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'esnext',
    cssCodeSplit: true,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@tldraw')) {
              return 'vendor-tldraw';
            }
            if (id.includes('mermaid') || id.includes('cytoscape') || id.includes('dagre') || id.includes('cose-bilkent')) {
              return 'vendor-mermaid';
            }
            if (id.includes('react') || id.includes('react-dom') || id.includes('react-router-dom')) {
              return 'vendor-react';
            }
            if (id.includes('lucide-react')) {
              return 'vendor-icons';
            }
            if (id.includes('react-markdown') || id.includes('remark-') || id.includes('micromark') || id.includes('unist-') || id.includes('mdast-')) {
              return 'vendor-markdown';
            }
            if (id.includes('ansi-to-react')) {
              return 'vendor-ansi';
            }
          }
        },
      },
    },
  },
  server: {
    host: true,
    port: 3300,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: `http://${host}:3301`,
        changeOrigin: true,
        ws: true,
      },
      '/ws': {
        target: `ws://${host}:3301`,
        ws: true,
      },
    },
  },
});
