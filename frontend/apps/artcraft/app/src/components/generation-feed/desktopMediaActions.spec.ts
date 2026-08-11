// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

vi.mock("react-hot-toast", () => ({
  default: { error: vi.fn(), success: vi.fn(), loading: vi.fn() },
}));
vi.mock("@storyteller/api", () => ({
  FilterMediaClasses: { DIMENSIONAL: "dimensional" },
  MediaFilesApi: class {},
  PromptsApi: class {},
  downloadUrlToPath: vi.fn(),
  pickDownloadDirectory: vi.fn(),
  promptDownloadLocationIfNeeded: vi.fn(),
}));
vi.mock("@storyteller/tauri-api", () => ({
  DownloadUrl: vi.fn(),
  useModelsStore: { getState: vi.fn() },
}));
vi.mock("@storyteller/ui-promptbox", () => ({
  usePromptImageStore: { getState: vi.fn() },
  usePromptVideoStore: { getState: vi.fn() },
}));
vi.mock("@storyteller/ui-model-selector", () => ({
  ModelPage: { ImageToVideo: "video", TextToImage: "image" },
  useClassyModelSelectorStore: { getState: vi.fn() },
}));
vi.mock("@storyteller/ui-gallery-modal", () => ({
  galleryModalLightboxVisible: { value: false },
  galleryModalVisibleDuringDrag: { value: false },
  galleryModalVisibleViewMode: { value: false },
}));
vi.mock("@storyteller/ui-generation-list", () => ({
  getCachedPrompt: vi.fn(),
}));
vi.mock("@storyteller/common", async () => ({
  ...(await import("../../../../../../libs/common/src/lib/utils/media-duration.ts")),
  ...(await import("../../../../../../libs/common/src/lib/utils/media-reference-state.ts")),
  ...(await import("../../../../../../libs/common/src/lib/utils/model-setting.ts")),
}));
vi.mock("~/pages/Stores/TabState", () => ({
  useTabStore: { getState: vi.fn() },
}));

import {
  ImageModel,
  ModelCreator,
  SizeIconOption,
  VideoModel,
} from "@storyteller/model-list";
import { CommonBitrate } from "@storyteller/api-enums";
import { usePromptVideoStore } from "@storyteller/ui-promptbox";
import { useTabStore } from "~/pages/Stores/TabState";
import {
  applyMakeVideoFromImage,
  buildDesktopRecreateTransaction,
} from "./desktopMediaActions";

const imageModel = () =>
  new ImageModel({
    id: "fallback-image",
    tauriId: "fallback-image",
    fullName: "Fallback image",
    category: "image",
    creator: ModelCreator.ArtCraft,
    selectorName: "Fallback image",
    selectorDescription: "",
    selectorBadges: [],
    maxGenerationCount: 4,
    defaultGenerationCount: 1,
    predefinedGenerationCounts: [1, 2, 4],
    canUseImagePrompt: true,
    maxImagePromptCount: 2,
    canTextToImage: true,
  });

const videoModel = (
  overrides: Partial<ConstructorParameters<typeof VideoModel>[0]> = {},
) => {
  const model = new VideoModel({
    id: "fallback-video",
    tauriId: "fallback-video",
    fullName: "Fallback video",
    category: "video",
    creator: ModelCreator.ArtCraft,
    selectorName: "Fallback video",
    selectorDescription: "",
    selectorBadges: [],
    startFrame: false,
    endFrame: false,
    requiresImage: false,
    supportsVideoReferences: true,
    supportsAudioReferences: true,
    maxReferenceVideos: 2,
    maxVideoRefDuration: 20,
    maxReferenceAudios: 2,
    maxAudioRefDuration: 20,
    durationOptions: [5, 10],
    defaultDuration: 5,
    resolutionOptions: ["720p"],
    defaultResolution: "720p",
    sizeOptions: [
      {
        tauriValue: "wide_sixteen_by_nine",
        textLabel: "16:9",
        icon: SizeIconOption.Landscape16x9,
      },
    ],
    supportsCommonAspectRatio: true,
    minGenerationCount: 1,
    maxGenerationCount: 4,
    defaultGenerationCount: 1,
    predefinedGenerationCounts: [1, 2, 4],
    ...overrides,
  });
  return Object.assign(model, {
    minGenerationCount: overrides.minGenerationCount ?? 1,
    maxGenerationCount: overrides.maxGenerationCount ?? 4,
    defaultGenerationCount: overrides.defaultGenerationCount ?? 1,
    predefinedGenerationCounts: overrides.predefinedGenerationCounts ?? [
      1, 2, 4,
    ],
  });
};

const context = (semantic: string, mediaToken: string) => ({
  semantic,
  media_token: mediaToken,
  media_links: { cdn_url: `https://cdn/${mediaToken}` },
});

const prompt = (value: Record<string, unknown>) =>
  ({
    maybe_context_images: [],
    maybe_model_type: null,
    maybe_positive_prompt: null,
    maybe_aspect_ratio: null,
    maybe_resolution: null,
    maybe_batch_count: null,
    maybe_generate_audio: null,
    maybe_duration_seconds: null,
    maybe_generation_mode: null,
    maybe_bitrate: null,
    ...value,
  }) as Parameters<typeof buildDesktopRecreateTransaction>[0]["promptData"];

const hydration = {
  loadDurationMillis: async (token: string) =>
    token === "video" ? 5_401 : token === "audio" ? 3_201 : null,
  probeVideoDuration: async () => null,
  probeAudioDuration: async () => null,
};

describe("desktop Recreate transaction builder", () => {
  it("hydrates audio/video, dedupes per kind, and normalizes against the actual fallback", async () => {
    const transaction = await buildDesktopRecreateTransaction(
      {
        mediaClass: "video",
        promptData: prompt({
          maybe_model_type: "removed-model",
          maybe_positive_prompt: "restore me",
          maybe_context_images: [
            context("vid_ref", "video"),
            context("vid_ref", "video"),
            context("audioref", "audio"),
          ],
          maybe_duration_seconds: 7,
          maybe_resolution: "four_k",
          maybe_aspect_ratio: "unsupported",
          maybe_generate_audio: true,
          maybe_batch_count: 3,
        }),
      },
      { imageModels: [imageModel()], videoModels: [videoModel()] },
      hydration,
    );

    expect(transaction.mediaClass).toBe("video");
    if (transaction.mediaClass !== "video") throw new Error("unreachable");
    expect(transaction.usedModelFallback).toBe(true);
    expect(transaction.targetModel.tauriId).toBe("fallback-video");
    expect(transaction.state).toMatchObject({
      prompt: "restore me",
      inputMode: "reference",
      duration: 5,
      resolution: "720p",
      aspectRatio: "16:9",
      generateWithSound: false,
      generationCount: 2,
    });
    expect(transaction.state.referenceVideos).toHaveLength(1);
    expect(transaction.state.referenceVideos[0]).toMatchObject({
      mediaToken: "video",
      duration: 5.401,
    });
    expect(transaction.state.referenceAudios[0]).toMatchObject({
      mediaToken: "audio",
      duration: 3.201,
    });
    expect(transaction.state.referenceVideos[0]?.file).toBeUndefined();
    expect(transaction.state.referenceAudios[0]?.file).toBeUndefined();
  });

  it("preserves an independently supported end-only keyframe", async () => {
    const target = videoModel({
      endFrame: true,
      supportsVideoReferences: false,
      supportsAudioReferences: false,
    });
    const transaction = await buildDesktopRecreateTransaction(
      {
        mediaClass: "video",
        promptData: prompt({
          maybe_model_type: target.tauriId,
          maybe_context_images: [context("vid_end_frame", "end")],
        }),
      },
      { imageModels: [imageModel()], videoModels: [target] },
      hydration,
    );

    expect(transaction.mediaClass).toBe("video");
    if (transaction.mediaClass !== "video") throw new Error("unreachable");
    expect(transaction.state.inputMode).toBe("keyframe");
    expect(transaction.state.referenceImages).toEqual([]);
    expect(transaction.state.endFrameImage).toMatchObject({
      mediaToken: "end",
    });
  });

  it("uses the listed video aspect default when it is not the first option", async () => {
    const target = videoModel({
      sizeOptions: [
        {
          tauriValue: "wide_twenty_one_by_nine",
          textLabel: "21:9",
          icon: SizeIconOption.Landscape16x9,
        },
        {
          tauriValue: "wide_sixteen_by_nine",
          textLabel: "16:9",
          icon: SizeIconOption.Landscape16x9,
        },
      ],
      defaultAspectRatio: "wide_sixteen_by_nine",
    });
    const transaction = await buildDesktopRecreateTransaction(
      {
        mediaClass: "video",
        promptData: prompt({ maybe_model_type: target.tauriId }),
      },
      { imageModels: [imageModel()], videoModels: [target] },
      hydration,
    );

    expect(transaction.mediaClass).toBe("video");
    if (transaction.mediaClass !== "video") throw new Error("unreachable");
    expect(transaction.state.aspectRatio).toBe("16:9");
  });

  it("rejects partial timed hydration that would rebind a prompt mention", async () => {
    await expect(
      buildDesktopRecreateTransaction(
        {
          mediaClass: "video",
          promptData: prompt({
            maybe_positive_prompt: "Cut from @Video2",
            maybe_context_images: [
              context("vid_ref", "unreadable"),
              context("vid_ref", "video"),
            ],
          }),
        },
        { imageModels: [imageModel()], videoModels: [videoModel()] },
        hydration,
      ),
    ).rejects.toThrow("cannot preserve @Video2");
  });

  it("rejects server-filtered context before hydration can compact ordinals", async () => {
    await expect(
      buildDesktopRecreateTransaction(
        {
          mediaClass: "video",
          promptData: prompt({
            context_items_complete: false,
            maybe_context_images: [context("vid_ref", "video")],
          }),
        },
        { imageModels: [imageModel()], videoModels: [videoModel()] },
        hydration,
      ),
    ).rejects.toThrow("context is incomplete");
  });

  it("restores only a legal bitrate and otherwise commits the model fallback", async () => {
    const target = videoModel({
      bitrateOptions: [CommonBitrate.Normal, CommonBitrate.High],
      defaultBitrate: CommonBitrate.Normal,
    });
    const build = (maybeBitrate: string | null) =>
      buildDesktopRecreateTransaction(
        {
          mediaClass: "video",
          promptData: prompt({
            maybe_model_type: target.tauriId,
            maybe_bitrate: maybeBitrate,
          }),
        },
        { imageModels: [imageModel()], videoModels: [target] },
        hydration,
      );

    const restored = await build(CommonBitrate.High);
    const absent = await build(null);
    const invalid = await build("future_bitrate");
    const unsupported = await buildDesktopRecreateTransaction(
      {
        mediaClass: "video",
        promptData: prompt({
          maybe_model_type: "no-bitrate",
          maybe_bitrate: CommonBitrate.High,
        }),
      },
      {
        imageModels: [imageModel()],
        videoModels: [
          videoModel({
            id: "no-bitrate",
            tauriId: "no-bitrate",
            bitrateOptions: [],
          }),
        ],
      },
      hydration,
    );

    expect(restored.mediaClass).toBe("video");
    expect(absent.mediaClass).toBe("video");
    expect(invalid.mediaClass).toBe("video");
    expect(unsupported.mediaClass).toBe("video");
    if (
      restored.mediaClass !== "video" ||
      absent.mediaClass !== "video" ||
      invalid.mediaClass !== "video" ||
      unsupported.mediaClass !== "video"
    ) {
      throw new Error("unreachable");
    }
    expect(restored.state.bitrate).toBe(CommonBitrate.High);
    expect(absent.state.bitrate).toBe(CommonBitrate.Normal);
    expect(invalid.state.bitrate).toBe(CommonBitrate.Normal);
    expect(unsupported.state.bitrate).toBeNull();
  });

  it("preserves the current legal bitrate when making video from an image", async () => {
    const commitRecreate = vi.fn();
    vi.mocked(usePromptVideoStore.getState).mockReturnValue({
      resolution: "720p",
      aspectRatio: "16:9",
      bitrate: CommonBitrate.High,
      generateWithSound: false,
      duration: 5,
      generationCount: 2,
      commitRecreate,
    } as ReturnType<typeof usePromptVideoStore.getState>);
    vi.mocked(useTabStore.getState).mockReturnValue({
      setActiveTab: vi.fn(),
    } as ReturnType<typeof useTabStore.getState>);

    await applyMakeVideoFromImage("blob:frame", "frame-token");

    expect(commitRecreate).toHaveBeenCalledWith(
      expect.objectContaining({
        bitrate: CommonBitrate.High,
        referenceImages: [
          expect.objectContaining({ mediaToken: "frame-token" }),
        ],
      }),
    );
  });

  it("rejects raw video semantics in an image transaction before exclusion", async () => {
    const loadDurationMillis = vi.fn(async () => null);
    await expect(
      buildDesktopRecreateTransaction(
        {
          mediaClass: "image",
          promptData: prompt({
            maybe_context_images: [context("vid_ref", "unreadable")],
          }),
        },
        { imageModels: [imageModel()], videoModels: [videoModel()] },
        { ...hydration, loadDurationMillis },
      ),
    ).rejects.toThrow("non-image reference media");
    expect(loadDurationMillis).not.toHaveBeenCalled();
  });
});
