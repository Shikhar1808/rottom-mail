/**
 * Planned send time for each lead (the "plan" layer, docs/02 O1): `delayMs` apart, at most `hourlyLimit` per window.
 * Once a window's quota is used, the next lead starts one window after the previous block began.
 * If hourlyLimit × delay already spans more than a window, the limit can't be hit and times are just delay apart.
 */
export function planSendTimes(count: number, startAt: number, delayMs: number, hourlyLimit: number, windowMs: number): number[] {
  const block = Math.max(windowMs, hourlyLimit * delayMs);
  return Array.from({ length: count }, (_, i) => startAt + Math.floor(i / hourlyLimit) * block + (i % hourlyLimit) * delayMs);
}
