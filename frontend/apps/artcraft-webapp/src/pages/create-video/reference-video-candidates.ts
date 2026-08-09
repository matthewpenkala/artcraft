import {
  durationMillisToSeconds,
  durationSecondsToMillis,
  mediaDurationLimitStatus,
  remainingMediaDurationSeconds,
  sumMediaDurationMillis,
} from "@storyteller/common";

export interface ReferenceVideoCandidate {
  url: string;
  duration: number;
}

export type ReferenceVideoRejection =
  | { reason: "unreadable" }
  | { reason: "duration-limit"; remainingSeconds: number };

/**
 * Probe and cap candidate references against the current file bytes.
 * Candidate duration metadata is deliberately ignored because gallery rows
 * can be stale while generation always measures the current file.
 */
export async function buildProbedTimedRefsToAdd<
  T extends ReferenceVideoCandidate,
>(
  candidates: readonly T[],
  existing: readonly ReferenceVideoCandidate[],
  maxRefs: number,
  maxTotalDuration: number,
  probeDuration: (url: string) => Promise<number>,
  onRejected?: (rejection: ReferenceVideoRejection) => void,
): Promise<T[]> {
  const slots = Math.max(0, maxRefs - existing.length);
  const picked = candidates.slice(0, slots);
  const added: T[] = [];
  const durations = existing.map((video) => video.duration);
  let unreadableReported = false;
  const rejectUnreadable = () => {
    if (unreadableReported) return;
    unreadableReported = true;
    onRejected?.({ reason: "unreadable" });
  };

  if (sumMediaDurationMillis(durations) == null) {
    rejectUnreadable();
    return [];
  }

  for (const candidate of picked) {
    const probedDuration = await probeDuration(candidate.url);
    const durationMilliseconds = durationSecondsToMillis(probedDuration);
    if (durationMilliseconds == null || durationMilliseconds <= 0) {
      rejectUnreadable();
      continue;
    }
    const duration = durationMillisToSeconds(durationMilliseconds);
    if (duration == null) {
      rejectUnreadable();
      continue;
    }
    if (
      mediaDurationLimitStatus([...durations, duration], maxTotalDuration) !==
      "within-limit"
    ) {
      onRejected?.({
        reason: "duration-limit",
        remainingSeconds:
          remainingMediaDurationSeconds(durations, maxTotalDuration) ?? 0,
      });
      continue;
    }

    durations.push(duration);
    added.push({ ...candidate, duration });
  }

  return added;
}

export function buildProbedVideoRefsToAdd<T extends ReferenceVideoCandidate>(
  candidates: readonly T[],
  existing: readonly ReferenceVideoCandidate[],
  maxRefs: number,
  maxTotalDuration: number,
  probeDuration: (url: string) => Promise<number>,
  onRejected?: (rejection: ReferenceVideoRejection) => void,
): Promise<T[]> {
  return buildProbedTimedRefsToAdd(
    candidates,
    existing,
    maxRefs,
    maxTotalDuration,
    probeDuration,
    onRejected,
  );
}
