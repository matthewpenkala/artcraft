import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { AudioLinesIcon, ClockIcon, FilmIcon } from "lucide-react";
import { DynamicIcon } from "@storyteller/icons";
import { CharactersApi, FilterMediaClasses } from "@storyteller/api";
import type { OmniGenVideoModelInfo } from "@storyteller/api";
import { ToggleButton } from "@storyteller/ui-button";
import { PopoverMenu, type PopoverItem } from "@storyteller/ui-popover";
import { SliderV2 } from "@storyteller/ui-sliderv2";
import { Tooltip } from "@storyteller/ui-tooltip";
import { GalleryModal, type GalleryItem } from "@storyteller/ui-gallery-modal";
import {
  PromptBox,
  CharactersModal,
  useCharactersStore,
  type RefImage,
  type RefVideo,
  type RefAudio,
  type MentionItem,
} from "../../components/prompt-box";
import {
  GenerationGalleryGrid,
  useGalleryData,
  useGenerationJobs,
  useAuthCheck,
  usePromptHeight,
  useLightboxNav,
  CreateMediaPageShell,
} from "../../components/generation-gallery";
import { Lightbox } from "../../components/lightbox/lightbox";
import { AppDownloadCta } from "../../components/app-download-cta/AppDownloadCta";
import { useCreateVideoStore } from "./create-video-store";
import {
  enqueueVideoGeneration,
  startVideoPolling,
} from "./generate-video-api";
import {
  AUTO_RATIOS,
  LABEL_TO_RES,
  buildResolutionPopoverItems,
  buildSizePopoverItems,
  resolveDurationForModel,
} from "./video-model-options";
import {
  AspectRatioIcon,
  AutoIcon,
} from "../create-image/components/AspectRatioIcon";
import { GenerationCountPicker } from "../create-image/components/GenerationCountPicker";
import { useVideoCostEstimate } from "../../lib/cost-estimate-api";
import { resolvePendingRecreateTargetModel } from "../../lib/pending-recreate-model";
import { useOmniGenVideoModels } from "@storyteller/omni-gen";
import {
  effectivePromptMaxLength,
  getCreatorIconPathForModelId,
  getEffectiveVideoReferenceCapabilities,
  getVideoDurationConstraint,
  hasVideoDurationConfiguration,
  projectVideoReferenceMedia,
  resolveVideoDuration,
} from "@storyteller/model-list";
import {
  prepareMediaReferencesForSubmission,
  resolveTargetModelCount,
  resolveTargetModelOption,
  validateRecreatedVideoReferences,
} from "@storyteller/common";
import { toast } from "../../components/toast/toast";

// ── Constants ────────────────────────────────────────────────────────────

const DEFAULT_MODEL_ID = "seedance_2p0";

const VIDEO_FILTER = [FilterMediaClasses.VIDEO];

const BITRATE_LABELS: Record<string, string> = {
  normal: "Normal",
  high: "High",
};
const LABEL_TO_BITRATE: Record<string, string> = Object.fromEntries(
  Object.entries(BITRATE_LABELS).map(([value, label]) => [label, value]),
);

const referenceCapabilitiesForModel = (
  model: OmniGenVideoModelInfo | undefined,
) => ({
  startFrame: model?.starting_keyframe_supported,
  endFrame: model?.ending_keyframe_supported,
  requiresImage:
    model?.starting_keyframe_required === true ||
    model?.text_to_video_supported === false,
  supportsImageReferences: model?.image_references_supported,
  supportsVideoReferences: model?.video_references_supported,
  supportsAudioReferences: model?.audio_references_supported,
  maxReferenceImages: model?.image_references_max ?? undefined,
  maxReferenceVideos: model?.video_references_max ?? undefined,
  maxVideoRefDuration:
    model?.video_references_max_total_duration_seconds ?? undefined,
  maxReferenceAudios: model?.audio_references_max ?? undefined,
  maxAudioRefDuration:
    model?.audio_references_max_total_duration_seconds ?? undefined,
});

// ── Model lookup ─────────────────────────────────────────────────────────

let _modelLookup = new Map<string, OmniGenVideoModelInfo>();

function buildModelPopoverItems(
  models: OmniGenVideoModelInfo[],
  selectedId: string,
): PopoverItem[] {
  _modelLookup = new Map(models.map((m) => [m.model, m]));
  return models.map((model) => ({
    label: model.full_name || model.model,
    selected: model.model === selectedId,
    icon: (
      <img
        src={getCreatorIconPathForModelId(model.model)}
        alt={`${model.model} logo`}
        className="h-4 w-4 icon-auto-contrast"
      />
    ),
    action: model.model,
  }));
}

// ── Component ────────────────────────────────────────────────────────────

export default function CreateVideo() {
  const { user, authChecked } = useAuthCheck();
  const { promptBoxRef, promptHeight } = usePromptHeight();

  // Fetch models from API
  const { models: apiModels } = useOmniGenVideoModels();

  // UI state
  const ui = useCreateVideoStore((s) => s.ui);
  const setUi = useCreateVideoStore((s) => s.setUi);

  const selectedModel = useMemo((): OmniGenVideoModelInfo | undefined => {
    if (!apiModels.length) return undefined;
    const model = ui.selectedModelId
      ? (apiModels.find((m) => m.model === ui.selectedModelId) ??
        apiModels.find((m) => m.model === DEFAULT_MODEL_ID) ??
        apiModels[0])
      : (apiModels.find((m) => m.model === DEFAULT_MODEL_ID) ?? apiModels[0]);
    return model?.text_to_video_supported === false
      ? { ...model, starting_keyframe_required: true }
      : model;
  }, [apiModels, ui.selectedModelId]);

  // Soft prompt limit from the API; undefined = unlimited. Seedance waives
  // the limit (Infinity) when the prompt contains Chinese characters: the
  // server counts CJK as more than one unit, so a client-side character
  // count would false-positive.
  const maxPromptLength = selectedModel
    ? effectivePromptMaxLength(
        selectedModel.model,
        selectedModel.text_prompt_max_length ?? undefined,
        ui.prompt,
      )
    : undefined;

  const prompt = ui.prompt;
  const setPrompt = useCallback((v: string) => setUi({ prompt: v }), [setUi]);
  const selectedSize =
    resolveTargetModelOption(
      ui.selectedSize,
      selectedModel?.aspect_ratio_options,
      selectedModel?.aspect_ratio_default,
    ) ?? ui.selectedSize;
  const setSelectedSize = useCallback(
    (v: string) => setUi({ selectedSize: v }),
    [setUi],
  );
  const duration = ui.duration;
  const setDuration = useCallback(
    (v: number | null) => setUi({ duration: v }),
    [setUi],
  );
  const resolution =
    resolveTargetModelOption(
      ui.resolution,
      selectedModel?.resolution_options,
      selectedModel?.resolution_default,
    ) ?? null;
  const setResolution = useCallback(
    (v: string | null) => setUi({ resolution: v }),
    [setUi],
  );
  const bitrate =
    resolveTargetModelOption(
      ui.bitrate,
      selectedModel?.bitrate_options,
      selectedModel?.bitrate_default,
    ) ?? null;
  const setBitrate = useCallback(
    (v: string | null) => setUi({ bitrate: v }),
    [setUi],
  );
  const generateWithSound = ui.generateWithSound;
  const numVideos = selectedModel
    ? resolveTargetModelCount(
        ui.numVideos,
        selectedModel.batch_size_options,
        selectedModel.batch_size_min,
        selectedModel.batch_size_max,
        selectedModel.batch_size_default,
      )
    : ui.numVideos;
  const setNumVideos = useCallback(
    (v: number) => setUi({ numVideos: v }),
    [setUi],
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const isGeneratingRef = useRef(false);

  // Reference media (persisted in store so refs survive navigation)
  const refs = useCreateVideoStore((s) => s.refs);
  const setRefs = useCreateVideoStore((s) => s.setRefs);
  const {
    referenceImages: storedReferenceImages,
    endFrameImage: storedEndFrameImage,
    referenceVideos: storedReferenceVideos,
    referenceAudios: storedReferenceAudios,
  } = refs;
  const referenceMediaProjection = useMemo(
    () =>
      projectVideoReferenceMedia(referenceCapabilitiesForModel(selectedModel), {
        inputMode: ui.inputMode,
        referenceImages: storedReferenceImages,
        endFrameImage: storedEndFrameImage,
        referenceVideos: storedReferenceVideos,
        referenceAudios: storedReferenceAudios,
      }),
    [
      selectedModel,
      ui.inputMode,
      storedReferenceImages,
      storedEndFrameImage,
      storedReferenceVideos,
      storedReferenceAudios,
    ],
  );
  const { referenceImages, endFrameImage, referenceVideos, referenceAudios } =
    referenceMediaProjection;
  const setReferenceImages = useCallback(
    (v: RefImage[]) => setRefs({ referenceImages: v }),
    [setRefs],
  );
  const setEndFrameImage = useCallback(
    (v?: RefImage) => setRefs({ endFrameImage: v }),
    [setRefs],
  );
  const setReferenceFrames = useCallback(
    (referenceImages: RefImage[], endFrameImage?: RefImage) =>
      setRefs({ referenceImages, endFrameImage }),
    [setRefs],
  );
  const setReferenceVideos = useCallback(
    (v: RefVideo[]) => setRefs({ referenceVideos: v }),
    [setRefs],
  );
  const setReferenceAudios = useCallback(
    (v: RefAudio[]) => setRefs({ referenceAudios: v }),
    [setRefs],
  );
  const [isImagePickerOpen, setIsImagePickerOpen] = useState(false);
  const [isEndFramePickerOpen, setIsEndFramePickerOpen] = useState(false);
  const [isCharactersModalOpen, setIsCharactersModalOpen] = useState(false);
  const [pickerSelectedIds, setPickerSelectedIds] = useState<string[]>([]);
  const [endFramePickerSelectedIds, setEndFramePickerSelectedIds] = useState<
    string[]
  >([]);

  useEffect(() => {
    if (isImagePickerOpen) setPickerSelectedIds([]);
  }, [isImagePickerOpen]);

  useEffect(() => {
    if (isEndFramePickerOpen) setEndFramePickerSelectedIds([]);
  }, [isEndFramePickerOpen]);

  // Characters store for @-mentions
  const storedCharacters = useCharactersStore((s) => s.characters);
  const charactersLoaded = useCharactersStore((s) => s.loaded);
  const storeSetCharacters = useCharactersStore((s) => s.setCharacters);
  const storeSetLoaded = useCharactersStore((s) => s.setLoaded);

  // Load characters on mount if not already loaded
  useEffect(() => {
    if (charactersLoaded) return;
    const api = new CharactersApi();
    api
      .ListAllCharacters()
      .then((res) => {
        if (res.success && res.data) {
          storeSetCharacters(
            res.data.map((c) => ({
              character_token: c.token,
              name: c.name,
              avatar_image_url: c.maybe_avatar?.cdn_url,
            })),
          );
        }
        storeSetLoaded(true);
      })
      .catch(() => storeSetLoaded(true));
  }, [charactersLoaded, storeSetCharacters, storeSetLoaded]);

  // Batch store (enqueue flow only)
  const batches = useCreateVideoStore((s) => s.batches);
  const startBatch = useCreateVideoStore((s) => s.startBatch);
  const setBatchJobToken = useCreateVideoStore((s) => s.setBatchJobToken);
  const completeBatch = useCreateVideoStore((s) => s.completeBatch);
  const failBatch = useCreateVideoStore((s) => s.failBatch);
  const pollingCleanupsRef = useRef<Map<string, () => void>>(new Map());

  // Derived model capabilities
  const hasSizeOptions = (selectedModel?.aspect_ratio_options?.length ?? 0) > 0;
  const hasResolutionOptions =
    (selectedModel?.resolution_options?.length ?? 0) > 0;
  const hasBitrateOptions = (selectedModel?.bitrate_options?.length ?? 0) > 0;
  const hasSound = !!selectedModel?.show_generate_with_sound_toggle;
  const supportsImagePrompts =
    !!selectedModel?.starting_keyframe_supported ||
    !!selectedModel?.starting_keyframe_required ||
    !!selectedModel?.image_references_supported;
  const referenceCapabilities = referenceMediaProjection.capabilities;
  const maxReferenceImages =
    referenceCapabilities.maxReferenceImages ?? Number.MAX_SAFE_INTEGER;
  const maxVideoRefs =
    referenceCapabilities.maxReferenceVideos ?? Number.MAX_SAFE_INTEGER;
  const maxAudioRefs =
    referenceCapabilities.maxReferenceAudios ?? Number.MAX_SAFE_INTEGER;
  const supportsRefMode = referenceCapabilities.supportsReferenceMode;
  const inputMode = referenceMediaProjection.inputMode;
  const isReferenceMode = supportsRefMode && inputMode === "reference";
  const hasEndFrame = !!(
    selectedModel?.ending_keyframe_supported && !isReferenceMode
  );
  const needsImage =
    !!selectedModel?.starting_keyframe_required && referenceImages.length === 0;
  const durationCapabilities = selectedModel
    ? {
        durationOptions: selectedModel.duration_seconds_options ?? undefined,
        minDuration: selectedModel.duration_seconds_min ?? undefined,
        maxDuration: selectedModel.duration_seconds_max ?? undefined,
        maxDurationWithImageReferences:
          selectedModel.duration_seconds_max_with_image_references ?? undefined,
        defaultDuration: selectedModel.duration_seconds_default ?? undefined,
      }
    : null;
  const durationMediaInputs = {
    imageCount: referenceImages.length,
    hasEndFrameImage: !isReferenceMode && !!endFrameImage,
    videoCount: referenceVideos.length,
    audioCount: referenceAudios.length,
  };
  const effectiveDuration = durationCapabilities
    ? (resolveVideoDuration(
        durationCapabilities,
        duration,
        durationMediaInputs,
      ) ??
      selectedModel?.duration_seconds_default ??
      5)
    : (duration ?? 5);

  // Jobs + gallery
  const jobs = useGenerationJobs({ mediaType: "video", enabled: !!user });
  const gallery = useGalleryData({
    username: user?.username ?? null,
    filterMediaClasses: VIDEO_FILTER,
    excludeUploads: true,
  });

  // Map job token → batch count so PendingCard can show "N videos generating"
  const jobTokenToBatchCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const batch of batches) {
      if (batch.jobToken && batch.batchCount && batch.batchCount > 1) {
        map.set(batch.jobToken, batch.batchCount);
      }
    }
    return map;
  }, [batches]);

  const enrichedInProgress = useMemo(
    () =>
      jobs.inProgress.map((job) => {
        const batchCount = jobTokenToBatchCount.get(job.id);
        return batchCount ? { ...job, batchCount } : job;
      }),
    [jobs.inProgress, jobTokenToBatchCount],
  );

  const newlyCompletedTokens = useMemo(
    () => new Set(jobs.newlyCompleted.map((i) => i.id)),
    [jobs.newlyCompleted],
  );

  // Lightbox
  const flatItems = useMemo(() => {
    const filtered = gallery.items.filter(
      (i) => !newlyCompletedTokens.has(i.id),
    );
    return [...jobs.newlyCompleted, ...filtered];
  }, [jobs.newlyCompleted, gallery.items, newlyCompletedTokens]);

  const lightbox = useLightboxNav(flatItems);

  const referenceVideoDurationPairs = useMemo(
    () =>
      referenceVideos.map((video) => ({
        mediaToken: video.mediaToken,
        durationSeconds: video.duration,
      })),
    [referenceVideos],
  );
  const referenceAudioDurationPairs = useMemo(
    () =>
      referenceAudios.map((audio) => ({
        mediaToken: audio.mediaToken,
        durationSeconds: audio.duration,
      })),
    [referenceAudios],
  );

  const estimatedCredits = useVideoCostEstimate({
    model: selectedModel?.model ?? "",
    aspectRatio: selectedSize,
    resolution,
    bitrate,
    duration: effectiveDuration,
    numVideos,
    hasStartFrame: !isReferenceMode && referenceImages.length > 0,
    hasEndFrame: !isReferenceMode && hasEndFrame && !!endFrameImage,
    isReferenceMode,
    referenceImageCount: isReferenceMode ? referenceImages.length : 0,
    referenceVideoDurationPairs: isReferenceMode
      ? referenceVideoDurationPairs
      : undefined,
    referenceAudioDurationPairs: isReferenceMode
      ? referenceAudioDurationPairs
      : undefined,
    generateAudio: hasSound ? generateWithSound : undefined,
  });

  // Characters are supported for Seedance 2.0 and Seedance 2.0 Fast, in
  // both keyframe and reference input modes.
  const supportsCharacters =
    selectedModel?.model === "seedance_2p0" ||
    selectedModel?.model === "seedance_2p0_fast";
  const activeCharacters = supportsCharacters ? storedCharacters : [];

  // Popover items
  const mentionItems = useMemo((): MentionItem[] => {
    const refItems: MentionItem[] = isReferenceMode
      ? [
          ...referenceImages.map((img, i) => ({
            label: `@Image${i + 1}`,
            type: "image" as const,
            preview: img.url,
          })),
          ...referenceVideos.map((vid, i) => ({
            label: `@Video${i + 1}`,
            type: "video" as const,
            preview: vid.url,
          })),
          ...referenceAudios.map((_aud, i) => ({
            label: `@Audio${i + 1}`,
            type: "audio" as const,
            preview: undefined,
          })),
        ]
      : [];
    const charItems: MentionItem[] = activeCharacters.map((char) => ({
      label: `@${char.name}`,
      type: "character" as const,
      preview: char.avatar_image_url,
    }));
    return [...refItems, ...charItems];
  }, [
    isReferenceMode,
    referenceImages,
    referenceVideos,
    referenceAudios,
    activeCharacters,
  ]);

  const modelItems = useMemo(
    () => buildModelPopoverItems(apiModels, selectedModel?.model ?? ""),
    [apiModels, selectedModel?.model],
  );
  const sizeItems = useMemo(
    () =>
      buildSizePopoverItems(
        selectedModel?.aspect_ratio_options ?? [],
        selectedSize,
      ),
    [selectedModel?.aspect_ratio_options, selectedSize],
  );
  const durationRange = useMemo((): { min: number; max: number } | null => {
    if (!durationCapabilities) return null;
    const constraint = getVideoDurationConstraint(
      durationCapabilities,
      durationMediaInputs,
    );
    if (constraint?.kind === "range" && constraint.max > constraint.min) {
      return { min: constraint.min, max: constraint.max };
    }
    if (constraint?.kind === "options" && constraint.options.length > 1) {
      return {
        min: constraint.options[0]!,
        max: constraint.options[constraint.options.length - 1]!,
      };
    }
    return null;
  }, [durationCapabilities, durationMediaInputs]);
  const [localDuration, setLocalDuration] = useState(effectiveDuration);
  const durationTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    clearTimeout(durationTimerRef.current);
    setLocalDuration(effectiveDuration);
    return () => clearTimeout(durationTimerRef.current);
  }, [effectiveDuration]);
  const handleDurationSlide = useCallback(
    (v: number) => {
      const resolved = durationCapabilities
        ? (resolveVideoDuration(durationCapabilities, v, durationMediaInputs) ??
          v)
        : v;
      setLocalDuration(resolved);
      clearTimeout(durationTimerRef.current);
      durationTimerRef.current = setTimeout(() => setDuration(resolved), 300);
    },
    [setDuration, durationCapabilities, durationMediaInputs],
  );
  const resolutionItems = useMemo(
    (): PopoverItem[] | null =>
      selectedModel?.resolution_options
        ? buildResolutionPopoverItems(
            selectedModel.resolution_options,
            resolution ?? selectedModel.resolution_default ?? null,
          )
        : null,
    [selectedModel, resolution],
  );
  const bitrateItems = useMemo(
    (): PopoverItem[] | null =>
      selectedModel?.bitrate_options?.length
        ? selectedModel.bitrate_options.map((value) => ({
            label: BITRATE_LABELS[value] ?? value,
            selected: value === bitrate,
          }))
        : null,
    [selectedModel, bitrate],
  );
  const inputModeItems = useMemo(
    (): PopoverItem[] | null =>
      supportsRefMode
        ? [
            {
              label: "Keyframe",
              description: "First/Last frame",
              selected: inputMode === "keyframe",
            },
            {
              label: "Reference",
              description: "Multi-media ref",
              selected: inputMode === "reference",
            },
          ]
        : null,
    [supportsRefMode, inputMode],
  );

  const hasContent =
    jobs.inProgress.length > 0 ||
    jobs.failed.length > 0 ||
    jobs.newlyCompleted.length > 0 ||
    gallery.items.length > 0 ||
    gallery.isInitialLoading;

  // ── Effects ──────────────────────────────────────────────────────────────

  // Consume a pending recreate payload (set by the lightbox Recreate button)
  // and populate the promptbox fields. Does NOT trigger generation. Subscribes
  // to the store so it fires even when the user is already on this route.
  //
  // References must commit BEFORE the prompt so the mention highlighter (which
  // builds its label regex from `referenceImages`/`referenceVideos`/etc.) knows
  // about every `@ImageN` before the contentEditable does its DOM sync. Without
  // this ordering, only the last reference's mention would end up colored.
  const pendingRecreate = useCreateVideoStore((s) => s.pendingRecreate);
  useEffect(() => {
    if (!pendingRecreate || apiModels.length === 0) return;
    const payload = pendingRecreate;
    if (useCreateVideoStore.getState().pendingRecreate !== payload) return;
    const rawTargetModel = resolvePendingRecreateTargetModel({
      payload,
      currentPending: useCreateVideoStore.getState().pendingRecreate,
      models: apiModels,
      defaultModelId: DEFAULT_MODEL_ID,
      onUnavailable: (modelId) => {
        useCreateVideoStore.getState().setPendingRecreate(null);
        toast.error(
          `The model "${modelId}" used for this generation is unavailable.`,
        );
      },
    });
    if (!rawTargetModel) return;
    const targetModel =
      rawTargetModel.text_to_video_supported === false
        ? { ...rawTargetModel, starting_keyframe_required: true }
        : rawTargetModel;

    const inputMode = payload.inputMode ?? "keyframe";
    const images = prepareMediaReferencesForSubmission(payload.referenceImages);
    const videos = prepareMediaReferencesForSubmission(
      payload.referenceVideos ?? [],
    );
    const audios = prepareMediaReferencesForSubmission(
      payload.referenceAudios ?? [],
    );
    const endFrames = prepareMediaReferencesForSubmission(
      payload.endFrameImage ? [payload.endFrameImage] : [],
    );
    const targetCapabilities = getEffectiveVideoReferenceCapabilities({
      startFrame: targetModel.starting_keyframe_supported,
      endFrame: targetModel.ending_keyframe_supported,
      requiresImage: targetModel.starting_keyframe_required,
      supportsImageReferences: targetModel.image_references_supported,
      supportsVideoReferences: targetModel.video_references_supported,
      supportsAudioReferences: targetModel.audio_references_supported,
      maxReferenceImages: targetModel.image_references_max ?? undefined,
      maxReferenceVideos: targetModel.video_references_max ?? undefined,
      maxVideoRefDuration:
        targetModel.video_references_max_total_duration_seconds ?? undefined,
      maxReferenceAudios: targetModel.audio_references_max ?? undefined,
      maxAudioRefDuration:
        targetModel.audio_references_max_total_duration_seconds ?? undefined,
    });
    const validation =
      images && videos && audios && endFrames
        ? validateRecreatedVideoReferences(
            {
              imageCount: images.length,
              hasEndFrame: endFrames.length > 0,
              videoDurations: videos.map((video) => video.duration),
              audioDurations: audios.map((audio) => audio.duration),
            },
            inputMode,
            {
              ...targetCapabilities,
              requiresStartFrame:
                targetModel.starting_keyframe_required === true,
            },
          )
        : "invalid-video-duration";
    if (validation !== "valid") {
      const store = useCreateVideoStore.getState();
      if (store.pendingRecreate !== payload) return;
      store.setPendingRecreate(null);
      toast.error(
        validation === "invalid-video-duration" ||
          validation === "invalid-audio-duration"
          ? "Recreate references contain an unreadable duration or media token"
          : "Recreate references are incompatible with this model",
      );
      return;
    }

    const targetReferenceMode = inputMode === "reference";
    const targetDurationCapabilities = {
      durationOptions: targetModel.duration_seconds_options ?? undefined,
      minDuration: targetModel.duration_seconds_min ?? undefined,
      maxDuration: targetModel.duration_seconds_max ?? undefined,
      maxDurationWithImageReferences:
        targetModel.duration_seconds_max_with_image_references ?? undefined,
      defaultDuration: targetModel.duration_seconds_default ?? undefined,
    };
    const targetDuration = resolveVideoDuration(
      targetDurationCapabilities,
      payload.durationSeconds,
      {
        imageCount: images!.length,
        hasEndFrameImage: !targetReferenceMode && endFrames!.length > 0,
        videoCount: videos!.length,
        audioCount: audios!.length,
      },
    );
    if (
      targetDuration === null &&
      hasVideoDurationConfiguration(targetDurationCapabilities)
    ) {
      const store = useCreateVideoStore.getState();
      if (store.pendingRecreate !== payload) return;
      store.setPendingRecreate(null);
      toast.error("Recreate has no valid duration for this model");
      return;
    }

    useCreateVideoStore.getState().commitPendingRecreate(
      payload,
      {
        selectedModelId: targetModel.model,
        prompt: payload.prompt,
        selectedSize:
          resolveTargetModelOption(
            payload.aspectRatio,
            targetModel.aspect_ratio_options,
            targetModel.aspect_ratio_default,
          ) ?? "wide_sixteen_by_nine",
        duration: targetDuration,
        resolution:
          resolveTargetModelOption(
            payload.resolution,
            targetModel.resolution_options,
            targetModel.resolution_default,
          ) ?? null,
        bitrate:
          resolveTargetModelOption(
            payload.bitrate,
            targetModel.bitrate_options,
            targetModel.bitrate_default,
          ) ?? null,
        generateWithSound:
          targetModel.show_generate_with_sound_toggle === true
            ? (payload.generateWithSound ?? false)
            : false,
        inputMode,
        numVideos: resolveTargetModelCount(
          payload.generationCount,
          targetModel.batch_size_options,
          targetModel.batch_size_min,
          targetModel.batch_size_max,
          targetModel.batch_size_default,
        ),
      },
      {
        referenceImages: images!,
        endFrameImage: endFrames![0],
        referenceVideos: videos!,
        referenceAudios: audios!,
      },
    );
  }, [pendingRecreate, apiModels]);

  useEffect(() => {
    const cleanups = pollingCleanupsRef.current;
    const pendingBatches = useCreateVideoStore
      .getState()
      .batches.filter((b) => b.status === "pending" && b.jobToken);

    for (const batch of pendingBatches) {
      if (cleanups.has(batch.id)) continue;
      const stop = startVideoPolling(
        batch.jobToken!,
        (video) => {
          completeBatch(batch.id, video);
          cleanups.delete(batch.id);
          window.dispatchEvent(new Event("task-queue-update"));
        },
        (reason) => {
          failBatch(batch.id, reason);
          cleanups.delete(batch.id);
          window.dispatchEvent(new Event("task-queue-update"));
        },
      );
      cleanups.set(batch.id, stop);
    }

    return () => {
      cleanups.forEach((stop) => stop());
      cleanups.clear();
    };
  }, [completeBatch, failBatch]);

  // ── Handlers ─────────────────────────────────────────────────────────────

  const handleModelChange = useCallback(
    (item: PopoverItem) => {
      const model = item.action ? _modelLookup.get(item.action) : undefined;
      if (!model) return;
      const currentState = useCreateVideoStore.getState().ui;
      const nextDuration = resolveDurationForModel(
        model,
        currentState.duration,
      );

      const newSupportsKeyframe =
        !!model.starting_keyframe_supported ||
        !!model.starting_keyframe_required;
      const newSupportsRefs =
        !!model.image_references_supported ||
        !!model.video_references_supported ||
        !!model.audio_references_supported;

      const nextInputMode =
        currentState.inputMode === "reference" && newSupportsRefs
          ? "reference"
          : "keyframe";

      setUi({
        selectedModelId: model.model,
        selectedSize: model.aspect_ratio_default ?? "wide_sixteen_by_nine",
        duration: nextDuration,
        resolution: model.resolution_default ?? null,
        generateWithSound: false,
        inputMode: nextInputMode,
        numVideos: Math.min(
          model.batch_size_max ?? 4,
          model.batch_size_default ?? 1,
        ),
      });

      // Only clear media that the new model can't use in any mode.
      if (!newSupportsKeyframe && !model.image_references_supported) {
        setReferenceImages([]);
      }
      if (!model.ending_keyframe_supported) {
        setEndFrameImage(undefined);
      }
      if (!model.video_references_supported) {
        setReferenceVideos([]);
      }
      if (!model.audio_references_supported) {
        setReferenceAudios([]);
      }
    },
    [setUi],
  );

  const handleSizeChange = useCallback(
    (item: PopoverItem) => {
      if (item.action) setSelectedSize(item.action);
    },
    [setSelectedSize],
  );

  const handleResolutionChange = useCallback(
    (item: PopoverItem) =>
      setResolution(LABEL_TO_RES[item.label] ?? item.label),
    [setResolution],
  );

  const handleBitrateChange = useCallback(
    (item: PopoverItem) =>
      setBitrate(LABEL_TO_BITRATE[item.label] ?? item.label),
    [setBitrate],
  );

  const handleInputModeChange = useCallback(
    (item: PopoverItem) => {
      const mode = item.label === "Reference" ? "reference" : "keyframe";
      if (mode === inputMode) return;
      setUi({ inputMode: mode });
      if (mode === "reference") {
        setEndFrameImage(undefined);
      } else {
        setReferenceVideos([]);
        setReferenceAudios([]);
      }
    },
    [inputMode, setUi],
  );

  const imagePickerMax = Math.max(
    1,
    (isReferenceMode ? maxReferenceImages : 1) - referenceImages.length,
  );

  const handlePickerSelect = useCallback(
    (id: string) => {
      setPickerSelectedIds((prev) => {
        if (prev.includes(id)) return prev.filter((x) => x !== id);
        if (prev.length >= imagePickerMax) {
          return imagePickerMax === 1 ? [id] : prev;
        }
        return [...prev, id];
      });
    },
    [imagePickerMax],
  );

  const handleEndFramePickerSelect = useCallback((id: string) => {
    setEndFramePickerSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      // Single-select: auto-swap
      return [id];
    });
  }, []);

  const handleLibraryImageSelect = useCallback(
    (items: GalleryItem[]) => {
      const maxImages = isReferenceMode ? maxReferenceImages : 1;
      const availableSlots = Math.max(0, maxImages - referenceImages.length);
      const newImages: RefImage[] = items
        .slice(0, availableSlots)
        .map((item) => ({
          id: Math.random().toString(36).substring(7),
          url: item.thumbnail || item.fullImage || "",
          mediaToken: item.id,
        }));
      setReferenceImages([...referenceImages, ...newImages]);
      setIsImagePickerOpen(false);
    },
    [referenceImages, isReferenceMode, selectedModel],
  );

  const handleEndFrameLibrarySelect = useCallback((items: GalleryItem[]) => {
    const item = items[0];
    if (!item) return;
    setEndFrameImage({
      id: Math.random().toString(36).substring(7),
      url: item.thumbnail || item.fullImage || "",
      mediaToken: item.id,
    });
    setIsEndFramePickerOpen(false);
  }, []);

  // Each picker only greys out tokens already in its own slot, so the same
  // media file can't be added twice to one field. Reusing an image across
  // slots (e.g. the same image as start AND end frame) stays allowed.
  const usedImageTokens = useMemo(
    () =>
      referenceImages
        .map((img) => img.mediaToken)
        .filter((t): t is string => !!t),
    [referenceImages],
  );

  const usedEndFrameTokens = useMemo(
    () => (endFrameImage?.mediaToken ? [endFrameImage.mediaToken] : []),
    [endFrameImage],
  );

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || isGeneratingRef.current) {
      console.log("[generate-video] blocked", {
        hasPrompt: !!prompt.trim(),
        isGenerating: isGeneratingRef.current,
      });
      return;
    }
    if (needsImage) {
      toast.error(
        "Add a starting frame: this model can't generate from text alone.",
      );
      return;
    }
    if (!selectedModel) {
      // Models come from an API fetch; without one the submit would be a
      // silent no-op, which reads as a dead button.
      toast.error("Models are still loading. Try again in a moment.");
      return;
    }
    if (maxPromptLength !== undefined && prompt.length > maxPromptLength) {
      toast.error(
        `Prompt exceeds the ${maxPromptLength} character limit for this model`,
      );
      return;
    }
    const sentMedia = projectVideoReferenceMedia(
      {
        startFrame: selectedModel.starting_keyframe_supported,
        endFrame: selectedModel.ending_keyframe_supported,
        requiresImage: selectedModel.starting_keyframe_required,
        supportsImageReferences: selectedModel.image_references_supported,
        supportsVideoReferences: selectedModel.video_references_supported,
        supportsAudioReferences: selectedModel.audio_references_supported,
        maxReferenceImages: selectedModel.image_references_max ?? undefined,
        maxReferenceVideos: selectedModel.video_references_max ?? undefined,
        maxVideoRefDuration:
          selectedModel.video_references_max_total_duration_seconds ??
          undefined,
        maxReferenceAudios: selectedModel.audio_references_max ?? undefined,
        maxAudioRefDuration:
          selectedModel.audio_references_max_total_duration_seconds ??
          undefined,
      },
      {
        inputMode,
        referenceImages,
        endFrameImage,
        referenceVideos,
        referenceAudios,
      },
    );
    const requestIsReferenceMode = sentMedia.inputMode === "reference";
    const submittedImages = prepareMediaReferencesForSubmission(
      sentMedia.referenceImages,
    );
    const submittedVideos = prepareMediaReferencesForSubmission(
      sentMedia.referenceVideos,
    );
    const submittedAudios = prepareMediaReferencesForSubmission(
      sentMedia.referenceAudios,
    );
    const submittedEndFrames = prepareMediaReferencesForSubmission(
      sentMedia.endFrameImage ? [sentMedia.endFrameImage] : [],
    );
    if (
      !submittedImages ||
      !submittedVideos ||
      !submittedAudios ||
      !submittedEndFrames
    ) {
      toast.error("Every reference must finish uploading before generation");
      return;
    }
    const referenceStatus = validateRecreatedVideoReferences(
      {
        imageCount: submittedImages.length,
        hasEndFrame: submittedEndFrames.length > 0,
        videoDurations: submittedVideos.map((video) => video.duration),
        audioDurations: submittedAudios.map((audio) => audio.duration),
      },
      requestIsReferenceMode ? "reference" : "keyframe",
      {
        ...referenceCapabilities,
        requiresStartFrame: selectedModel.starting_keyframe_required === true,
      },
    );
    if (referenceStatus !== "valid") {
      toast.error(
        referenceStatus === "invalid-video-duration" ||
          referenceStatus === "invalid-audio-duration"
          ? "Could not verify every reference duration. Remove the unreadable reference and try again."
          : "Reference media exceeds or conflicts with this model's capabilities.",
      );
      return;
    }
    const requestDuration = durationCapabilities
      ? resolveVideoDuration(durationCapabilities, duration, {
          imageCount: submittedImages.length,
          hasEndFrameImage:
            !requestIsReferenceMode && submittedEndFrames.length > 0,
          videoCount: submittedVideos.length,
          audioCount: submittedAudios.length,
        })
      : effectiveDuration;
    if (
      requestDuration === null &&
      durationCapabilities &&
      hasVideoDurationConfiguration(durationCapabilities)
    ) {
      toast.error(
        "This model has no valid duration for the attached reference media",
      );
      return;
    }
    console.log("[generate-video] starting", {
      model: selectedModel.model,
      numVideos,
      inputMode,
      isReferenceMode: requestIsReferenceMode,
    });
    const startFrameToken =
      !requestIsReferenceMode &&
      supportsImagePrompts &&
      submittedImages.length > 0
        ? submittedImages[0].mediaToken
        : undefined;
    const endFrameToken =
      !requestIsReferenceMode &&
      hasEndFrame &&
      submittedEndFrames[0]?.mediaToken
        ? submittedEndFrames[0].mediaToken
        : undefined;
    const referenceImageTokens =
      requestIsReferenceMode && submittedImages.length > 0
        ? submittedImages.map((image) => image.mediaToken!)
        : undefined;
    const referenceVideoTokens =
      requestIsReferenceMode && submittedVideos.length > 0
        ? submittedVideos.map((video) => video.mediaToken!)
        : undefined;
    const referenceAudioTokens =
      requestIsReferenceMode && submittedAudios.length > 0
        ? submittedAudios.map((audio) => audio.mediaToken!)
        : undefined;

    // Extract character tokens from @-mentions in the prompt. Match longest
    // names first and require a non-word boundary after so `@Bob` doesn't
    // false-match inside `@Bobby`, and only pick up characters that still
    // exist in the current store (stale names are ignored).
    const mentionedCharacters = (() => {
      if (activeCharacters.length === 0) return [];
      const sorted = [...activeCharacters].sort(
        (a, b) => b.name.length - a.name.length,
      );
      const matched = new Set<string>();
      for (const c of sorted) {
        const escaped = c.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(`@${escaped}(?![\\w])`);
        if (regex.test(prompt)) matched.add(c.character_token);
      }
      return activeCharacters.filter((c) => matched.has(c.character_token));
    })();
    const referenceCharacterTokens =
      mentionedCharacters.length > 0
        ? mentionedCharacters.map((c) => c.character_token)
        : undefined;

    const baseParams = {
      prompt: prompt.trim(),
      model: selectedModel.model,
      numVideos,
      aspectRatio: selectedSize,
      duration: requestDuration ?? effectiveDuration,
      resolution: hasResolutionOptions
        ? (resolution ?? selectedModel.resolution_default ?? undefined)
        : undefined,
      bitrate: hasBitrateOptions
        ? (bitrate ?? selectedModel.bitrate_default ?? undefined)
        : undefined,
      generateAudio: hasSound ? generateWithSound : undefined,
      startFrameImageMediaToken: startFrameToken?.length
        ? startFrameToken
        : undefined,
      endFrameImageMediaToken: endFrameToken?.length
        ? endFrameToken
        : undefined,
      referenceImageMediaTokens: referenceImageTokens?.length
        ? referenceImageTokens
        : undefined,
      referenceVideoMediaTokens: referenceVideoTokens?.length
        ? referenceVideoTokens
        : undefined,
      referenceAudioMediaTokens: referenceAudioTokens?.length
        ? referenceAudioTokens
        : undefined,
      referenceCharacterTokens,
    };
    console.log("[generate-video] params", baseParams);

    isGeneratingRef.current = true;
    setIsGenerating(true);

    const modelLabel = selectedModel.full_name ?? selectedModel.model;
    const batchId = startBatch(
      prompt,
      modelLabel,
      numVideos > 1 ? numVideos : undefined,
    );

    try {
      console.log("[generate-video] enqueueing job...");
      const result = await enqueueVideoGeneration(baseParams);
      console.log("[generate-video] enqueue result", result);

      if (!result.success || !result.jobToken) {
        console.warn("[generate-video] enqueue failed", result.error);
        // Always toast: batches that fail at enqueue never got a job token,
        // so the gallery's failed-card rendering never shows them, and a
        // silent failBatch here looks like the button did nothing.
        if (result.errorCode === 402) {
          toast.error("You're out of credits. Top up to keep generating.");
        } else {
          toast.error(result.error ?? "Failed to start generation");
        }
        failBatch(batchId, result.error ?? "Failed to start generation");
      } else {
        setBatchJobToken(batchId, result.jobToken);
        console.log("[generate-video] polling started", {
          jobToken: result.jobToken,
        });

        const stopPolling = startVideoPolling(
          result.jobToken,
          (video) => {
            console.log("[generate-video] complete", {
              batchId,
              media_token: video.media_token,
            });
            completeBatch(batchId, video);
            pollingCleanupsRef.current.delete(batchId);
            window.dispatchEvent(new Event("task-queue-update"));
          },
          (reason) => {
            console.warn("[generate-video] poll failed", { batchId, reason });
            failBatch(batchId, reason);
            pollingCleanupsRef.current.delete(batchId);
            window.dispatchEvent(new Event("task-queue-update"));
          },
        );
        pollingCleanupsRef.current.set(batchId, stopPolling);
      }
    } catch (err) {
      console.error("[generate-video] unexpected error", err);
      toast.error("Network error - please try again");
      failBatch(batchId, "Network error - please try again");
    }

    window.dispatchEvent(new Event("credits-change"));
    window.dispatchEvent(new Event("task-queue-update"));
    console.log("[generate-video] done enqueuing");
    setIsGenerating(false);
    isGeneratingRef.current = false;
  }, [
    prompt,
    needsImage,
    isReferenceMode,
    selectedModel,
    maxPromptLength,
    selectedSize,
    numVideos,
    duration,
    resolution,
    bitrate,
    generateWithSound,
    hasResolutionOptions,
    hasBitrateOptions,
    hasSound,
    supportsImagePrompts,
    hasEndFrame,
    referenceImages,
    endFrameImage,
    referenceVideos,
    referenceAudios,
    referenceCapabilities,
    durationCapabilities,
    effectiveDuration,
    activeCharacters,
    startBatch,
    setBatchJobToken,
    completeBatch,
    failBatch,
  ]);

  // ── Render ────────────────────────────────────────────────────────────

  const videoGlowOrbs = (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="absolute left-1/2 top-[-10%] h-[700px] w-[700px] -translate-x-1/2 rounded-full bg-gradient-to-br from-blue-700 via-blue-500 to-[#00AABA] opacity-[0.12] blur-[120px] transform-gpu" />
      <div className="absolute bottom-[-15%] left-[-10%] h-[500px] w-[500px] rounded-full bg-gradient-to-br from-[#00AABA] via-blue-500 to-purple-600 opacity-[0.08] blur-[120px] transform-gpu" />
      <div className="absolute bottom-[10%] right-[-10%] h-[400px] w-[400px] rounded-full bg-gradient-to-br from-blue-600 to-pink-500 opacity-[0.06] blur-[140px] transform-gpu" />
    </div>
  );

  return (
    <CreateMediaPageShell
      title="Create Video - ArtCraft"
      description="Generate stunning AI videos with ArtCraft"
      authChecked={authChecked}
      isLoggedIn={!!user}
      heroIcon={FilmIcon}
      heroTitle="Create Video"
      heroSubtitle="Sign in to generate stunning AI videos with multiple models"
      hasContent={hasContent}
      emptyStateTitle="Generate Video"
      emptyStateSubtitle="Add a prompt, then generate"
      bottomOffset={promptHeight + 24}
      modelItems={modelItems}
      onModelChange={handleModelChange}
      glowOrbs={videoGlowOrbs}
      gridContent={
        <GenerationGalleryGrid
          inProgressJobs={enrichedInProgress}
          failedJobs={jobs.failed}
          onDismissFailed={jobs.dismissFailed}
          newlyCompletedItems={jobs.newlyCompleted}
          galleryItems={gallery.items}
          newlyCompletedTokens={newlyCompletedTokens}
          hasMore={gallery.hasMore}
          isLoading={gallery.isLoading}
          isInitialLoading={gallery.isInitialLoading}
          onLoadMore={gallery.loadMore}
          onGalleryItemClick={lightbox.handleGalleryItemClick}
        />
      }
      promptBox={
        <div
          ref={promptBoxRef}
          className="animate-fade-in-up fixed bottom-2 sm:bottom-3 left-0 right-0 z-30 mx-auto w-full max-w-[900px] px-2 sm:px-4"
          style={{ animationDelay: "150ms" }}
        >
          {/* {selectedModel?.model === "seedance_2p0" && (
            <div className="mb-2 flex items-start gap-2.5 rounded-lg border border-yellow-500/40 px-3.5 py-2.5 text-xs text-yellow-200 shadow-lg backdrop-blur-xl bg-yellow-800/60">
              <TriangleAlertIcon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-yellow-400" />
              <span>
                Seedance 2.0 is in Early Alpha. Generations may be slow and may experience outages.
                Seedance may reject safe inputs unexpectedly. Try several short generations before longer ones.
              </span>
            </div>
          )} */}
          <AppDownloadCta />
          <PromptBox
            prompt={prompt}
            onPromptChange={setPrompt}
            onSubmit={handleGenerate}
            isSubmitting={isGenerating}
            credits={estimatedCredits}
            maxPromptLength={maxPromptLength}
            placeholder="Describe the video you want to generate..."
            supportsImagePrompts={supportsImagePrompts}
            supportsStartFrame={referenceCapabilities.supportsStartFrame}
            maxImagePromptCount={isReferenceMode ? maxReferenceImages : 1}
            referenceImages={referenceImages}
            onReferenceImagesChange={setReferenceImages}
            isVideo
            isReferenceMode={isReferenceMode}
            referenceOperationKey={`${selectedModel?.model ?? ""}:${isReferenceMode}`}
            endFrameImage={endFrameImage}
            onEndFrameImageChange={setEndFrameImage}
            onReferenceFramesChange={setReferenceFrames}
            showEndFrameSection={hasEndFrame}
            onPickFromLibrary={
              supportsImagePrompts
                ? () => setIsImagePickerOpen(true)
                : undefined
            }
            onPickEndFrameFromLibrary={
              hasEndFrame ? () => setIsEndFramePickerOpen(true) : undefined
            }
            modelSelector={
              <Tooltip
                content="Model"
                position="top"
                className="z-50"
                closeOnClick
              >
                <PopoverMenu
                  items={modelItems}
                  onSelect={handleModelChange}
                  mode="toggle"
                  panelTitle="Select Model"
                  showIconsInList
                  triggerIcon={
                    <img
                      src={getCreatorIconPathForModelId(
                        selectedModel?.model ?? "",
                      )}
                      alt=""
                      className="h-4 w-4 icon-auto-contrast"
                    />
                  }
                />
              </Tooltip>
            }
            onClearAllRefs={() =>
              setRefs({
                referenceImages: [],
                endFrameImage: undefined,
                referenceVideos: [],
                referenceAudios: [],
              })
            }
            mentionItems={mentionItems.length > 0 ? mentionItems : undefined}
            videoRefsSupported={referenceCapabilities.canUseVideoReferences}
            referenceVideos={referenceVideos}
            onReferenceVideosChange={setReferenceVideos}
            maxVideoCount={maxVideoRefs}
            maxVideoRefDuration={referenceCapabilities.maxVideoRefDuration}
            audioRefsSupported={referenceCapabilities.canUseAudioReferences}
            referenceAudios={referenceAudios}
            onReferenceAudiosChange={setReferenceAudios}
            maxAudioCount={maxAudioRefs}
            maxAudioRefDuration={referenceCapabilities.maxAudioRefDuration}
            rightToolbar={
              <GenerationCountPicker
                batchSizeMax={selectedModel?.batch_size_max ?? 4}
                batchSizeOptions={selectedModel?.batch_size_options}
                currentCount={numVideos}
                handleCountChange={setNumVideos}
                panelTitle="No. of videos"
              />
            }
            leftToolbar={
              <>
                {hasSizeOptions && (
                  <Tooltip
                    content="Aspect Ratio"
                    position="top"
                    className="z-50"
                    closeOnClick
                  >
                    <PopoverMenu
                      items={sizeItems}
                      onSelect={handleSizeChange}
                      mode="toggle"
                      panelTitle="Aspect Ratio"
                      showIconsInList
                      triggerIcon={
                        AUTO_RATIOS.has(selectedSize) ? (
                          <AutoIcon />
                        ) : (
                          <AspectRatioIcon commonAspectRatio={selectedSize} />
                        )
                      }
                    />
                  </Tooltip>
                )}
                {resolutionItems && (
                  <Tooltip
                    content="Resolution"
                    position="top"
                    className="z-50"
                    closeOnClick
                  >
                    <PopoverMenu
                      items={resolutionItems}
                      onSelect={handleResolutionChange}
                      mode="toggle"
                      panelTitle="Resolution"
                    />
                  </Tooltip>
                )}
                {bitrateItems && (
                  <Tooltip
                    content="Bitrate"
                    position="top"
                    className="z-50"
                    closeOnClick
                  >
                    <PopoverMenu
                      items={bitrateItems}
                      onSelect={handleBitrateChange}
                      mode="toggle"
                      panelTitle="Bitrate"
                    />
                  </Tooltip>
                )}
                {durationRange && (
                  <Tooltip content="Duration" position="top" className="z-50">
                    <PopoverMenu
                      mode="default"
                      panelTitle="Duration"
                      triggerIcon={
                        <ClockIcon
                          
                          className="h-3.5 w-3.5" />
                      }
                      triggerLabel={`${effectiveDuration}s`}
                    >
                      <div className="w-[min(16rem,calc(100vw-2rem))] pb-0.5">
                        <div className="flex items-center gap-2.5">
                          <div className="flex-1">
                            <SliderV2
                              min={durationRange.min}
                              max={durationRange.max}
                              value={localDuration}
                              onChange={handleDurationSlide}
                              step={1}
                              suffix="s"
                              variant="filled"
                            />
                          </div>
                          <span className="text-base-fg min-w-6 shrink-0 text-sm font-medium tabular-nums">
                            {localDuration}s
                          </span>
                        </div>
                        <div className="text-base-fg/40 mt-1.5 flex justify-between px-0.5 text-[11px] tabular-nums">
                          <span>{durationRange.min}s</span>
                          <span>{durationRange.max}s</span>
                        </div>
                      </div>
                    </PopoverMenu>
                  </Tooltip>
                )}
                {hasSound && (
                  <Tooltip
                    content={generateWithSound ? "Sound: ON" : "Sound: OFF"}
                    position="top"
                    className="z-50"
                    delay={200}
                  >
                    <ToggleButton
                      isActive={generateWithSound}
                      icon={AudioLinesIcon}
                      activeIcon={AudioLinesIcon}
                      onClick={() =>
                        setUi({ generateWithSound: !generateWithSound })
                      }
                      className={
                        generateWithSound
                          ? "bg-primary/40 hover:bg-primary/50 border-primary/30"
                          : undefined
                      }
                    />
                  </Tooltip>
                )}
                {inputModeItems && (
                  <Tooltip
                    content="Input Mode"
                    position="top"
                    className="z-50"
                    closeOnClick
                  >
                    <PopoverMenu
                      items={inputModeItems}
                      onSelect={handleInputModeChange}
                      mode="toggle"
                      panelTitle="Input Mode"
                    />
                  </Tooltip>
                )}
                {supportsCharacters && (
                  <button
                    type="button"
                    onClick={() => setIsCharactersModalOpen(true)}
                    className="flex h-9 items-center justify-center gap-1 rounded-lg border border-ui-controls-border bg-ui-controls px-3 text-sm font-medium text-base-fg shadow-sm transition-all duration-150 hover:bg-ui-controls/80 active:scale-95"
                  >
                    @Characters
                  </button>
                )}
              </>
            }
          />
        </div>
      }
      modals={
        <>
          <GalleryModal
            mode="select"
            isOpen={isImagePickerOpen}
            onClose={() => setIsImagePickerOpen(false)}
            selectedItemIds={pickerSelectedIds}
            disabledItemIds={usedImageTokens}
            onSelectItem={handlePickerSelect}
            maxSelections={imagePickerMax}
            onUseSelected={handleLibraryImageSelect}
            forceFilter="image"
            hideFilter
          />
          <GalleryModal
            mode="select"
            isOpen={isEndFramePickerOpen}
            onClose={() => setIsEndFramePickerOpen(false)}
            selectedItemIds={endFramePickerSelectedIds}
            disabledItemIds={usedEndFrameTokens}
            onSelectItem={handleEndFramePickerSelect}
            maxSelections={1}
            onUseSelected={handleEndFrameLibrarySelect}
            forceFilter="image"
            hideFilter
          />
          <CharactersModal
            isOpen={isCharactersModalOpen}
            onClose={() => setIsCharactersModalOpen(false)}
            onSelectCharacter={(character) => {
              const mention = `@${character.name}`;
              const spaceBefore =
                prompt.length > 0 && !prompt.endsWith(" ") ? " " : "";
              setPrompt(prompt + spaceBefore + mention + " ");
              setIsCharactersModalOpen(false);
            }}
          />
          <Lightbox
            isOpen={lightbox.lightboxOpen}
            onClose={lightbox.closeLightbox}
            mediaToken={lightbox.lightboxItem?.id}
            cdnUrl={lightbox.lightboxItem?.fullImage}
            mediaClass={lightbox.lightboxItem?.mediaClass}
            batchImageToken={lightbox.lightboxItem?.batchImageToken}
            showBatchCarousel={false}
            onNavigatePrev={lightbox.navigatePrev}
            onNavigateNext={lightbox.navigateNext}
            onDeleted={gallery.removeItem}
          />
        </>
      }
    />
  );
}
