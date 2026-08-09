import { useEffect } from "react";
import { ModelPage } from "@storyteller/ui-model-selector";
import {
  hasVideoDurationConfiguration,
  Model,
  projectVideoDuration,
  resolveVideoAspectRatioOption,
  VideoModel,
} from "@storyteller/model-list";
import { GenerationProvider } from "@storyteller/api-enums";
import { usePromptVideoStore } from "@storyteller/ui-promptbox";
import {
  EstimateVideoCost,
  isEstimateVideoCostSuccess,
} from "@storyteller/tauri-api";
import { useCostEstimateLifecycle } from "./useCostEstimateLifecycle";
import {
  videoModelToCommonVideoModel,
  videoAspectRatioToCommonAspectRatio,
  videoStoreToGenerationMode,
  stringToCommonVideoResolution,
} from "./convert/index.js";

export function useVideoCostEstimate(
  activePage: ModelPage,
  selectedModel: Model | null | undefined,
  selectedProvider: string | null | undefined,
): { isLoading: boolean } {
  const { isLoading, begin, clear } = useCostEstimateLifecycle();

  const duration = usePromptVideoStore((s) => s.duration);
  const aspectRatio = usePromptVideoStore((s) => s.aspectRatio);
  const resolution = usePromptVideoStore((s) => s.resolution);
  const inputMode = usePromptVideoStore((s) => s.inputMode);
  const referenceImages = usePromptVideoStore((s) => s.referenceImages);
  const endFrameImage = usePromptVideoStore((s) => s.endFrameImage);
  const generateWithSound = usePromptVideoStore((s) => s.generateWithSound);
  const videoModel =
    selectedModel?.kind === "video_model"
      ? (selectedModel as VideoModel)
      : null;
  const effectiveReferenceMode =
    inputMode === "reference" && !!videoModel?.supportsReferenceMode;
  const resolvedDuration = videoModel
    ? projectVideoDuration(videoModel, {
        storedDuration: duration,
        effectiveReferenceMode,
        imageCount: referenceImages.length,
        hasEndFrameImage: !!endFrameImage,
      }).estimateDuration
    : null;

  useEffect(() => {
    if (activePage !== ModelPage.ImageToVideo || !videoModel) {
      clear(ModelPage.ImageToVideo);
      return;
    }
    if (
      resolvedDuration === null &&
      hasVideoDurationConfiguration(videoModel)
    ) {
      clear(ModelPage.ImageToVideo);
      return;
    }

    const commonModel = videoModelToCommonVideoModel(videoModel.tauriId);
    if (!commonModel) {
      clear(ModelPage.ImageToVideo);
      return;
    }

    const resolvedAspectRatioOption = resolveVideoAspectRatioOption(
      videoModel,
      aspectRatio,
    );
    const commonAspectRatio = videoAspectRatioToCommonAspectRatio(
      resolvedAspectRatioOption?.textLabel ?? null,
      videoModel.sizeOptions,
    );
    const commonResolution = stringToCommonVideoResolution(resolution);
    const generationMode = videoStoreToGenerationMode(
      inputMode,
      referenceImages,
      endFrameImage,
      videoModel.supportsReferenceMode,
    );
    const provider =
      (selectedProvider as GenerationProvider | null | undefined) ??
      GenerationProvider.Artcraft;

    const request = begin(ModelPage.ImageToVideo);
    // The prompt store is authoritative immediately. Debounce only the remote
    // estimate call so the UI never displays the previous quote beside a newly
    // selected duration while still avoiding a request for every drag event.
    const estimateTimer = setTimeout(() => {
      void (async () => {
        try {
          const result = await EstimateVideoCost({
            model: commonModel,
            provider,
            generation_mode: generationMode,
            aspect_ratio: commonAspectRatio ?? undefined,
            resolution: commonResolution ?? undefined,
            duration_seconds: resolvedDuration ?? undefined,
            generate_audio: generateWithSound,
          });
          request.settle(
            isEstimateVideoCostSuccess(result)
              ? (result.payload.cost_in_credits ?? null)
              : null,
          );
        } catch {
          request.settle(null);
        }
      })();
    }, 300);

    return () => {
      clearTimeout(estimateTimer);
      request.cancel();
    };
  }, [
    activePage,
    videoModel,
    selectedProvider,
    resolvedDuration,
    aspectRatio,
    resolution,
    inputMode,
    effectiveReferenceMode,
    referenceImages.length,
    !!endFrameImage,
    generateWithSound,
    begin,
    clear,
  ]);

  return { isLoading };
}
