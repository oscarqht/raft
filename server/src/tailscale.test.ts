import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isTailscaleIp, resolveHost } from './tailscale.js';

describe('tailscale auto-discovery', () => {
  it('correctly identifies Tailscale CGNAT IPs (100.64.0.0/10)', () => {
    // Valid CGNAT addresses
    assert.equal(isTailscaleIp('100.64.0.1'), true);
    assert.equal(isTailscaleIp('100.99.123.84'), true);
    assert.equal(isTailscaleIp('100.127.255.254'), true);

    // Invalid / out of range
    assert.equal(isTailscaleIp('100.63.255.255'), false);
    assert.equal(isTailscaleIp('100.128.0.1'), false);
    assert.equal(isTailscaleIp('127.0.0.1'), false);
    assert.equal(isTailscaleIp('192.168.1.100'), false);
    assert.equal(isTailscaleIp('10.0.0.1'), false);
    assert.equal(isTailscaleIp(''), false);
    assert.equal(isTailscaleIp('not-an-ip'), false);
  });

  it('respects HOST environment variable override', () => {
    const originalHost = process.env.HOST;
    try {
      process.env.HOST = '100.100.100.100';
      const resolved = resolveHost();
      assert.equal(resolved.host, '100.100.100.100');
      assert.equal(resolved.isTailscale, true);
      assert.equal(resolved.source, 'env');
    } finally {
      if (originalHost !== undefined) {
        process.env.HOST = originalHost;
      } else {
        delete process.env.HOST;
      }
    }
  });

  it('respects TAILSCALE_IP environment variable override', () => {
    const originalHost = process.env.HOST;
    const originalTailscale = process.env.TAILSCALE_IP;
    try {
      delete process.env.HOST;
      process.env.TAILSCALE_IP = '100.80.90.100';
      const resolved = resolveHost();
      assert.equal(resolved.host, '100.80.90.100');
      assert.equal(resolved.isTailscale, true);
      assert.equal(resolved.source, 'env');
    } finally {
      if (originalHost !== undefined) process.env.HOST = originalHost;
      if (originalTailscale !== undefined) {
        process.env.TAILSCALE_IP = originalTailscale;
      } else {
        delete process.env.TAILSCALE_IP;
      }
    }
  });
});
