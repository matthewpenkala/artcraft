import {
  durationSecondsToMillis,
  sumMediaDurationMillis,
} from "./media-duration";

const U32_MAX = 0xffff_ffff;

export interface MediaTokenDurationPair {
  mediaToken: string;
  durationSeconds: number;
}

export interface VideoCostEstimateRequestParams {
  model: string;
  aspectRatio?: string;
  resolution?: string | null;
  bitrate?: string | null;
  duration?: number | null;
  numVideos?: number;
  hasStartFrame: boolean;
  hasEndFrame: boolean;
  isReferenceMode: boolean;
  referenceImageCount: number;
  referenceVideoDurationPairs?: readonly MediaTokenDurationPair[];
  referenceAudioDurationPairs?: readonly MediaTokenDurationPair[];
  generateAudio?: boolean;
}

export interface VideoCostEstimateRequestShape {
  model: string;
  aspect_ratio: string | null;
  resolution: string | null;
  bitrate: string | null;
  duration_seconds: number | null;
  generate_audio: boolean | null;
  video_batch_count: number;
  start_frame_image_media_token?: string;
  end_frame_image_media_token?: string;
  reference_image_media_tokens?: string[];
  reference_video_media_tokens?: string[];
  reference_audio_media_tokens?: string[];
  estimate_only?: {
    reference_video_durations_millis: number[] | null;
    total_input_video_duration_millis: number | null;
    total_input_audio_duration_millis: number | null;
  };
}

/** Match generation's stable `Set` dedupe for media-token lists. */
function dedupeMediaDurationPairs(
  pairs: readonly MediaTokenDurationPair[],
): MediaTokenDurationPair[] | null {
  const seenTokens = new Set<string>();
  const deduped: MediaTokenDurationPair[] = [];

  for (const pair of pairs) {
    if (
      pair == null ||
      typeof pair.mediaToken !== "string" ||
      pair.mediaToken.length === 0
    ) {
      return null;
    }
    if (seenTokens.has(pair.mediaToken)) continue;
    seenTokens.add(pair.mediaToken);
    deduped.push(pair);
  }

  return deduped;
}

/**
 * Build the estimate request shared by both web clients. Reference duration
 * pairs preserve token identity and each video's integer-millisecond duration
 * so stable deduplication matches generation before the backend applies its
 * canonical per-file whole-second ceiling. The legacy aggregate remains raw
 * for backward compatibility. Invalid populated collections fail closed so
 * the UI cannot display a lower quote.
 */
export function buildVideoCostEstimateRequest(
  params: VideoCostEstimateRequestParams,
): VideoCostEstimateRequestShape | null {
  const body: VideoCostEstimateRequestShape = {
    model: params.model,
    aspect_ratio: params.aspectRatio ?? null,
    resolution: params.resolution ?? null,
    bitrate: params.bitrate ?? null,
    duration_seconds: params.duration ?? null,
    generate_audio: params.generateAudio ?? null,
    video_batch_count: params.numVideos ?? 1,
  };

  if (!params.isReferenceMode) {
    if (params.hasStartFrame) {
      body.start_frame_image_media_token = "placeholder";
    }
    if (params.hasEndFrame) {
      body.end_frame_image_media_token = "placeholder";
    }
    return body;
  }

  if (params.referenceImageCount > 0) {
    body.reference_image_media_tokens = new Array(
      params.referenceImageCount,
    ).fill("placeholder");
  }

  const videoPairs = dedupeMediaDurationPairs(
    params.referenceVideoDurationPairs ?? [],
  );
  const audioPairs = dedupeMediaDurationPairs(
    params.referenceAudioDurationPairs ?? [],
  );
  if (videoPairs == null || audioPairs == null) return null;

  const videoDurations = videoPairs.map((pair) => pair.durationSeconds);
  const audioDurations = audioPairs.map((pair) => pair.durationSeconds);
  const videoDurationMillisByReference = videoDurations.map(
    durationSecondsToMillis,
  );
  const videoDurationMillis =
    videoDurations.length === 0 ? null : sumMediaDurationMillis(videoDurations);
  const audioDurationMillis =
    audioDurations.length === 0 ? null : sumMediaDurationMillis(audioDurations);
  if (
    (videoDurations.length > 0 &&
      (videoDurationMillis == null ||
        videoDurationMillis > U32_MAX ||
        videoDurationMillisByReference.some(
          (duration) => duration == null || duration <= 0 || duration > U32_MAX,
        ))) ||
    (audioDurations.length > 0 &&
      (audioDurationMillis == null || audioDurationMillis > U32_MAX))
  ) {
    return null;
  }

  if (videoDurations.length > 0) {
    body.reference_video_media_tokens = videoPairs.map(
      (pair) => pair.mediaToken,
    );
  }
  if (audioDurations.length > 0) {
    body.reference_audio_media_tokens = audioPairs.map(
      (pair) => pair.mediaToken,
    );
  }
  if (videoDurationMillis != null || audioDurationMillis != null) {
    body.estimate_only = {
      reference_video_durations_millis:
        videoDurationMillisByReference.length > 0
          ? (videoDurationMillisByReference as number[])
          : null,
      total_input_video_duration_millis: videoDurationMillis,
      total_input_audio_duration_millis: audioDurationMillis,
    };
  }

  return body;
}
