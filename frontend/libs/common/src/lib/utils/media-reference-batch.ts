import {
  appendMediaReference,
  type AppendMediaReferenceStatus,
  type MediaReferenceLimits,
  type TimedMediaReferenceLike,
} from "./media-reference-state";

export interface MediaReferenceCandidateLike {
  id: string;
  url: string;
  mediaToken?: string;
}

export interface ProbedMediaReferenceBatchCoordinator<
  TCandidate extends MediaReferenceCandidateLike,
  TReference extends TimedMediaReferenceLike,
> {
  isCurrent: () => boolean;
  getCurrent: () => readonly TReference[];
  publish: (next: TReference[]) => void;
  probeDuration: (url: string) => Promise<number | null>;
  getLimits: () => MediaReferenceLimits;
  toReference: (candidate: TCandidate, duration: number) => TReference;
  onUnreadable?: (candidate: TCandidate) => void;
  onRejected?: (
    candidate: TCandidate,
    status: Exclude<AppendMediaReferenceStatus, "added" | "duplicate">,
  ) => void;
}

/**
 * Probe and append a picker/navigation batch against live state. Every await
 * and publish is guarded by the caller's operation identity, so clear,
 * unmount, or policy changes cannot resurrect a superseded selection.
 */
export async function appendProbedMediaReferenceBatch<
  TCandidate extends MediaReferenceCandidateLike,
  TReference extends TimedMediaReferenceLike,
>(
  candidates: readonly TCandidate[],
  coordinator: ProbedMediaReferenceBatchCoordinator<TCandidate, TReference>,
): Promise<{
  status: "complete" | "stale";
  added: number;
  unreadable: number;
}> {
  let added = 0;
  let unreadable = 0;
  for (const candidate of candidates) {
    if (!coordinator.isCurrent()) {
      return { status: "stale", added, unreadable };
    }
    const duration = await coordinator.probeDuration(candidate.url);
    if (!coordinator.isCurrent()) {
      return { status: "stale", added, unreadable };
    }
    if (duration == null) {
      unreadable++;
      coordinator.onUnreadable?.(candidate);
      continue;
    }

    const result = appendMediaReference(
      coordinator.getCurrent(),
      coordinator.toReference(candidate, duration),
      coordinator.getLimits(),
    );
    if (!coordinator.isCurrent()) {
      return { status: "stale", added, unreadable };
    }
    if (result.status === "added") {
      coordinator.publish(result.next);
      added++;
    } else if (result.status !== "duplicate") {
      coordinator.onRejected?.(candidate, result.status);
    }
  }
  return { status: "complete", added, unreadable };
}
