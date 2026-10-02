export function resolvePreviewAddress(value: string, base: string): string {
  const url = new URL(value.trim() || '/', base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Preview addresses must use HTTP or HTTPS without embedded credentials.');
  }
  return url.href;
}

// Keep local paths compact, but retain the hostname after an external redirect.
export function displayPreviewAddress(value: string, localOrigin: string): string {
  const url = new URL(resolvePreviewAddress(value, localOrigin));
  return url.origin === localOrigin ? url.pathname + url.search + url.hash : url.href;
}
