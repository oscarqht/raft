import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { findBrowserExecutable, isScreenshotSupported, captureUrlScreenshot, stopCdpWorker } from './screenshotService.js';

describe('screenshotService', () => {
  after(() => {
    stopCdpWorker();
  });

  it('detects browser executable when installed', () => {
    const supported = isScreenshotSupported();
    const exe = findBrowserExecutable();
    assert.equal(typeof supported, 'boolean');
    if (supported) {
      assert.equal(typeof exe, 'string');
      assert.ok(exe!.length > 0);
    }
  });

  it('captures a valid data URL screenshot if browser is available', async () => {
    if (!isScreenshotSupported()) {
      return;
    }
    const t0 = Date.now();
    const result1 = await captureUrlScreenshot('data:text/html,<html><body><h1>Raft Screenshot Test</h1></body></html>', 800, 600);
    const dur1 = Date.now() - t0;
    assert.ok(result1.dataUrl.startsWith('data:image/png;base64,'));
    assert.ok(result1.dataUrl.length > 100);
    assert.equal(result1.width, 800);
    assert.equal(result1.height, 600);

    // Second capture should reuse persistent CDP worker and be very fast
    const t1 = Date.now();
    const result2 = await captureUrlScreenshot('data:text/html,<html><body><h1>Fast Second Capture</h1></body></html>', 800, 600);
    const dur2 = Date.now() - t1;
    assert.ok(result2.dataUrl.startsWith('data:image/png;base64,'));
    console.log(`Capture #1 took ${dur1}ms, Capture #2 took ${dur2}ms`);
  });
});
