export const VERSION = 1;
export function ownerUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw failure('INVALID_URL', 'Enter a valid Alpha Bro address.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw failure('INVALID_URL', 'Alpha Bro must use an HTTP or HTTPS address without embedded credentials.');
  }
  return url;
}
export function isAutoConnected(value) {
  try { return ownerUrl(value).port === '3300'; } catch { return false; }
}
export function localUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw failure('INVALID_URL', 'Enter a valid local preview URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password) {
    throw failure('INVALID_URL', 'Only localhost, 127.0.0.1 and [::1] previews are supported.');
  }
  return url;
}
export function failure(code, message) { return Object.assign(new Error(message), { code }); }
export function embeddingRule(id, tabId, url) {
  const origin = localUrl(url).origin;
  return { id, priority: 1, action: { type: 'modifyHeaders', responseHeaders: [
    { header: 'x-frame-options', operation: 'remove' },
    { header: 'content-security-policy', operation: 'remove' },
  ] }, condition: { tabIds: [tabId], resourceTypes: ['sub_frame'], regexFilter: '^' + origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/' } };
}
export function cropBounds(rect, viewport, bitmap) {
  const values = [rect?.x, rect?.y, rect?.width, rect?.height, viewport?.width, viewport?.height];
  if (!values.every(Number.isFinite) || rect.x < 0 || rect.y < 0 || rect.width <= 0 || rect.height <= 0 || viewport.width <= 0 || viewport.height <= 0 || rect.x + rect.width > viewport.width + 1 || rect.y + rect.height > viewport.height + 1) {
    throw failure('INVALID_BOUNDS', 'The preview must be fully visible before capturing.');
  }
  const sx = bitmap.width / viewport.width;
  const sy = bitmap.height / viewport.height;
  if (Math.abs(sx - sy) > Math.max(sx, sy) * 0.03) throw failure('STALE_VIEWPORT', 'The window changed size. Please capture again.');
  return { x: Math.round(rect.x * sx), y: Math.round(rect.y * sy), width: Math.min(Math.round(rect.width * sx), bitmap.width - Math.round(rect.x * sx)), height: Math.min(Math.round(rect.height * sy), bitmap.height - Math.round(rect.y * sy)) };
}
