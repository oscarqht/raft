/**
 * Utility functions for AI provider budget calculations, cycle time tracking,
 * and daily spend rate / remaining daily budget estimations.
 */

export interface DailyBudgetMetrics {
  dailySpeed: number | null;
  dailyRemainingBudget: number | null;
  daysElapsed: number | null;
  daysRemaining: number | null;
}

/**
 * Calculates the cycle start date given a reset date and period description.
 * Defaults to 1 month prior to the reset date (matching standard monthly billing cycles).
 */
export function getCycleStartDate(resetDate: Date, period?: string | null): Date {
  const p = (period || '').toLowerCase();
  if (p.includes('week')) {
    return new Date(resetDate.getTime() - 7 * 24 * 60 * 60 * 1000);
  }
  if (p.includes('day') && !p.includes('month')) {
    return new Date(resetDate.getTime() - 24 * 60 * 60 * 1000);
  }

  // Monthly cycle: 1 month prior to reset date, clamped to the previous month's max days
  const year = resetDate.getUTCFullYear();
  const month = resetDate.getUTCMonth();
  const day = resetDate.getUTCDate();
  const prevYear = month === 0 ? year - 1 : year;
  const prevMonth = month === 0 ? 11 : month - 1;
  const daysInPrevMonth = new Date(Date.UTC(prevYear, prevMonth + 1, 0)).getUTCDate();
  const safeDay = Math.min(day, daysInPrevMonth);

  return new Date(Date.UTC(
    prevYear,
    prevMonth,
    safeDay,
    resetDate.getUTCHours(),
    resetDate.getUTCMinutes(),
    resetDate.getUTCSeconds(),
    resetDate.getUTCMilliseconds()
  ));
}

/**
 * Calculates the daily speed (average amount spent per day in this cycle)
 * and remaining daily budget (allowance per day until the next reset).
 */
export function calculateDailyBudgetMetrics(
  costLimit: {
    limit?: number | null;
    used?: number | null;
    remaining?: number | null;
    resetsAt?: string | null;
    period?: string | null;
  } | null | undefined,
  nowInput?: number | Date | null
): DailyBudgetMetrics {
  if (!costLimit) {
    return { dailySpeed: null, dailyRemainingBudget: null, daysElapsed: null, daysRemaining: null };
  }

  const resetsAtStr = costLimit.resetsAt;
  if (!resetsAtStr) {
    return { dailySpeed: null, dailyRemainingBudget: null, daysElapsed: null, daysRemaining: null };
  }

  const resetMs = new Date(resetsAtStr).getTime();
  if (isNaN(resetMs)) {
    return { dailySpeed: null, dailyRemainingBudget: null, daysElapsed: null, daysRemaining: null };
  }

  const resetDate = new Date(resetMs);
  const cycleStartDate = getCycleStartDate(resetDate, costLimit.period);
  const cycleStartMs = cycleStartDate.getTime();

  if (resetMs <= cycleStartMs) {
    return { dailySpeed: null, dailyRemainingBudget: null, daysElapsed: null, daysRemaining: null };
  }

  const nowMs = typeof nowInput === 'number'
    ? nowInput
    : nowInput instanceof Date
    ? nowInput.getTime()
    : Date.now();

  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const elapsedMs = Math.max(0, nowMs - cycleStartMs);
  const remainingMs = Math.max(0, resetMs - nowMs);

  const exactElapsedDays = elapsedMs / MS_PER_DAY;
  const exactRemainingDays = remainingMs / MS_PER_DAY;

  // Clamped to at least 1 day to prevent division spikes at the start of a cycle
  const effectiveElapsedDays = Math.max(1, exactElapsedDays);
  // Clamped to at least 1 day so daily remaining budget does not exceed total remaining
  const effectiveRemainingDays = exactRemainingDays <= 0 ? 0 : Math.max(1, exactRemainingDays);

  const used = typeof costLimit.used === 'number' ? costLimit.used : null;
  const limit = typeof costLimit.limit === 'number' ? costLimit.limit : null;
  const remaining =
    typeof costLimit.remaining === 'number'
      ? costLimit.remaining
      : limit !== null && used !== null
      ? Math.max(0, limit - used)
      : null;

  let dailySpeed: number | null = null;
  if (used !== null) {
    dailySpeed = parseFloat((Math.max(0, used) / effectiveElapsedDays).toFixed(2));
  }

  let dailyRemainingBudget: number | null = null;
  if (remaining !== null) {
    if (effectiveRemainingDays <= 0) {
      dailyRemainingBudget = 0;
    } else {
      dailyRemainingBudget = parseFloat((Math.max(0, remaining) / effectiveRemainingDays).toFixed(2));
    }
  }

  return {
    dailySpeed,
    dailyRemainingBudget,
    daysElapsed: parseFloat(exactElapsedDays.toFixed(1)),
    daysRemaining: parseFloat(exactRemainingDays.toFixed(1)),
  };
}
