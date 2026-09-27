import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn, execFile, execSync, ChildProcess } from 'node:child_process';

/**
 * Searches for an installed Chromium-based browser (Edge, Chrome, Chromium, Brave)
 * that supports headless CLI screenshots.
 */
export function findBrowserExecutable(): string | null {
  const platform = process.platform;
  const candidates: string[] = [];

  if (platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || '';
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

    candidates.push(
      path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe')
    );
  } else if (platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Chromium.app/Contents/MacOS/Chromium'
    );
  } else {
    // Linux
    candidates.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/microsoft-edge',
      '/usr/bin/microsoft-edge-stable',
      '/snap/bin/chromium'
    );
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // Fallback to checking PATH via where (Windows) or which (Unix)
  try {
    const cmd = platform === 'win32' ? 'where msedge 2>nul || where chrome 2>nul' : 'which google-chrome || which chromium || which msedge';
    const out = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 }).trim();
    const firstLine = out.split(/[\r\n]+/)[0]?.trim();
    if (firstLine && fs.existsSync(firstLine)) {
      return firstLine;
    }
  } catch {}

  return null;
}

export function isScreenshotSupported(): boolean {
  return findBrowserExecutable() !== null;
}

export interface ScreenshotResult {
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * Finds an available TCP port on localhost.
 */
function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

/**
 * Persistent Headless Chrome/Edge Worker using Chrome DevTools Protocol (CDP).
 * Keeps a single headless instance warm in the background, allowing subsequent
 * screenshots to be captured in ~100-150ms instead of cold-booting in 2500ms.
 */
class CdpScreenshotWorker {
  private proc: ChildProcess | null = null;
  private ws: any = null;
  private port: number = 0;
  private userDataDir: string = '';
  private isStarting: boolean = false;
  private startPromise: Promise<boolean> | null = null;
  private msgId: number = 1;

  async isAvailable(): Promise<boolean> {
    if (typeof globalThis.WebSocket === 'undefined') {
      return false;
    }
    const exe = findBrowserExecutable();
    return exe !== null;
  }

  async ensureReady(): Promise<boolean> {
    if (this.ws && this.proc && !this.proc.killed) {
      return true;
    }
    if (this.isStarting && this.startPromise) {
      return this.startPromise;
    }

    this.isStarting = true;
    this.startPromise = this.initWorker().finally(() => {
      this.isStarting = false;
      this.startPromise = null;
    });

    return this.startPromise;
  }

  private async initWorker(): Promise<boolean> {
    this.destroy();

    const browserPath = findBrowserExecutable();
    if (!browserPath) return false;

    try {
      this.port = await getAvailablePort();
      this.userDataDir = path.join(os.tmpdir(), `raft-cdp-${this.port}-${Date.now()}`);

      const args = [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--mute-audio',
        `--remote-debugging-port=${this.port}`,
        `--user-data-dir=${this.userDataDir}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-sync',
        '--disable-default-apps',
        '--allow-insecure-localhost',
        '--ignore-certificate-errors',
        'about:blank',
      ];

      this.proc = spawn(browserPath, args, { stdio: 'ignore' });
      this.proc.on('exit', () => {
        this.destroy();
      });

      // Poll for page WebSocket URL
      const pageWsUrl = await this.pollForPageWs(this.port, 35);
      if (!pageWsUrl) {
        this.destroy();
        return false;
      }

      const WebSocketCtor = globalThis.WebSocket;
      this.ws = new WebSocketCtor(pageWsUrl);

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('WebSocket connect timeout')), 3000);
        this.ws.addEventListener('open', () => {
          clearTimeout(timer);
          resolve();
        });
        this.ws.addEventListener('error', (err: any) => {
          clearTimeout(timer);
          reject(err);
        });
      });

      // Enable Page domain
      await this.sendCdp('Page.enable');
      return true;
    } catch (err) {
      console.warn('Failed to start CDP screenshot worker:', err);
      this.destroy();
      return false;
    }
  }

  private pollForPageWs(port: number, retries: number): Promise<string | null> {
    return new Promise((resolve) => {
      let attempts = 0;
      const check = () => {
        attempts++;
        if (attempts > retries) {
          return resolve(null);
        }

        http
          .get(`http://127.0.0.1:${port}/json/list`, (res) => {
            let data = '';
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => {
              try {
                const list = JSON.parse(data);
                const page = list.find((t: any) => t.type === 'page') || list[0];
                if (page?.webSocketDebuggerUrl) {
                  return resolve(page.webSocketDebuggerUrl);
                }
              } catch {}
              setTimeout(check, 60);
            });
          })
          .on('error', () => {
            setTimeout(check, 60);
          });
      };
      check();
    });
  }

  private sendCdp(method: string, params: any = {}): Promise<any> {
    if (!this.ws) return Promise.reject(new Error('WebSocket not connected'));

    const id = this.msgId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.ws?.removeEventListener('message', handler);
        reject(new Error(`CDP command timed out: ${method}`));
      }, 5000);

      const handler = (evt: any) => {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.id === id) {
            clearTimeout(timer);
            this.ws.removeEventListener('message', handler);
            if (msg.error) {
              reject(new Error(`CDP ${method} error: ${msg.error.message}`));
            } else {
              resolve(msg.result);
            }
          }
        } catch (e) {
          // Ignore JSON parse errors on stray frames
        }
      };

      this.ws.addEventListener('message', handler);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async capture(url: string, width: number, height: number): Promise<ScreenshotResult | null> {
    const ready = await this.ensureReady();
    if (!ready || !this.ws) {
      return null;
    }

    try {
      // Set viewport resolution
      await this.sendCdp('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });

      // Navigate and wait for Page.loadEventFired (with a 1500ms safety timeout)
      const loadPromise = new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          this.ws?.removeEventListener('message', handler);
          resolve();
        }, 1500);

        const handler = (evt: any) => {
          try {
            const msg = JSON.parse(evt.data);
            if (msg.method === 'Page.loadEventFired') {
              clearTimeout(timeout);
              this.ws?.removeEventListener('message', handler);
              resolve();
            }
          } catch {}
        };
        this.ws?.addEventListener('message', handler);
      });

      await Promise.all([loadPromise, this.sendCdp('Page.navigate', { url })]);

      // Allow modern SPA frameworks (Next.js, React, Vite) to hydrate and complete initial client-side fetches
      await new Promise((r) => setTimeout(r, 700));

      // Ensure target is active and bring to front
      await this.sendCdp('Page.bringToFront');

      // Capture screenshot
      const result = await this.sendCdp('Page.captureScreenshot', {
        format: 'png',
      });

      if (!result?.data) {
        throw new Error('CDP captureScreenshot returned no image data');
      }

      return {
        dataUrl: `data:image/png;base64,${result.data}`,
        width,
        height,
      };
    } catch (err) {
      console.warn('Persistent CDP capture error, invalidating worker:', err);
      this.destroy();
      return null;
    }
  }

  destroy(): void {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    if (this.proc && !this.proc.killed) {
      try {
        this.proc.kill();
      } catch {}
      this.proc = null;
    }
    if (this.userDataDir) {
      try {
        fs.rmSync(this.userDataDir, { recursive: true, force: true });
      } catch {}
      this.userDataDir = '';
    }
  }
}

// Global persistent CDP worker singleton
const workerInstance = new CdpScreenshotWorker();

// Clean up worker process when Node exits
process.on('exit', () => workerInstance.destroy());
process.on('SIGINT', () => {
  workerInstance.destroy();
  process.exit(0);
});
process.on('SIGTERM', () => {
  workerInstance.destroy();
  process.exit(0);
});

export function stopCdpWorker(): void {
  workerInstance.destroy();
}

export function warmupScreenshotWorker(): void {
  workerInstance.ensureReady().catch(() => {});
}

/**
 * Fast one-shot CLI fallback screenshot capture.
 */
async function captureUrlScreenshotCli(
  url: string,
  width: number = 1280,
  height: number = 800
): Promise<ScreenshotResult> {
  const browserPath = findBrowserExecutable();
  if (!browserPath) {
    throw new Error(
      'No compatible headless browser (Microsoft Edge or Google Chrome) found on host machine for server-side screenshots.'
    );
  }

  const tmpFile = path.join(
    os.tmpdir(),
    `raft-preview-${Date.now()}-${Math.random().toString(36).slice(2)}.png`
  );

  const args = [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--mute-audio',
    '--virtual-time-budget=150',
    '--run-all-compositor-stages-before-draw',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    `--window-size=${width},${height}`,
    `--screenshot=${tmpFile}`,
    '--allow-insecure-localhost',
    '--ignore-certificate-errors',
    '--no-first-run',
    '--no-default-browser-check',
    url,
  ];

  try {
    await new Promise<void>((resolve, reject) => {
      execFile(browserPath, args, { timeout: 10000 }, (err) => {
        if (fs.existsSync(tmpFile)) {
          return resolve();
        }
        if (err) {
          return reject(err);
        }
        resolve();
      });
    });

    if (!fs.existsSync(tmpFile)) {
      throw new Error('Screenshot file was not generated by headless browser');
    }

    const imageBuffer = await fs.promises.readFile(tmpFile);
    if (imageBuffer.length === 0) {
      throw new Error('Generated screenshot file is empty');
    }

    const base64 = imageBuffer.toString('base64');
    const dataUrl = `data:image/png;base64,${base64}`;

    return {
      dataUrl,
      width,
      height,
    };
  } finally {
    try {
      if (fs.existsSync(tmpFile)) {
        await fs.promises.unlink(tmpFile);
      }
    } catch {}
  }
}

/**
 * Captures a screenshot of the specified URL.
 * Uses the ultra-fast persistent CDP headless browser worker if available (~150ms),
 * falling back seamlessly to one-shot CLI execution.
 */
export async function captureUrlScreenshot(
  url: string,
  width: number = 1280,
  height: number = 800
): Promise<ScreenshotResult> {
  // 1. Try persistent CDP worker for sub-200ms captures
  try {
    const cdpResult = await workerInstance.capture(url, width, height);
    if (cdpResult?.dataUrl) {
      return cdpResult;
    }
  } catch (err) {
    console.warn('CDP worker capture threw error, trying CLI fallback:', err);
  }

  // 2. Fallback to fast one-shot CLI execution
  return captureUrlScreenshotCli(url, width, height);
}
