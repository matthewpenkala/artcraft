import type { NavigateFunction } from "react-router-dom";
import { MediaFilesApi, PromptsApi, type Prompts } from "@storyteller/api";
import {
  hasNonImageRecreatedReferenceContexts,
  hydrateRecreatedReferences,
  probeMediaDurationFromUrl,
} from "@storyteller/common";
import { toast } from "../components/toast/toast";
import type {
  RefAudio,
  RefImage,
  RefVideo,
} from "../components/prompt-box/types";
import { useCreateImageStore } from "../pages/create-image/create-image-store";
import {
  useCreateVideoStore,
  type VideoInputMode,
} from "../pages/create-video/create-video-store";

// ── Types ──────────────────────────────────────────────────────────────────

export type RecreateMediaClass = "image" | "video";

export interface RecreatePayload {
  prompt: string;
  referenceImages: RefImage[];
  aspectRatio?: string;
  resolution?: string;
  bitrate?: string;
  modelId?: string;
  // video-only
  endFrameImage?: RefImage;
  referenceVideos?: RefVideo[];
  referenceAudios?: RefAudio[];
  generateWithSound?: boolean;
  durationSeconds?: number;
  inputMode?: VideoInputMode;
  generationCount?: number;
  excludedReferenceCount?: number;
}

export interface RecreateHydrationDependencies {
  loadDurationMillis: (
    mediaToken: string,
  ) => Promise<number | null | undefined>;
  probeVideoDuration: (url: string) => Promise<number | null>;
  probeAudioDuration: (url: string) => Promise<number | null>;
}

let latestRecreateRequest = 0;

function beginRecreateRequest(): number {
  const requestId = ++latestRecreateRequest;
  const imageStore = useCreateImageStore.getState();
  const videoStore = useCreateVideoStore.getState();
  if (imageStore.pendingRecreate) imageStore.setPendingRecreate(null);
  if (videoStore.pendingRecreate) videoStore.setPendingRecreate(null);
  return requestId;
}

// ── Public API ─────────────────────────────────────────────────────────────

// Seeds the video page with an image as the sole reference and navigates there.
// Shares the existing `pendingRecreate` slot on the video store so the create-
// video page's consume-effect handles wiring it into the prompt box.
export function applyMakeVideoFromImage(
  mediaToken: string,
  mediaUrl: string,
  navigate: NavigateFunction,
): void {
  beginRecreateRequest();
  useCreateVideoStore.getState().setPendingRecreate({
    prompt: "",
    referenceImages: [
      {
        id: crypto.randomUUID(),
        url: mediaUrl,
        mediaToken,
      },
    ],
    referenceVideos: [],
    referenceAudios: [],
    inputMode: "reference",
  });
  navigate("/create-video");
}

export async function applyRecreateFromMediaToken(
  mediaToken: string,
  fallbackMediaClass: RecreateMediaClass,
  navigate: NavigateFunction,
): Promise<void> {
  const requestId = beginRecreateRequest();
  try {
    const promptData = await fetchPromptForMedia(mediaToken);
    if (!promptData) {
      if (requestId === latestRecreateRequest) {
        toast.error("Recreate unavailable for this media");
      }
      return;
    }
    if (requestId !== latestRecreateRequest) return;
    const mediaClass = resolveMediaClass(promptData, fallbackMediaClass);
    if (!mediaClass) {
      toast.error("Recreate not supported for this media type");
      return;
    }
    const payload = await buildRecreatePayload(promptData, mediaClass);
    if (requestId !== latestRecreateRequest) return;
    if (payload.excludedReferenceCount) {
      const count = payload.excludedReferenceCount;
      toast.error(
        `${count} unreadable reference ${count === 1 ? "file was" : "files were"} excluded`,
      );
    }
    if (mediaClass === "video") {
      useCreateVideoStore.getState().setPendingRecreate(payload);
      navigate("/create-video");
    } else {
      useCreateImageStore.getState().setPendingRecreate(payload);
      navigate("/create-image");
    }
  } catch {
    if (requestId === latestRecreateRequest) {
      toast.error("Failed to load recreate data");
    }
  }
}

// Prefer the authoritative `maybe_model_class` from the prompt (image/video/
// audio/3d/…) over a URL-based guess. Unsupported classes return null so the
// caller can short-circuit with a clear error.
function resolveMediaClass(
  promptData: Prompts,
  fallback: RecreateMediaClass,
): RecreateMediaClass | null {
  const cls = promptData.maybe_model_class;
  if (cls === "image") return "image";
  if (cls === "video") return "video";
  if (cls && cls !== "") return null;
  return fallback;
}

export async function buildRecreatePayload(
  promptData: Prompts,
  mediaClass: RecreateMediaClass,
  hydration: RecreateHydrationDependencies = defaultHydrationDependencies,
): Promise<RecreatePayload> {
  if (promptData.context_items_complete === false) {
    throw new Error("Recreate reference context is incomplete");
  }
  const contextImages = promptData.maybe_context_images || [];
  if (
    mediaClass === "image" &&
    hasNonImageRecreatedReferenceContexts(
      contextImages.map(({ semantic }) => ({ semantic })),
    )
  ) {
    throw new Error("Image Recreate contains non-image reference media");
  }
  const {
    referenceImages,
    endFrameImage,
    referenceVideos,
    referenceAudios,
    excludedReferenceCount,
  } = await partitionContextImages(
    contextImages,
    hydration,
    promptData.maybe_positive_prompt || "",
  );
  if (
    mediaClass === "image" &&
    (endFrameImage || referenceVideos.length > 0 || referenceAudios.length > 0)
  ) {
    throw new Error("Image Recreate contains non-image reference media");
  }

  const payload: RecreatePayload = {
    prompt: promptData.maybe_positive_prompt || "",
    referenceImages,
    aspectRatio: promptData.maybe_aspect_ratio || undefined,
    resolution: promptData.maybe_resolution || undefined,
    bitrate: promptData.maybe_bitrate || undefined,
    modelId: promptData.maybe_model_type || undefined,
    generationCount: promptData.maybe_batch_count ?? undefined,
    excludedReferenceCount,
  };

  if (mediaClass === "video") {
    payload.endFrameImage = endFrameImage;
    payload.referenceVideos = referenceVideos;
    payload.referenceAudios = referenceAudios;
    payload.generateWithSound = promptData.maybe_generate_audio ?? undefined;
    payload.durationSeconds = promptData.maybe_duration_seconds ?? undefined;
    payload.inputMode = inferInputMode(
      promptData,
      referenceImages,
      referenceVideos,
      referenceAudios,
    );
  }

  return payload;
}

// ── Internals ──────────────────────────────────────────────────────────────

async function fetchPromptForMedia(
  mediaToken: string,
): Promise<Prompts | null> {
  const mediaApi = new MediaFilesApi();
  const mediaResp = await mediaApi.GetMediaFileByToken({
    mediaFileToken: mediaToken,
  });
  if (!mediaResp.success || !mediaResp.data?.maybe_prompt_token) return null;

  const promptsApi = new PromptsApi();
  const promptResp = await promptsApi.GetPromptsByToken({
    token: mediaResp.data.maybe_prompt_token,
  });
  return promptResp.success ? (promptResp.data ?? null) : null;
}

interface PartitionedContext {
  referenceImages: RefImage[];
  endFrameImage?: RefImage;
  referenceVideos: RefVideo[];
  referenceAudios: RefAudio[];
  excludedReferenceCount: number;
}

async function partitionContextImages(
  contextImages: {
    semantic: string;
    media_token: string;
    media_links: { cdn_url: string };
  }[],
  hydration: RecreateHydrationDependencies,
  positivePrompt: string,
): Promise<PartitionedContext> {
  const hydrated = await hydrateRecreatedReferences(
    contextImages.map((context) => ({
      semantic: context?.semantic,
      mediaToken: context?.media_token,
      url: context?.media_links?.cdn_url,
    })),
    hydration,
    positivePrompt,
  );
  const asReference = (reference: { mediaToken: string; url: string }) => ({
    id: crypto.randomUUID(),
    url: reference.url,
    mediaToken: reference.mediaToken,
  });

  return {
    referenceImages: hydrated.referenceImages.map(asReference),
    endFrameImage: hydrated.endFrameImage
      ? asReference(hydrated.endFrameImage)
      : undefined,
    referenceVideos: hydrated.referenceVideos.map((reference) => ({
      ...asReference(reference),
      duration: reference.duration,
    })),
    referenceAudios: hydrated.referenceAudios.map((reference) => ({
      ...asReference(reference),
      duration: reference.duration,
    })),
    excludedReferenceCount: hydrated.excludedReferenceCount,
  };
}

const defaultHydrationDependencies: RecreateHydrationDependencies = {
  loadDurationMillis: async (mediaToken) => {
    const response = await new MediaFilesApi().GetMediaFileByToken({
      mediaFileToken: mediaToken,
    });
    return response.success ? response.data?.maybe_duration_millis : null;
  },
  probeVideoDuration: (url) => probeMediaDurationFromUrl("video", url),
  probeAudioDuration: (url) => probeMediaDurationFromUrl("audio", url),
};

function inferInputMode(
  promptData: Prompts,
  referenceImages: RefImage[],
  referenceVideos: RefVideo[],
  referenceAudios: RefAudio[],
): VideoInputMode {
  const hasKeyframeSemantics = (promptData.maybe_context_images || []).some(
    (ci) =>
      ci.semantic === "vid_start_frame" || ci.semantic === "vid_end_frame",
  );
  if (hasKeyframeSemantics) return "keyframe";
  const mode = promptData.maybe_generation_mode;
  if (mode === "keyframe" || mode === "reference") return mode;
  return referenceImages.length > 0 ||
    referenceVideos.length > 0 ||
    referenceAudios.length > 0
    ? "reference"
    : "keyframe";
}
