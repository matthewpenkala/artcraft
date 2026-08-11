const validCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

/**
 * Resolve a restored string setting against the target model's current
 * contract. A model-advertised option list is authoritative; otherwise the
 * restored value remains usable for legacy models that only expose a default.
 */
export function resolveTargetModelOption(
  restored: string | null | undefined,
  options: readonly string[] | null | undefined,
  modelDefault: string | null | undefined,
): string | undefined {
  const supported = [
    ...new Set((options ?? []).filter((value) => value.length > 0)),
  ];
  if (supported.length === 0) return restored ?? modelDefault ?? undefined;
  if (restored && supported.includes(restored)) return restored;
  if (modelDefault && supported.includes(modelDefault)) return modelDefault;
  return supported[0];
}

/** Resolve a restored batch count to an actual value accepted by the model. */
export function resolveTargetModelCount(
  restored: number | null | undefined,
  options: readonly number[] | null | undefined,
  minimum: number | null | undefined,
  maximum: number | null | undefined,
  modelDefault: number | null | undefined,
): number {
  const min = validCount(minimum) ? minimum : 1;
  const max = validCount(maximum)
    ? Math.max(min, maximum)
    : Number.MAX_SAFE_INTEGER;
  const supported = [
    ...new Set(
      (options ?? []).filter(
        (value): value is number =>
          validCount(value) && value >= min && value <= max,
      ),
    ),
  ].sort((a, b) => a - b);
  const fallback = validCount(modelDefault)
    ? Math.min(Math.max(modelDefault, min), max)
    : (supported[0] ?? min);
  const requested = validCount(restored)
    ? Math.min(Math.max(restored, min), max)
    : fallback;

  if (supported.length === 0 || supported.includes(requested)) return requested;
  const atOrBelow = supported.filter((value) => value <= requested);
  if (atOrBelow.length > 0) return atOrBelow[atOrBelow.length - 1]!;
  return supported.includes(fallback) ? fallback : supported[0]!;
}
