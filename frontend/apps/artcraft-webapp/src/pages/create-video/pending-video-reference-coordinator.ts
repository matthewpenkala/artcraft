import {
  appendProbedMediaReferenceBatch,
  type MediaReferenceLimits,
} from "@storyteller/common";

export interface PendingVideoReference {
  id: string;
  url: string;
  mediaToken?: string;
  duration: number;
}

export interface PendingVideoReferenceCoordinator<
  T extends PendingVideoReference,
> {
  isCurrent: () => boolean;
  getCurrent: () => readonly T[];
  publish: (next: T[]) => void;
  probeDuration: (url: string) => Promise<number | null>;
  limits: MediaReferenceLimits;
  onUnreadable?: (candidate: T) => void;
}

/**
 * Hydrate and append one navigation batch against live store state. Identity
 * is checked after every await and immediately before every publish so a
 * superseded batch cannot mutate the destination.
 */
export async function applyPendingVideoReferenceBatch<
  T extends PendingVideoReference,
>(
  batch: readonly T[],
  coordinator: PendingVideoReferenceCoordinator<T>,
): Promise<{ status: "complete" | "stale"; added: number }> {
  const result = await appendProbedMediaReferenceBatch(batch, {
    isCurrent: coordinator.isCurrent,
    getCurrent: coordinator.getCurrent,
    publish: coordinator.publish,
    probeDuration: coordinator.probeDuration,
    getLimits: () => coordinator.limits,
    toReference: (candidate, duration) => ({ ...candidate, duration }),
    onUnreadable: coordinator.onUnreadable,
  });
  return { status: result.status, added: result.added };
}
