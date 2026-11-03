import { describe, expect, it } from 'vitest';
import { quickTimes, toLocalInput, tomorrowAt } from './sendLater';

describe('Send Later times', () => {
  it('tomorrow at an hour rolls over the month end, in local time', () => {
    const d = tomorrowAt(10, new Date(2026, 9, 31, 23, 30)); // 31 Oct, 23:30 local
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 10, 1, 10, 0]);
  });

  it('quick picks start from now, and the datetime input shows local time', () => {
    const now = new Date(2026, 10, 3, 14, 5, 30);
    expect(quickTimes(now)[0].at.getTime() - now.getTime()).toBe(60_000);
    expect(toLocalInput(now)).toBe('2026-11-03T14:05');
  });
});
