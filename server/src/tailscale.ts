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
 * Find available Tailscale CLI executable on the system.
 */
export function findTailscaleCli(): string | null {
  const candidateCommands = [
    'tailscale',
    '/opt/homebrew/bin/tailscale',
    '/usr/local/bin/tailscale',
    '/usr/bin/tailscale',
    'C:\\Program Files\\Tailscale\\tailscale.exe',
  ];

  for (const cmd of candidateCommands) {
    try {
      execFileSync(cmd, ['version'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 2000,
      });
      return cmd;
    } catch {
      // Command failed or not found, try next candidate
    }
  }
  return null;
}

/**
 * Retrieve MagicDNS domain name for this node (e.g. "my-node.tailnet-name.ts.net").
 */
export function getTailscaleMagicDnsName(): string | null {
  const cli = findTailscaleCli();
  if (!cli) return null;

  try {
    const output = execFileSync(cli, ['status', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    });
    const data = JSON.parse(output);
    if (data.BackendState !== 'Running') {
      return null;
    }
    const dnsName = data.Self?.DNSName?.replace(/\.+$/, '') || data.CertDomains?.[0] || null;
    return dnsName;
  } catch {
    return null;
  }
}

/**
 * Result of configuring Tailscale Serve for HTTPS.
 */
export interface TailscaleServeResult {
  enabled: boolean;
  httpsUrl: string | null;
  magicDns: string | null;
  targetPort: number;
  error?: string;
}

/**
 * Configure Tailscale Serve to proxy incoming HTTPS traffic to targetPort.
 * This provides a valid TLS certificate and Secure Context across the Tailnet.
 */
export function setupTailscaleServe(targetPort: number): TailscaleServeResult {
  const cli = findTailscaleCli();
  if (!cli) {
    return {
      enabled: false,
      httpsUrl: null,
      magicDns: null,
      targetPort,
      error: 'Tailscale CLI not found',
    };
  }

  const magicDns = getTailscaleMagicDnsName();
  if (!magicDns) {
    return {
      enabled: false,
      httpsUrl: null,
      magicDns: null,
      targetPort,
      error: 'Tailscale is not active or MagicDNS not found',
    };
  }

  try {
    // Run: tailscale serve --bg --yes <targetPort>
    execFileSync(cli, ['serve', '--bg', '--yes', String(targetPort)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
    });

    const httpsUrl = magicDns ? `https://${magicDns}/` : null;
    return {
      enabled: true,
      httpsUrl,
      magicDns,
      targetPort,
    };
  } catch (err: any) {
    return {
      enabled: false,
      httpsUrl: null,
      magicDns,
      targetPort,
      error: err.message || String(err),
    };
  }
}

/**
 * Reset any active Tailscale Serve configuration.
 */
export function resetTailscaleServe(): boolean {
  const cli = findTailscaleCli();
  if (!cli) return false;

  try {
    execFileSync(cli, ['serve', 'reset'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Attempt to obtain Tailscale IPv4 address via the `tailscale` CLI command.
 * Only returns an IP if Tailscale is running and connected.
 */
export function getTailscaleIpFromCli(): string | null {
  const cli = findTailscaleCli();
  if (!cli) return null;

  try {
    const statusOutput = execFileSync(cli, ['status', '--json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000,
    });
    const data = JSON.parse(statusOutput);
    if (data.BackendState !== 'Running') {
      return null;
    }

    const output = execFileSync(cli, ['ip', '-4'], {
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
    // Ignore error
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
