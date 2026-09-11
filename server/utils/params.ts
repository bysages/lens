/**
 * Query-string parsing helpers shared by the routes: they must not throw on
 * hostile input (repeated params arrive as arrays, non-numeric values make
 * parseInt return NaN and NaN slips through Math.min/Math.max clamps).
 */

/** First scalar value of a query parameter; repeated params yield the first. */
export function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === "string" ? first : undefined;
  }
  return undefined;
}

/** Value from an allowlist, else the fallback. */
export function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback?: T,
): T | undefined {
  const raw = firstString(value);
  if (raw === undefined) return fallback;
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

/** "true" boolean query flag. */
export function boolParam(value: unknown): boolean {
  return firstString(value) === "true";
}

/** parseInt with NaN guard, clamped to [min, max]; falls back when absent or non-numeric. */
export function clampInt(value: unknown, min: number, max: number, fallback: number): number;
export function clampInt(
  value: unknown,
  min: number,
  max: number,
  fallback?: number,
): number | undefined;
export function clampInt(
  value: unknown,
  min: number,
  max: number,
  fallback?: number,
): number | undefined {
  const raw = firstString(value);
  const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}
