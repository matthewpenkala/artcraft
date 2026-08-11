import toast from "react-hot-toast";
import {
  FilterMediaClasses,
  MediaFilesApi,
  PromptsApi,
  downloadUrlToPath,
  pickDownloadDirectory,
  promptDownloadLocationIfNeeded,
} from "@storyteller/api";
import type { Prompts } from "@storyteller/api";
import { DownloadUrl, useModelsStore } from "@storyteller/tauri-api";
import {
  RefImage,
  RefVideo,
  RefAudio,
  usePromptImageStore,
  usePromptVideoStore,
  type PromptImageRecreateState,
  type PromptVideoRecreateState,
} from "@storyteller/ui-promptbox";
import {
  useClassyModelSelectorStore,
  ModelPage,
} from "@storyteller/ui-model-selector";
import {
  CommonAspectRatio,
  CommonQuality,
  CommonResolution,
  getEffectiveVideoReferenceCapabilities,
  hasVideoDurationConfiguration,
  type ImageModel,
  resolveVideoDuration,
  type VideoModel,
} from "@storyteller/model-list";
import {
  hasNonImageRecreatedReferenceContexts,
  hydrateRecreatedReferences,
  prepareMediaReferencesForSubmission,
  probeMediaDurationFromUrl,
  resolveTargetModelCount,
  resolveTargetModelOption,
  validateRecreatedVideoReferences,
  type RecreatedReferenceHydrationDependencies,
} from "@storyteller/common";
import {
  galleryModalLightboxVisible,
  galleryModalVisibleDuringDrag,
  galleryModalVisibleViewMode,
} from "@storyteller/ui-gallery-modal";
import {
  getCachedPrompt,
  type GalleryItem,
} from "@storyteller/ui-generation-list";
import { useTabStore } from "~/pages/Stores/TabState";

// Media item actions shared by the TopBar gallery modal / lightbox wiring and
// the create pages' generation feed (rows + cards). All of them operate on
// global stores via getState(), so they're safe to call from anywhere.

export const SHARE_URL_BASE = "https://getartcraft.com/media/";

const EXT_BY_MEDIA_CLASS: Record<string, string> = {
  image: "png",
  video: "mp4",
  audio: "mp3",
  // "dimensional" is the deprecated pre-split 3D class; mesh/splat replace it.
  dimensional: "glb",
  mesh: "glb",
  splat: "spz",
};

function extensionForUrl(url: string, mediaClass?: string): string {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.([a-z0-9]{2,5})$/i);
    if (match) return match[1].toLowerCase();
  } catch {
    // ignore — fall through to mediaClass default
  }
  if (mediaClass && EXT_BY_MEDIA_CLASS[mediaClass]) {
    return EXT_BY_MEDIA_CLASS[mediaClass];
  }
  return "bin";
}

/** Download a media file, prompting for a location when configured to. */
export async function downloadMediaFileToDisk(
  url: string,
  mediaClass?: string,
) {
  try {
    const chosenPath = await promptDownloadLocationIfNeeded(url);
    if (chosenPath === null) {
      // User dismissed the picker.
      return;
    }
    if (typeof chosenPath === "string") {
      await downloadUrlToPath(url, chosenPath);
    } else {
      await DownloadUrl(url);
    }
    if (mediaClass === FilterMediaClasses.DIMENSIONAL) {
      toast.success(`Downloaded 3D model`);
    } else {
      toast.success(`Downloaded ${mediaClass}`);
    }
  } catch (error) {
    console.error(">>> Failed to download file:", error);
    // NB: Rust/Tauri should now flash a toast instead.
    //toast.error("Failed to download file");
  }
}

/**
 * Batch download: prompt for a directory, then save each item as its own
 * file (`artcraft-{token}.{ext}`). Progress and the outcome are surfaced via
 * a single updating toast. Returns true when at least one file was saved
 * (false on dismiss / nothing downloadable).
 */
export async function downloadMediaFilesToFolder(
  items: GalleryItem[],
): Promise<boolean> {
  const downloadable = items.filter(
    (it): it is GalleryItem & { fullImage: string } => !!it.fullImage,
  );
  if (downloadable.length === 0) return false;

  const dir = await pickDownloadDirectory();
  if (!dir) {
    // User dismissed the picker.
    return false;
  }

  const toastId = toast.loading(`Saving 1 of ${downloadable.length}…`);
  let failedCount = 0;
  for (let i = 0; i < downloadable.length; i++) {
    const item = downloadable[i];
    toast.loading(`Saving ${i + 1} of ${downloadable.length}…`, {
      id: toastId,
    });
    try {
      const ext = extensionForUrl(item.fullImage, item.mediaClass);
      await downloadUrlToPath(
        item.fullImage,
        `${dir}/artcraft-${item.id}.${ext}`,
      );
    } catch (error) {
      console.error(">>> Failed to save file:", error);
      failedCount++;
    }
  }

  const saved = downloadable.length - failedCount;
  if (failedCount === 0) {
    toast.success(`Saved ${saved} ${saved === 1 ? "file" : "files"}`, {
      id: toastId,
    });
  } else if (saved > 0) {
    toast.error(
      `${failedCount} of ${downloadable.length} files failed to save`,
      { id: toastId },
    );
  } else {
    toast.error("Could not save the selected files.", { id: toastId });
  }
  return saved > 0;
}

/** Seed the video page with `url` as the starting image and switch to it. */
export async function applyMakeVideoFromImage(
  url: string,
  mediaToken?: string,
) {
  try {
    if (!mediaToken || mediaToken !== mediaToken.trim()) {
      toast.error("This image is not ready to use as a video reference.");
      return;
    }
    const referenceImage: RefImage = {
      id: Math.random().toString(36).substring(7),
      url,
      mediaToken,
    };
    ++latestDesktopRecreateRequest;
    const videoState = usePromptVideoStore.getState();
    videoState.commitRecreate({
      prompt: "",
      resolution: videoState.resolution,
      aspectRatio: videoState.aspectRatio,
      referenceImages: [referenceImage],
      endFrameImage: undefined,
      referenceVideos: [],
      referenceAudios: [],
      generateWithSound: videoState.generateWithSound,
      duration: videoState.duration,
      inputMode: "keyframe",
      generationCount: videoState.generationCount,
    });
    useTabStore.getState().setActiveTab("VIDEO");
    galleryModalVisibleViewMode.value = false;
    galleryModalVisibleDuringDrag.value = false;
    galleryModalLightboxVisible.value = false;
  } catch (e) {
    // no-op
  }
}

/** Copy a public share link for the media token. Returns success. */
export async function copyShareLink(mediaToken: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(`${SHARE_URL_BASE}${mediaToken}`);
    toast.success("Share link copied");
    return true;
  } catch {
    toast.error("Unable to copy link");
    return false;
  }
}

export type DesktopRecreateTransaction =
  | {
      mediaClass: "image";
      targetModel: ImageModel;
      usedModelFallback: boolean;
      excludedReferenceCount: number;
      state: PromptImageRecreateState;
    }
  | {
      mediaClass: "video";
      targetModel: VideoModel;
      usedModelFallback: boolean;
      excludedReferenceCount: number;
      state: PromptVideoRecreateState;
    };

let latestDesktopRecreateRequest = 0;

function resolveDesktopRecreateMediaClass(
  promptData: Prompts,
  fallback: string | undefined,
): "image" | "video" | null {
  const authoritativeClass = promptData.maybe_model_class;
  if (authoritativeClass === "image" || authoritativeClass === "video") {
    return authoritativeClass;
  }
  if (authoritativeClass) return null;
  return fallback === "image" || fallback === "video" ? fallback : null;
}

const createReferenceId = (): string =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const resolutionLabel = (
  value: string | null | undefined,
): string | undefined => {
  if (!value) return undefined;
  const mapped: Record<string, string> = {
    half_k: "480p",
    four_eighty_p: "480p",
    seven_twenty_p: "720p",
    one_k: "1080p",
    ten_eighty_p: "1080p",
    two_k: "2k",
    three_k: "3k",
    four_k: "4k",
  };
  return mapped[value] ?? value;
};

const modelMatches = (
  model: { id: string; tauriId: string },
  requested: string,
): boolean => model.id === requested || model.tauriId === requested;

const selectImageRecreateModel = (
  models: readonly ImageModel[],
  requested: string | null,
): { model: ImageModel; usedFallback: boolean } => {
  const eligible = models.filter((model) => model.canTextToImage);
  const restored = requested
    ? eligible.find((model) => modelMatches(model, requested))
    : undefined;
  const model =
    restored ??
    eligible.find((candidate) => modelMatches(candidate, "nano_banana_pro")) ??
    eligible[0];
  if (!model) throw new Error("No image generation model is available");
  return { model, usedFallback: !!requested && !restored };
};

const selectVideoRecreateModel = (
  models: readonly VideoModel[],
  requested: string | null,
): { model: VideoModel; usedFallback: boolean } => {
  const eligible = models.filter((model) => model.id !== "switch_x");
  const restored = requested
    ? eligible.find((model) => modelMatches(model, requested))
    : undefined;
  const model =
    restored ??
    eligible.find((candidate) => modelMatches(candidate, "seedance_2p0")) ??
    eligible[0];
  if (!model) throw new Error("No video generation model is available");
  return { model, usedFallback: !!requested && !restored };
};

const inferDesktopVideoInputMode = (
  promptData: Prompts,
  referenceCount: number,
  timedReferenceCount: number,
): "keyframe" | "reference" => {
  const contexts = promptData.maybe_context_images ?? [];
  if (
    contexts.some(
      ({ semantic }) =>
        semantic === "vid_start_frame" || semantic === "vid_end_frame",
    )
  ) {
    return "keyframe";
  }
  if (promptData.maybe_generation_mode === "keyframe") return "keyframe";
  if (promptData.maybe_generation_mode === "reference") return "reference";
  return referenceCount > 0 || timedReferenceCount > 0
    ? "reference"
    : "keyframe";
};

/** Build and validate the full desktop Recreate state without mutating UI stores. */
export async function buildDesktopRecreateTransaction(
  data: {
    promptData: Prompts;
    mediaClass: "image" | "video";
  },
  models: {
    imageModels: readonly ImageModel[];
    videoModels: readonly VideoModel[];
  },
  hydration: RecreatedReferenceHydrationDependencies,
): Promise<DesktopRecreateTransaction> {
  const { promptData, mediaClass } = data;
  if (promptData.context_items_complete === false) {
    throw new Error("Recreate reference context is incomplete");
  }
  const contexts = promptData.maybe_context_images ?? [];
  const hydrationInputs = contexts.map((context) => ({
    semantic: context.semantic,
    mediaToken: context.media_token,
    url: context.media_links.cdn_url,
  }));

  if (
    mediaClass === "image" &&
    hasNonImageRecreatedReferenceContexts(hydrationInputs)
  ) {
    throw new Error("Image Recreate contains non-image reference media");
  }

  const hydrated = await hydrateRecreatedReferences(
    hydrationInputs,
    hydration,
    promptData.maybe_positive_prompt ?? "",
  );
  const asImage = (reference: {
    mediaToken: string;
    url: string;
  }): RefImage => ({
    id: createReferenceId(),
    url: reference.url,
    mediaToken: reference.mediaToken,
  });
  const referenceImages = hydrated.referenceImages.map(asImage);

  if (mediaClass === "image") {
    const { model, usedFallback } = selectImageRecreateModel(
      models.imageModels,
      promptData.maybe_model_type,
    );
    const submitted = prepareMediaReferencesForSubmission(referenceImages);
    if (!submitted) throw new Error("Image Recreate contains invalid tokens");
    if (
      submitted.length > 0 &&
      (!model.canUseImagePrompt || submitted.length > model.maxImagePromptCount)
    ) {
      throw new Error("Image references conflict with the target model");
    }

    return {
      mediaClass,
      targetModel: model,
      usedModelFallback: usedFallback,
      excludedReferenceCount: hydrated.excludedReferenceCount,
      state: {
        prompt: promptData.maybe_positive_prompt ?? "",
        referenceImages: submitted,
        generationCount: resolveTargetModelCount(
          promptData.maybe_batch_count,
          model.predefinedGenerationCounts,
          1,
          model.maxGenerationCount,
          model.defaultGenerationCount,
        ),
        commonAspectRatio: resolveTargetModelOption(
          promptData.maybe_aspect_ratio,
          model.aspectRatios,
          model.defaultAspectRatio,
        ) as CommonAspectRatio | undefined,
        commonResolution: resolveTargetModelOption(
          promptData.maybe_resolution,
          model.resolutions,
          model.defaultResolution,
        ) as CommonResolution | undefined,
        commonQuality: resolveTargetModelOption(
          undefined,
          model.qualityOptions,
          model.defaultQuality,
        ) as CommonQuality | undefined,
      },
    };
  }

  const { model, usedFallback } = selectVideoRecreateModel(
    models.videoModels,
    promptData.maybe_model_type,
  );
  const referenceVideos: RefVideo[] = hydrated.referenceVideos.map(
    (reference) => ({ ...asImage(reference), duration: reference.duration }),
  );
  const referenceAudios: RefAudio[] = hydrated.referenceAudios.map(
    (reference) => ({ ...asImage(reference), duration: reference.duration }),
  );
  const endFrames = prepareMediaReferencesForSubmission(
    hydrated.endFrameImage ? [asImage(hydrated.endFrameImage)] : [],
  );
  const submittedImages = prepareMediaReferencesForSubmission(referenceImages);
  const submittedVideos = prepareMediaReferencesForSubmission(referenceVideos);
  const submittedAudios = prepareMediaReferencesForSubmission(referenceAudios);
  if (!endFrames || !submittedImages || !submittedVideos || !submittedAudios) {
    throw new Error("Video Recreate contains invalid reference tokens");
  }

  const inputMode = inferDesktopVideoInputMode(
    promptData,
    submittedImages.length,
    submittedVideos.length + submittedAudios.length,
  );
  const capabilities = getEffectiveVideoReferenceCapabilities(model);
  const requiresStartFrame =
    model.requiresImage || model.textToVideoSupported === false;
  const referenceStatus = validateRecreatedVideoReferences(
    {
      imageCount: submittedImages.length,
      hasEndFrame: endFrames.length > 0,
      videoDurations: submittedVideos.map(({ duration }) => duration),
      audioDurations: submittedAudios.map(({ duration }) => duration),
    },
    inputMode,
    { ...capabilities, requiresStartFrame },
  );
  if (referenceStatus !== "valid") {
    throw new Error(
      `Video references conflict with target model: ${referenceStatus}`,
    );
  }

  const duration = resolveVideoDuration(
    model,
    promptData.maybe_duration_seconds,
    {
      imageCount: submittedImages.length,
      hasEndFrameImage: endFrames.length > 0,
      videoCount: submittedVideos.length,
      audioCount: submittedAudios.length,
    },
  );
  if (duration === null && hasVideoDurationConfiguration(model)) {
    throw new Error("Target model has no valid duration for these references");
  }

  const aspectValues = model.sizeOptions.map(({ tauriValue }) => tauriValue);
  const aspectValue = resolveTargetModelOption(
    promptData.maybe_aspect_ratio,
    aspectValues,
    model.defaultAspectRatio ?? aspectValues[0],
  );
  const aspectRatio = aspectValue
    ? (model.sizeOptions.find(({ tauriValue }) => tauriValue === aspectValue)
        ?.textLabel ?? null)
    : null;
  const restoredResolution = resolutionLabel(promptData.maybe_resolution);

  return {
    mediaClass,
    targetModel: model,
    usedModelFallback: usedFallback,
    excludedReferenceCount: hydrated.excludedReferenceCount,
    state: {
      prompt: promptData.maybe_positive_prompt ?? "",
      referenceImages: submittedImages,
      endFrameImage: endFrames[0],
      referenceVideos: submittedVideos,
      referenceAudios: submittedAudios,
      inputMode,
      duration,
      generateWithSound: model.generateWithSound
        ? (promptData.maybe_generate_audio ?? false)
        : false,
      aspectRatio,
      resolution:
        resolveTargetModelOption(
          restoredResolution,
          model.resolutionOptions,
          model.defaultResolution,
        ) ?? "720p",
      generationCount: resolveTargetModelCount(
        promptData.maybe_batch_count,
        model.predefinedGenerationCounts,
        model.minGenerationCount,
        model.maxGenerationCount,
        model.defaultGenerationCount,
      ),
    },
  };
}

const defaultDesktopHydration: RecreatedReferenceHydrationDependencies = {
  loadDurationMillis: async (mediaToken) => {
    const response = await new MediaFilesApi().GetMediaFileByToken({
      mediaFileToken: mediaToken,
    });
    return response.success ? response.data?.maybe_duration_millis : null;
  },
  probeVideoDuration: (url) => probeMediaDurationFromUrl("video", url),
  probeAudioDuration: (url) => probeMediaDurationFromUrl("audio", url),
};

const closeDesktopGallery = () => {
  galleryModalVisibleViewMode.value = false;
  galleryModalVisibleDuringDrag.value = false;
  galleryModalLightboxVisible.value = false;
};

async function applyDesktopRecreate(
  data: { promptData: Prompts; mediaClass: "image" | "video" },
  requestId: number,
): Promise<void> {
  const modelsState = useModelsStore.getState();
  if (!modelsState.loaded || modelsState.isLoading) {
    await modelsState.loadModelsFromBackend();
  }
  if (requestId !== latestDesktopRecreateRequest) return;

  const liveModels = useModelsStore.getState();
  const transaction = await buildDesktopRecreateTransaction(
    data,
    liveModels,
    defaultDesktopHydration,
  );
  if (requestId !== latestDesktopRecreateRequest) return;

  const modelStore = useClassyModelSelectorStore.getState();
  if (transaction.mediaClass === "video") {
    modelStore.setSelectedModel(
      ModelPage.ImageToVideo,
      transaction.targetModel,
    );
    usePromptVideoStore.getState().commitRecreate(transaction.state);
    useTabStore.getState().setActiveTab("VIDEO");
  } else {
    modelStore.setSelectedModel(ModelPage.TextToImage, transaction.targetModel);
    usePromptImageStore.getState().commitRecreate(transaction.state);
    useTabStore.getState().setActiveTab("IMAGE");
  }
  closeDesktopGallery();

  if (transaction.usedModelFallback) {
    toast.error(
      `The original model is unavailable. Recreate uses ${transaction.targetModel.selectorName}.`,
    );
  }
  if (transaction.excludedReferenceCount > 0) {
    const count = transaction.excludedReferenceCount;
    toast.error(
      `${count} unreadable reference ${count === 1 ? "file was" : "files were"} excluded`,
    );
  }
}

/**
 * Re-seed the image or video create page from a generation's prompt record.
 * Every asynchronous dependency resolves and validates before one synchronous
 * commit; a newer Recreate request invalidates this one.
 */
export async function applyRecreateFromPromptData(data: {
  promptData: Prompts;
  mediaClass: string | undefined;
}): Promise<void> {
  const requestId = ++latestDesktopRecreateRequest;
  const mediaClass = resolveDesktopRecreateMediaClass(
    data.promptData,
    data.mediaClass,
  );
  if (!mediaClass) {
    toast.error("Recreate is not supported for this media type.");
    return;
  }
  try {
    await applyDesktopRecreate(
      { promptData: data.promptData, mediaClass },
      requestId,
    );
  } catch (error) {
    if (requestId === latestDesktopRecreateRequest) {
      console.error("Desktop Recreate failed", error);
      toast.error("Could not restore the original generation settings.");
    }
  }
}

/** Resolve one prompt record (cache first, then batch API) and replay it. */
export async function applyRecreateFromPromptToken(
  promptToken: string,
  mediaClass: "image" | "video",
): Promise<void> {
  const requestId = ++latestDesktopRecreateRequest;
  let promptData: Prompts | undefined = getCachedPrompt(promptToken);
  if (!promptData) {
    try {
      const res = await new PromptsApi().BatchGetPrompts({
        tokens: [promptToken],
      });
      promptData = res.success && res.data?.[0] ? res.data[0] : undefined;
    } catch {
      // handled below
    }
  }
  if (requestId !== latestDesktopRecreateRequest) return;
  if (!promptData) {
    toast.error("Could not load the original prompt.");
    return;
  }
  const resolvedMediaClass = resolveDesktopRecreateMediaClass(
    promptData,
    mediaClass,
  );
  if (!resolvedMediaClass) {
    toast.error("Recreate is not supported for this media type.");
    return;
  }
  try {
    await applyDesktopRecreate(
      { promptData, mediaClass: resolvedMediaClass },
      requestId,
    );
  } catch (error) {
    if (requestId === latestDesktopRecreateRequest) {
      console.error("Desktop Recreate failed", error);
      toast.error("Could not restore the original generation settings.");
    }
  }
}
