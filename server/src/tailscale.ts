import os from 'node:os';
import { execFileSync } from 'node:child_process';

/**
 * Tailscale assigns IPv4 addresses from the CGNAT range 100.64.0.0/10 (100.64.0.0 - 100.127.255.255).
 */
export function isTailscaleIp(ip: string): boolean {
  if (!ip) return false;
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return false;
  const octets = parts.map((p) => parseInt(p, 10));
  if (octets.some((o) => isNaN(o) || o < 0 || o > 255)) return false;
  return octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127;
}

/**
 * Scan network interfaces for a Tailscale IPv4 address.
 */
export function getTailscaleIpFromInterfaces(): string | null {
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
  } catch {
    // Ignore network interface enumeration errors
  }
  return null;
}

/**
 * Attempt to obtain Tailscale IPv4 address via the `tailscale` CLI command.
 */
export function getTailscaleIpFromCli(): string | null {
  const candidateCommands = [
    'tailscale',
    '/opt/homebrew/bin/tailscale',
    '/usr/local/bin/tailscale',
    '/usr/bin/tailscale',
    'C:\\Program Files\\Tailscale\\tailscale.exe',
  ];

  for (const cmd of candidateCommands) {
    try {
      const output = execFileSync(cmd, ['ip', '-4'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 2000,
      }).trim();

      const lines = output.split(/[\r\n]+/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (isTailscaleIp(trimmed)) {
          return trimmed;
        }
      }
    } catch {
      // Command failed or not found, try next candidate
    }
  }
  return null;
}

export interface ResolvedHostInfo {
  host: string;
  isTailscale: boolean;
  source: 'env' | 'interface' | 'cli' | 'fallback';
}

/**
 * Resolves the host IP to bind to.
 * Priority:
 * 1. HOST or TAILSCALE_IP environment variable
 * 2. Network interface with 100.64.0.0/10 CGNAT address
 * 3. `tailscale ip -4` CLI output
 * 4. Fallback to 127.0.0.1
 */
export function resolveHost(): ResolvedHostInfo {
  const envHost = process.env.HOST || process.env.TAILSCALE_IP || process.env.HOSTNAME;
  if (envHost && envHost.trim().length > 0) {
    const trimmed = envHost.trim();
    return {
      host: trimmed,
      isTailscale: isTailscaleIp(trimmed),
      source: 'env',
    };
  }

  const ifaceIp = getTailscaleIpFromInterfaces();
  if (ifaceIp) {
    return {
      host: ifaceIp,
      isTailscale: true,
      source: 'interface',
    };
  }

  const cliIp = getTailscaleIpFromCli();
  if (cliIp) {
    return {
      host: cliIp,
      isTailscale: true,
      source: 'cli',
    };
  }

  return {
    host: '127.0.0.1',
    isTailscale: false,
    source: 'fallback',
  };
}
