import {
  normalizeMediaDurationMillis,
  normalizeMediaDurationSeconds,
  validateMediaReferences,
} from "./media-duration";

export interface TimedMediaReferenceLike {
  id: string;
  mediaToken?: string;
  duration: number;
}

export interface MediaReferenceLimits {
  maxCount: number | null;
  maxTotalSeconds: number;
}

/**
 * Match the request layer's stable token dedupe while failing closed if any
 * visible reference would otherwise be silently filtered from the request.
 */
export function prepareMediaReferencesForSubmission<
  TReference extends { mediaToken?: string | null },
>(references: readonly TReference[]): TReference[] | null {
  const seen = new Set<string>();
  const prepared: TReference[] = [];
  for (const reference of references) {
    const token = reference.mediaToken;
    if (
      typeof token !== "string" ||
      token.trim().length === 0 ||
      token !== token.trim()
    ) {
      return null;
    }
    if (seen.has(token)) continue;
    seen.add(token);
    prepared.push(reference);
  }
  return prepared;
}

export interface RecreatedReferenceCollections {
  imageCount: number;
  hasEndFrame: boolean;
  videoDurations: readonly number[];
  audioDurations: readonly number[];
}

export interface RecreatedVideoReferenceCapabilities {
  supportsStartFrame: boolean;
  supportsEndFrame: boolean;
  requiresStartFrame: boolean;
  supportsReferenceMode: boolean;
  maxReferenceImages: number | null;
  maxReferenceVideos: number | null;
  maxVideoRefDuration: number;
  maxReferenceAudios: number | null;
  maxAudioRefDuration: number;
}

export type RecreatedReferenceValidationStatus =
  | "valid"
  | "unsupported-reference-mode"
  | "unsupported-keyframe-reference"
  | "missing-required-start-frame"
  | "over-image-count"
  | "invalid-video-duration"
  | "over-video-limit"
  | "invalid-audio-duration"
  | "over-audio-limit";

/** Validate a fully hydrated video Recreate payload before any mutation. */
export function validateRecreatedVideoReferences(
  collections: RecreatedReferenceCollections,
  inputMode: "keyframe" | "reference",
  capabilities: RecreatedVideoReferenceCapabilities,
): RecreatedReferenceValidationStatus {
  if (inputMode === "keyframe") {
    if (
      collections.videoDurations.length > 0 ||
      collections.audioDurations.length > 0
    ) {
      return "unsupported-keyframe-reference";
    }
    const maxImages = capabilities.supportsStartFrame ? 1 : 0;
    if (collections.imageCount > maxImages) return "over-image-count";
    if (collections.hasEndFrame) {
      if (!capabilities.supportsEndFrame) {
        return "unsupported-keyframe-reference";
      }
    }
    if (capabilities.requiresStartFrame && collections.imageCount === 0) {
      return "missing-required-start-frame";
    }
    return "valid";
  }

  if (!capabilities.supportsReferenceMode || collections.hasEndFrame) {
    return "unsupported-reference-mode";
  }
  if (
    capabilities.maxReferenceImages !== null &&
    collections.imageCount > capabilities.maxReferenceImages
  ) {
    return "over-image-count";
  }

  const videoStatus = validateMediaReferences(
    collections.videoDurations,
    capabilities.maxReferenceVideos,
    capabilities.maxVideoRefDuration,
  );
  if (videoStatus === "invalid-duration") return "invalid-video-duration";
  if (videoStatus !== "valid") return "over-video-limit";

  const audioStatus = validateMediaReferences(
    collections.audioDurations,
    capabilities.maxReferenceAudios,
    capabilities.maxAudioRefDuration,
  );
  if (audioStatus === "invalid-duration") return "invalid-audio-duration";
  if (audioStatus !== "valid") return "over-audio-limit";
  return "valid";
}

/** Run a Recreate commit only after the complete payload validates. */
export function commitValidatedRecreatedVideoReferences(
  collections: RecreatedReferenceCollections,
  inputMode: "keyframe" | "reference",
  capabilities: RecreatedVideoReferenceCapabilities,
  commit: () => void,
): RecreatedReferenceValidationStatus {
  const status = validateRecreatedVideoReferences(
    collections,
    inputMode,
    capabilities,
  );
  if (status === "valid") commit();
  return status;
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

export interface MediaDurationHydrationDependencies {
  loadDurationMillis?: () => Promise<number | null | undefined>;
  probeDurationSeconds: () => Promise<number | null>;
}

export interface RecreatedContextReferenceInput {
  semantic: string;
  mediaToken: string;
  url: string;
}

export interface HydratedRecreatedReference {
  mediaToken: string;
  url: string;
}

export interface HydratedRecreatedTimedReference extends HydratedRecreatedReference {
  duration: number;
}

export interface HydratedRecreatedReferences {
  referenceImages: HydratedRecreatedReference[];
  endFrameImage?: HydratedRecreatedReference;
  referenceVideos: HydratedRecreatedTimedReference[];
  referenceAudios: HydratedRecreatedTimedReference[];
  excludedReferenceCount: number;
}

export interface RecreatedReferenceHydrationDependencies {
  loadDurationMillis: (
    mediaToken: string,
  ) => Promise<number | null | undefined>;
  probeVideoDuration: (url: string) => Promise<number | null>;
  probeAudioDuration: (url: string) => Promise<number | null>;
}

const IMAGE_REFERENCE_SEMANTICS = new Set([
  "imgref",
  "imgref_character",
  "imgref_style",
  "imgref_bg",
  "imgsrc",
  "imgmask",
  "vid_start_frame",
]);

type RecreatedReferenceKind = "image" | "end" | "video" | "audio";
type RecreatedTimedReferenceKind = Extract<
  RecreatedReferenceKind,
  "video" | "audio"
>;

interface TimedReferenceOrdinalState {
  originalCount: number;
  excludedOrdinals: number[];
}

const TIMED_REFERENCE_MENTION_PATTERNS: Record<
  RecreatedTimedReferenceKind,
  RegExp
> = {
  video: /@Video([1-9]\d*)\b/g,
  audio: /@Audio([1-9]\d*)\b/g,
};

/**
 * A hydrated timed-reference array is rendered and submitted with fresh
 * index-derived @VideoN/@AudioN labels. Excluding an original slot at or
 * before a still-valid mention would therefore either dangle that mention or
 * silently bind it to a later reference. Trailing, unmentioned exclusions do
 * not change any prompt binding and remain safe to omit.
 */
function assertTimedReferenceMentionsPreserved(
  positivePrompt: string,
  ordinalStates: Record<
    RecreatedTimedReferenceKind,
    TimedReferenceOrdinalState
  >,
): void {
  for (const kind of ["video", "audio"] as const) {
    const state = ordinalStates[kind];
    if (state.excludedOrdinals.length === 0) continue;

    TIMED_REFERENCE_MENTION_PATTERNS[kind].lastIndex = 0;
    for (const match of positivePrompt.matchAll(
      TIMED_REFERENCE_MENTION_PATTERNS[kind],
    )) {
      const mentionedOrdinal = Number(match[1]);
      // A mention beyond the original collection was already dangling; an
      // exclusion cannot alter its binding, so do not broaden Recreate's
      // existing validation policy here.
      if (
        !Number.isSafeInteger(mentionedOrdinal) ||
        mentionedOrdinal > state.originalCount
      ) {
        continue;
      }
      if (
        state.excludedOrdinals.some(
          (excludedOrdinal) => excludedOrdinal <= mentionedOrdinal,
        )
      ) {
        const label = kind === "video" ? "Video" : "Audio";
        throw new Error(
          `Recreate cannot preserve @${label}${mentionedOrdinal} after excluding an unreadable ${kind} reference`,
        );
      }
    }
  }
}

export function recreatedReferenceKind(
  semantic: string,
): RecreatedReferenceKind | null {
  if (IMAGE_REFERENCE_SEMANTICS.has(semantic)) return "image";
  if (semantic === "vid_end_frame") return "end";
  if (semantic === "vid_ref" || semantic === "vidref") return "video";
  if (semantic === "audioref") return "audio";
  return null;
}

/**
 * Image Recreate is a semantic class boundary. Check the raw contexts before
 * hydration so an unreadable video/audio reference cannot be excluded and
 * silently turn the request into a valid image-only replay.
 */
export function hasNonImageRecreatedReferenceContexts(
  contexts: readonly Pick<RecreatedContextReferenceInput, "semantic">[],
): boolean {
  return contexts.some((context) => {
    const kind = recreatedReferenceKind(context.semantic);
    return (
      context.semantic === "vid_start_frame" ||
      (kind !== null && kind !== "image")
    );
  });
}

/** Prefer exact API milliseconds and probe only when no usable record exists. */
export async function hydrateMediaDuration(
  dependencies: MediaDurationHydrationDependencies,
): Promise<number | null> {
  if (dependencies.loadDurationMillis) {
    try {
      const milliseconds = await dependencies.loadDurationMillis();
      if (milliseconds != null) {
        const known = normalizeMediaDurationMillis(milliseconds);
        if (known != null) return known;
      }
    } catch {
      // The bounded media probe is the fallback for an unavailable API record.
    }
  }

  try {
    const probed = await dependencies.probeDurationSeconds();
    return probed == null ? null : normalizeMediaDurationSeconds(probed);
  } catch {
    return null;
  }
}

/**
 * Hydrate every timed Recreate reference before returning any collection.
 * Malformed/unreadable items are counted and excluded. Multiple end-frame
 * records are ambiguous and reject the transaction instead of silently using
 * whichever record happened to arrive last.
 */
export async function hydrateRecreatedReferences(
  contexts: readonly RecreatedContextReferenceInput[],
  dependencies: RecreatedReferenceHydrationDependencies,
  positivePrompt: string,
): Promise<HydratedRecreatedReferences> {
  let endFrameCount = 0;
  const validContexts: Array<
    RecreatedContextReferenceInput & {
      kind: RecreatedReferenceKind;
      timedOrdinal?: number;
    }
  > = [];
  const seenTokens: Record<RecreatedReferenceKind, Set<string>> = {
    image: new Set(),
    end: new Set(),
    video: new Set(),
    audio: new Set(),
  };
  const timedOrdinalStates: Record<
    RecreatedTimedReferenceKind,
    TimedReferenceOrdinalState
  > = {
    video: { originalCount: 0, excludedOrdinals: [] },
    audio: { originalCount: 0, excludedOrdinals: [] },
  };
  let excludedReferenceCount = 0;
  for (const context of contexts) {
    const kind =
      typeof context.semantic === "string"
        ? recreatedReferenceKind(context.semantic)
        : null;
    if (!kind) {
      excludedReferenceCount++;
      continue;
    }
    const validToken =
      typeof context.mediaToken === "string" &&
      context.mediaToken.trim().length > 0 &&
      context.mediaToken === context.mediaToken.trim();
    if (validToken && seenTokens[kind].has(context.mediaToken)) continue;

    const timedKind = kind === "video" || kind === "audio" ? kind : undefined;
    const timedOrdinal = timedKind
      ? ++timedOrdinalStates[timedKind].originalCount
      : undefined;
    if (
      !validToken ||
      typeof context.url !== "string" ||
      context.url.trim().length === 0
    ) {
      excludedReferenceCount++;
      if (timedKind && timedOrdinal !== undefined) {
        timedOrdinalStates[timedKind].excludedOrdinals.push(timedOrdinal);
      }
      continue;
    }
    seenTokens[kind].add(context.mediaToken);
    if (kind === "end") endFrameCount++;
    validContexts.push({ ...context, kind, timedOrdinal });
  }
  if (endFrameCount > 1) {
    throw new Error("Recreate payload contains multiple end frames");
  }

  const hydrated = await Promise.all(
    validContexts.map(async (context) => {
      if (context.kind !== "video" && context.kind !== "audio") {
        return { context, duration: null };
      }
      const duration = await hydrateMediaDuration({
        loadDurationMillis: () =>
          dependencies.loadDurationMillis(context.mediaToken),
        probeDurationSeconds: () =>
          context.kind === "video"
            ? dependencies.probeVideoDuration(context.url)
            : dependencies.probeAudioDuration(context.url),
      });
      return { context, duration };
    }),
  );

  const result: HydratedRecreatedReferences = {
    referenceImages: [],
    referenceVideos: [],
    referenceAudios: [],
    excludedReferenceCount,
  };
  for (const { context, duration } of hydrated) {
    const base = { mediaToken: context.mediaToken, url: context.url };
    switch (context.kind) {
      case "end":
        result.endFrameImage = base;
        break;
      case "video":
        if (duration == null) {
          result.excludedReferenceCount++;
          timedOrdinalStates.video.excludedOrdinals.push(context.timedOrdinal!);
        } else result.referenceVideos.push({ ...base, duration });
        break;
      case "audio":
        if (duration == null) {
          result.excludedReferenceCount++;
          timedOrdinalStates.audio.excludedOrdinals.push(context.timedOrdinal!);
        } else result.referenceAudios.push({ ...base, duration });
        break;
      case "image":
        result.referenceImages.push(base);
        break;
    }
  }
  assertTimedReferenceMentionsPreserved(positivePrompt, timedOrdinalStates);
  return result;
}
