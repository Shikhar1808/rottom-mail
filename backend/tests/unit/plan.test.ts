import { describe, expect, it } from 'vitest';
import { planSendTimes } from '../../src/services/plan';

describe('planSendTimes', () => {
  it('spaces by delay and starts a new window once the hourly limit is used', () => {
    // limit 3, 2s apart, 60s window
    expect(planSendTimes(7, 0, 2000, 3, 60_000)).toEqual([0, 2000, 4000, 60_000, 62_000, 64_000, 120_000]);
  });

  it('just spaces by delay when the limit can never be reached inside a window', () => {
    // 3 × 30s = 90s > 60s window: no gaps needed, and never more than 3 in any 60s
    expect(planSendTimes(5, 1000, 30_000, 3, 60_000)).toEqual([1000, 31_000, 61_000, 91_000, 121_000]);
  });

  it('never puts more than the limit in one window', () => {
    const times = planSendTimes(1000, 0, 500, 7, 60_000);
    const perWindow = new Map<number, number>();
    for (const t of times) perWindow.set(Math.floor(t / 60_000), (perWindow.get(Math.floor(t / 60_000)) ?? 0) + 1);
    expect(Math.max(...perWindow.values())).toBeLessThanOrEqual(7);
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});
