/**
 * Detects whether the current platform is Windows.
 * Supports explicit platform override (e.g. from backend `process.platform`),
 * User-Agent Client Hints (`navigator.userAgentData`),
 * and traditional `navigator.platform` / `navigator.userAgent`.
 */
export function isWindowsPlatform(platformOverride?: string): boolean {
  if (platformOverride) {
    return platformOverride === 'win32';
  }

  if (typeof navigator !== 'undefined') {
    // Avoid false positives in Node.js test environment where navigator polyfills exist
    if (navigator.userAgent && navigator.userAgent.includes('Node.js')) {
      return false;
    }

    const navAny = navigator as any;
    if (navAny.userAgentData?.platform) {
      return /^win/i.test(navAny.userAgentData.platform);
    }

    const platform = navigator.platform || '';
    const userAgent = navigator.userAgent || '';
    return /win/i.test(platform) || /windows/i.test(userAgent);
  }

  return false;
}
