import { withTemporaryMediaObjectUrl } from "./media-object-url";

const MILLISECONDS_PER_SECOND = 1_000;

export const MEDIA_DURATION_PROBE_TIMEOUT_MS = 10_000;

/** Convert seconds to integer milliseconds without accepting invalid numbers. */
export function durationSecondsToMillis(seconds: number): number | null {
  if (!Number.isFinite(seconds) || seconds < 0) return null;

  const milliseconds = Math.round(seconds * MILLISECONDS_PER_SECOND);
  return Number.isSafeInteger(milliseconds) ? milliseconds : null;
}

/** Convert an integer millisecond duration to seconds. */
export function durationMillisToSeconds(milliseconds: number): number | null {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) return null;
  return milliseconds / MILLISECONDS_PER_SECOND;
}

/**
 * Normalize browser metadata to the millisecond precision retained by the
 * application. Zero is not a usable media duration and remains unresolved.
 */
export function normalizeMediaDurationSeconds(seconds: number): number | null {
  const milliseconds = durationSecondsToMillis(seconds);
  return milliseconds != null && milliseconds > 0
    ? milliseconds / MILLISECONDS_PER_SECOND
    : null;
}

/** Normalize API-provided millisecond metadata as a usable media duration. */
export function normalizeMediaDurationMillis(
  milliseconds: number,
): number | null {
  return Number.isSafeInteger(milliseconds) && milliseconds > 0
    ? milliseconds / MILLISECONDS_PER_SECOND
    : null;
}

/**
 * Sum seconds-shaped media state as integer milliseconds. Any unresolved
 * entry invalidates the total instead of silently contributing zero.
 */
export function sumMediaDurationMillis(
  durationsSeconds: readonly number[],
): number | null {
  let totalMilliseconds = 0;
  for (const duration of durationsSeconds) {
    const milliseconds = durationSecondsToMillis(duration);
    if (
      milliseconds == null ||
      milliseconds <= 0 ||
      !Number.isSafeInteger(totalMilliseconds + milliseconds)
    ) {
      return null;
    }
    totalMilliseconds += milliseconds;
  }
  return totalMilliseconds;
}

/**
 * Convert each input to the whole-second duration charged by the backend and
 * sum those charged durations in milliseconds. Billing rounds every file up
 * independently, so this deliberately differs from rounding the aggregate:
 * two 5.4 second files are billed as 6 + 6 seconds, not 11 seconds.
 */
export function sumMediaBillingDurationMillis(
  durationsSeconds: readonly number[],
): number | null {
  let totalMilliseconds = 0;
  for (const duration of durationsSeconds) {
    const milliseconds = durationSecondsToMillis(duration);
    if (milliseconds == null || milliseconds <= 0) return null;

    const billedMilliseconds =
      Math.ceil(milliseconds / MILLISECONDS_PER_SECOND) *
      MILLISECONDS_PER_SECOND;
    if (!Number.isSafeInteger(totalMilliseconds + billedMilliseconds)) {
      return null;
    }
    totalMilliseconds += billedMilliseconds;
  }
  return totalMilliseconds;
}

export type MediaDurationLimitStatus =
  | "within-limit"
  | "over-limit"
  | "invalid";

/** Compare media durations and a seconds-shaped cap using integer math. */
export function mediaDurationLimitStatus(
  durationsSeconds: readonly number[],
  maxTotalSeconds: number,
): MediaDurationLimitStatus {
  const totalMilliseconds = sumMediaDurationMillis(durationsSeconds);
  if (totalMilliseconds == null) return "invalid";
  if (maxTotalSeconds === Number.POSITIVE_INFINITY) return "within-limit";

  const maxMilliseconds = durationSecondsToMillis(maxTotalSeconds);
  if (maxMilliseconds == null) return "invalid";
  return totalMilliseconds <= maxMilliseconds ? "within-limit" : "over-limit";
}

/** Return the remaining duration under a cap using the same integer-ms math. */
export function remainingMediaDurationSeconds(
  durationsSeconds: readonly number[],
  maxTotalSeconds: number,
): number | null {
  const totalMilliseconds = sumMediaDurationMillis(durationsSeconds);
  if (totalMilliseconds == null) return null;
  if (maxTotalSeconds === Number.POSITIVE_INFINITY) {
    return Number.POSITIVE_INFINITY;
  }

  const maxMilliseconds = durationSecondsToMillis(maxTotalSeconds);
  if (maxMilliseconds == null) return null;
  return (
    Math.max(0, maxMilliseconds - totalMilliseconds) / MILLISECONDS_PER_SECOND
  );
}

export type MediaReferenceValidationStatus =
  | "valid"
  | "invalid-duration"
  | "over-count"
  | "over-duration";

/** Validate the final reference collection at a commit or submit boundary. */
export function validateMediaReferences(
  durationsSeconds: readonly number[],
  maxCount: number | null,
  maxTotalSeconds: number,
): MediaReferenceValidationStatus {
  if (maxCount !== null) {
    if (!Number.isSafeInteger(maxCount) || maxCount < 0) {
      return "over-count";
    }
    if (durationsSeconds.length > maxCount) return "over-count";
  }

  const durationStatus = mediaDurationLimitStatus(
    durationsSeconds,
    maxTotalSeconds,
  );
  if (durationStatus === "invalid") return "invalid-duration";
  if (durationStatus === "over-limit") return "over-duration";
  return "valid";
}

export type MediaDurationProbeKind = "video" | "audio";

/**
 * Probe browser media metadata with a hard deadline. Every settlement path
 * clears the timer, detaches handlers, and removes the source so a late event
 * cannot retain work or change the already-resolved result.
 */
export function probeMediaDurationFromUrl(
  kind: MediaDurationProbeKind,
  url: string,
  timeoutMs = MEDIA_DURATION_PROBE_TIMEOUT_MS,
): Promise<number | null> {
  return new Promise((resolve) => {
    const media = document.createElement(kind);
    media.preload = "metadata";

    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = (duration: number | null) => {
      if (settled) return;
      settled = true;
      if (timeout !== undefined) clearTimeout(timeout);
      media.onloadedmetadata = null;
      media.onerror = null;
      try {
        media.removeAttribute("src");
      } catch {
        // The result must still settle if a browser refuses source cleanup.
      }
      resolve(duration);
    };

    media.onloadedmetadata = () => {
      finish(normalizeMediaDurationSeconds(media.duration));
    };
    media.onerror = () => finish(null);
    const boundedTimeout =
      Number.isFinite(timeoutMs) && timeoutMs >= 0
        ? timeoutMs
        : MEDIA_DURATION_PROBE_TIMEOUT_MS;
    timeout = setTimeout(() => finish(null), boundedTimeout);

    try {
      media.src = url;
    } catch {
      finish(null);
    }
  });
}

/** Probe a local file while owning and always releasing its temporary URL. */
export function probeMediaDurationFromFile(
  kind: MediaDurationProbeKind,
  file: File,
  timeoutMs = MEDIA_DURATION_PROBE_TIMEOUT_MS,
): Promise<number | null> {
  return withTemporaryMediaObjectUrl(file, (url) =>
    probeMediaDurationFromUrl(kind, url, timeoutMs),
  );
}

/** Compact display only; validation must use the integer-millisecond helpers. */
export function formatMediaDurationSeconds(seconds: number): string {
  const milliseconds = durationSecondsToMillis(seconds);
  if (milliseconds == null) return "—";
  return String(Math.round(milliseconds / 100) / 10);
}

/** Compact an integer-millisecond duration for display. */
export function formatMediaDurationMillis(milliseconds: number): string {
  const seconds = durationMillisToSeconds(milliseconds);
  return seconds == null ? "—" : formatMediaDurationSeconds(seconds);
}
