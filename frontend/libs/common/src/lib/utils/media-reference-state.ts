import { validateMediaReferences } from "./media-duration";

export interface TimedMediaReferenceLike {
  id: string;
  mediaToken?: string;
  duration: number;
}

export interface MediaReferenceLimits {
  maxCount: number;
  maxTotalSeconds: number;
}

export type AppendMediaReferenceStatus =
  | "added"
  | "duplicate"
  | "invalid-duration"
  | "over-count"
  | "over-duration";

/**
 * Derive an append from the caller's freshest state. Consumers must update
 * their live ref before publishing `next`; concurrent completions then stay
 * idempotent and cannot resurrect a removed item from an earlier snapshot.
 */
export function appendMediaReference<
  TReference extends TimedMediaReferenceLike,
>(
  current: readonly TReference[],
  candidate: TReference,
  limits: MediaReferenceLimits,
): { status: AppendMediaReferenceStatus; next: TReference[] } {
  const duplicate = current.some(
    (item) =>
      item.id === candidate.id ||
      (!!item.mediaToken &&
        !!candidate.mediaToken &&
        item.mediaToken === candidate.mediaToken),
  );
  if (duplicate) return { status: "duplicate", next: [...current] };

  const next = [...current, candidate];
  const status = validateMediaReferences(
    next.map((item) => item.duration),
    limits.maxCount,
    limits.maxTotalSeconds,
  );
  return status === "valid"
    ? { status: "added", next }
    : { status, next: [...current] };
}
