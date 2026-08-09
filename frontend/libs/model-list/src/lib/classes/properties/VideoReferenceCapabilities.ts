export type VideoReferenceInputMode = "keyframe" | "reference";

/**
 * Structural capability surface shared by hydrated VideoModel instances and
 * focused consumers. The three reference media booleans are intentionally
 * independent: a model may support any combination of images, video, and
 * audio.
 */
export interface VideoReferenceCapabilities {
  startFrame?: boolean;
  endFrame?: boolean;
  requiresImage?: boolean;
  supportsImageReferences?: boolean;
  supportsVideoReferences?: boolean;
  supportsAudioReferences?: boolean;
  maxReferenceImages?: number;
  maxReferenceVideos?: number;
  maxVideoRefDuration?: number;
  maxReferenceAudios?: number;
  maxAudioRefDuration?: number;
}

export interface EffectiveVideoReferenceCapabilities {
  supportsStartFrame: boolean;
  supportsEndFrame: boolean;
  supportsImageReferences: boolean;
  supportsVideoReferences: boolean;
  supportsAudioReferences: boolean;
  declaresReferenceMode: boolean;
  canUseImageReferences: boolean;
  canUseVideoReferences: boolean;
  canUseAudioReferences: boolean;
  supportsReferenceMode: boolean;
  /** null means supported with no advertised client-side count limit. */
  maxReferenceImages: number | null;
  maxReferenceVideos: number | null;
  maxVideoRefDuration: number;
  maxReferenceAudios: number | null;
  maxAudioRefDuration: number;
}

export interface VideoReferenceTimedMedia {
  duration: number;
}

export interface VideoReferenceMediaState<
  TImage,
  TVideo extends VideoReferenceTimedMedia,
  TAudio extends VideoReferenceTimedMedia,
> {
  inputMode: VideoReferenceInputMode;
  referenceImages: TImage[];
  endFrameImage?: TImage;
  referenceVideos: TVideo[];
  referenceAudios: TAudio[];
}

export interface VideoReferenceMediaProjection<
  TImage,
  TVideo extends VideoReferenceTimedMedia,
  TAudio extends VideoReferenceTimedMedia,
> extends VideoReferenceMediaState<TImage, TVideo, TAudio> {
  capabilities: EffectiveVideoReferenceCapabilities;
}

const countLimit = (
  supported: boolean,
  value: number | undefined,
): number | null => {
  if (!supported) return 0;
  if (value === undefined) return null;
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
};

const durationLimit = (
  supported: boolean,
  value: number | undefined,
): number => {
  if (!supported) return 0;
  if (value === undefined) return Number.POSITIVE_INFINITY;
  return Number.isFinite(value) && value >= 0 ? value : 0;
};

/**
 * Resolve the model's concrete reference capabilities without inventing
 * product defaults. Explicitly unsupported media always has a zero limit;
 * an explicitly supported medium with no advertised count uses null rather
 * than an arbitrary legacy default or an invalid infinite-integer sentinel.
 * It remains subject to backend validation.
 */
export const getEffectiveVideoReferenceCapabilities = (
  source: VideoReferenceCapabilities,
): EffectiveVideoReferenceCapabilities => {
  const supportsImageReferences = source.supportsImageReferences === true;
  const supportsVideoReferences = source.supportsVideoReferences === true;
  const supportsAudioReferences = source.supportsAudioReferences === true;
  const maxReferenceImages = countLimit(
    supportsImageReferences,
    source.maxReferenceImages,
  );
  const maxReferenceVideos = countLimit(
    supportsVideoReferences,
    source.maxReferenceVideos,
  );
  const maxVideoRefDuration = durationLimit(
    supportsVideoReferences,
    source.maxVideoRefDuration,
  );
  const maxReferenceAudios = countLimit(
    supportsAudioReferences,
    source.maxReferenceAudios,
  );
  const maxAudioRefDuration = durationLimit(
    supportsAudioReferences,
    source.maxAudioRefDuration,
  );
  const canUseImageReferences =
    supportsImageReferences && maxReferenceImages !== 0;
  const canUseVideoReferences =
    supportsVideoReferences &&
    maxReferenceVideos !== 0 &&
    maxVideoRefDuration > 0;
  const canUseAudioReferences =
    supportsAudioReferences &&
    maxReferenceAudios !== 0 &&
    maxAudioRefDuration > 0;

  return {
    supportsStartFrame:
      source.startFrame === true || source.requiresImage === true,
    supportsEndFrame: source.endFrame === true,
    supportsImageReferences,
    supportsVideoReferences,
    supportsAudioReferences,
    declaresReferenceMode:
      supportsImageReferences ||
      supportsVideoReferences ||
      supportsAudioReferences,
    canUseImageReferences,
    canUseVideoReferences,
    canUseAudioReferences,
    supportsReferenceMode:
      canUseImageReferences || canUseVideoReferences || canUseAudioReferences,
    maxReferenceImages,
    maxReferenceVideos,
    maxVideoRefDuration,
    maxReferenceAudios,
    maxAudioRefDuration,
  };
};

const applyCountLimit = <T>(items: T[], limit: number | null): T[] => {
  if (limit === null) return items;
  if (limit <= 0) return items.length === 0 ? items : [];
  if (items.length <= limit) return items;
  return items.slice(0, limit);
};

const applyDurationLimit = <T extends VideoReferenceTimedMedia>(
  items: T[],
  limit: number,
): T[] => {
  if (limit <= 0) return items.length === 0 ? items : [];
  if (!Number.isFinite(limit)) return items;

  let total = 0;
  let keep = 0;
  for (const item of items) {
    // Metadata probes and legacy Recreate state use zero for unknown/error.
    // With an advertised aggregate cap, accepting a non-positive or
    // non-finite value would let unmeasured media bypass that cap.
    if (!Number.isFinite(item.duration) || item.duration <= 0) break;
    if (total + item.duration > limit) break;
    total += item.duration;
    keep++;
  }
  return keep === items.length ? items : items.slice(0, keep);
};

/**
 * Project store media into the shape the selected model can actually use.
 * Consumers use this same result for visible controls, request construction,
 * duration constraints, and pricing so a model switch cannot leave hidden
 * stale media affecting only one path.
 */
export const projectVideoReferenceMedia = <
  TImage,
  TVideo extends VideoReferenceTimedMedia,
  TAudio extends VideoReferenceTimedMedia,
>(
  source: VideoReferenceCapabilities,
  state: VideoReferenceMediaState<TImage, TVideo, TAudio>,
): VideoReferenceMediaProjection<TImage, TVideo, TAudio> => {
  const capabilities = getEffectiveVideoReferenceCapabilities(source);
  const inputMode =
    state.inputMode === "reference" && capabilities.supportsReferenceMode
      ? "reference"
      : "keyframe";

  if (inputMode === "reference") {
    return {
      capabilities,
      inputMode,
      referenceImages: applyCountLimit(
        state.referenceImages,
        capabilities.maxReferenceImages,
      ),
      endFrameImage: undefined,
      referenceVideos: applyDurationLimit(
        applyCountLimit(state.referenceVideos, capabilities.maxReferenceVideos),
        capabilities.maxVideoRefDuration,
      ),
      referenceAudios: applyDurationLimit(
        applyCountLimit(state.referenceAudios, capabilities.maxReferenceAudios),
        capabilities.maxAudioRefDuration,
      ),
    };
  }

  return {
    capabilities,
    inputMode,
    referenceImages: capabilities.supportsStartFrame
      ? applyCountLimit(state.referenceImages, 1)
      : state.referenceImages.length === 0
        ? state.referenceImages
        : [],
    endFrameImage: capabilities.supportsEndFrame
      ? state.endFrameImage
      : undefined,
    referenceVideos:
      state.referenceVideos.length === 0 ? state.referenceVideos : [],
    referenceAudios:
      state.referenceAudios.length === 0 ? state.referenceAudios : [],
  };
};
