export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Splits a list into batches, e.g. 10,000 rows into inserts of 1,000. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
