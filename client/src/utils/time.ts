/**
 * Formats a timestamp or date into a human-readable relative time string.
 * Examples: "just now", "1 minute ago", "2 minutes ago", "1 hour ago", "3 days ago", "2 weeks ago", etc.
 */
export function formatRelativeTime(
  dateInput?: number | string | Date | null,
  now: number = Date.now()
): string {
  if (!dateInput && dateInput !== 0) return '';

  let timestamp: number;
  if (typeof dateInput === 'number') {
    // If timestamp is in seconds (10 digits), convert to milliseconds
    timestamp = dateInput < 1e11 ? dateInput * 1000 : dateInput;
  } else if (typeof dateInput === 'string') {
    const num = Number(dateInput);
    if (!isNaN(num)) {
      timestamp = num < 1e11 ? num * 1000 : num;
    } else {
      timestamp = new Date(dateInput).getTime();
    }
  } else if (dateInput instanceof Date) {
    timestamp = dateInput.getTime();
  } else {
    return '';
  }

  if (isNaN(timestamp)) return '';

  const diffMs = now - timestamp;
  if (diffMs < 0) return 'just now';

  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';

  const formatUnit = (value: number, unit: Intl.RelativeTimeFormatUnit): string => {
    if (typeof Intl !== 'undefined' && Intl.RelativeTimeFormat) {
      return new Intl.RelativeTimeFormat('en', { numeric: 'always' }).format(-value, unit);
    }
    return `${value} ${unit}${value === 1 ? '' : 's'} ago`;
  };

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return formatUnit(diffMin, 'minute');

  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return formatUnit(diffHour, 'hour');

  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return formatUnit(diffDay, 'day');

  if (diffDay < 30) return formatUnit(Math.floor(diffDay / 7), 'week');

  if (diffDay < 365) return formatUnit(Math.max(1, Math.round(diffDay / 30)), 'month');

  return formatUnit(Math.max(1, Math.round(diffDay / 365)), 'year');
}

/**
 * Compact relative time for tight spaces: "5s", "15min", "3h", "2d", "3w", "4mo", "1y".
 */
export function formatShortRelativeTime(
  dateInput?: number | string | Date | null,
  now: number = Date.now()
): string {
  if (!dateInput && dateInput !== 0) return '';

  let timestamp: number;
  if (typeof dateInput === 'number') {
    timestamp = dateInput < 1e11 ? dateInput * 1000 : dateInput;
  } else if (typeof dateInput === 'string') {
    const num = Number(dateInput);
    timestamp = !isNaN(num) ? (num < 1e11 ? num * 1000 : num) : new Date(dateInput).getTime();
  } else if (dateInput instanceof Date) {
    timestamp = dateInput.getTime();
  } else {
    return '';
  }
  if (isNaN(timestamp)) return '';

  const diffSec = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (diffSec < 60) return `${diffSec}s`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}min`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}d`;
  if (diffDay < 30) return `${Math.floor(diffDay / 7)}w`;
  if (diffDay < 365) return `${Math.max(1, Math.round(diffDay / 30))}mo`;
  return `${Math.max(1, Math.round(diffDay / 365))}y`;
}
