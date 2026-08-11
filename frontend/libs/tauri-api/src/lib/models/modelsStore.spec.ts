import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isDesktopImageCommandModel,
  isDesktopVideoCommandModel,
  useModelsStore,
} from "./modelsStore.js";

const modelListMocks = vi.hoisted(() => ({
  imageOverlay: [{ tauriId: "nano_banana_2" }, { tauriId: "seedream_5p0_pro" }],
  videoOverlay: [{ tauriId: "seedance_2p0" }, { tauriId: "switch_x" }],
  buildImageModelsFromListing: vi.fn(),
  buildVideoModelsFromListing: vi.fn(),
}));

const backendMocks = vi.hoisted(() => ({
  listImageModels: vi.fn(),
  listVideoModels: vi.fn(),
}));

vi.mock("@storyteller/model-list", () => ({
  ImageModel: class ImageModel {},
  VideoModel: class VideoModel {},
  IMAGE_MODELS: modelListMocks.imageOverlay,
  VIDEO_MODELS: modelListMocks.videoOverlay,
  buildImageModelsFromListing: modelListMocks.buildImageModelsFromListing,
  buildVideoModelsFromListing: modelListMocks.buildVideoModelsFromListing,
}));

vi.mock("../generate/models/image/ListImageModels.js", () => ({
  ListImageModels: backendMocks.listImageModels,
}));

vi.mock("../generate/models/video/ListVideoModels.js", () => ({
  ListVideoModels: backendMocks.listVideoModels,
}));

const response = (model: string) => ({
  payload: {
    success: true,
    models: [{ model }],
    providers: [{ provider: "test", models: [{ model }] }],
  },
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const supportedImageOverlay = [modelListMocks.imageOverlay[0]];
const supportedVideoOverlay = [modelListMocks.videoOverlay[0]];
const initialDesktopModels = {
  imageModels: useModelsStore.getState().imageModels,
  videoModels: useModelsStore.getState().videoModels,
};

describe("modelsStore.loadModelsFromBackend", () => {
  beforeEach(() => {
    backendMocks.listImageModels.mockReset();
    backendMocks.listVideoModels.mockReset();
    modelListMocks.buildImageModelsFromListing.mockReset();
    modelListMocks.buildVideoModelsFromListing.mockReset();

    modelListMocks.buildImageModelsFromListing.mockImplementation(
      (_overlay, models: Array<{ model: string }>) =>
        models.map(({ model }) => ({ tauriId: `built-${model}` })),
    );
    modelListMocks.buildVideoModelsFromListing.mockImplementation(
      (_overlay, models: Array<{ model: string }>) =>
        models.map(({ model }) => ({ tauriId: `built-${model}` })),
    );

    useModelsStore.setState({
      imageModels: supportedImageOverlay as never[],
      videoModels: supportedVideoOverlay as never[],
      loaded: false,
      isLoading: false,
    });

    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("filters unsupported models from the synchronous startup lists", () => {
    expect(initialDesktopModels).toEqual({
      imageModels: supportedImageOverlay,
      videoModels: supportedVideoOverlay,
    });
    expect(isDesktopImageCommandModel("seedream_5p0_pro")).toBe(false);
    expect(isDesktopVideoCommandModel("switch_x")).toBe(false);
  });

  it("keeps command-compatible fallback lists when both backend calls fail", async () => {
    backendMocks.listImageModels.mockRejectedValue(
      new Error("image unavailable"),
    );
    backendMocks.listVideoModels.mockRejectedValue(
      new Error("video unavailable"),
    );

    await useModelsStore.getState().loadModelsFromBackend();

    expect(modelListMocks.buildImageModelsFromListing).not.toHaveBeenCalled();
    expect(modelListMocks.buildVideoModelsFromListing).not.toHaveBeenCalled();
    expect(useModelsStore.getState()).toMatchObject({
      imageModels: supportedImageOverlay,
      videoModels: supportedVideoOverlay,
      loaded: true,
      isLoading: false,
    });
  });

  it("coalesces concurrent callers and publishes both model lists atomically", async () => {
    const image = deferred<ReturnType<typeof response>>();
    const video = deferred<ReturnType<typeof response>>();
    backendMocks.listImageModels.mockReturnValue(image.promise);
    backendMocks.listVideoModels.mockReturnValue(video.promise);

    const snapshots: Array<{
      imageModels: unknown[];
      videoModels: unknown[];
      loaded: boolean;
      isLoading: boolean;
    }> = [];
    const unsubscribe = useModelsStore.subscribe(
      (state: {
        imageModels: unknown[];
        videoModels: unknown[];
        loaded: boolean;
        isLoading: boolean;
      }) => {
        snapshots.push({
          imageModels: state.imageModels,
          videoModels: state.videoModels,
          loaded: state.loaded,
          isLoading: state.isLoading,
        });
      },
    );

    const first = useModelsStore.getState().loadModelsFromBackend();
    const second = useModelsStore.getState().loadModelsFromBackend();

    expect(first).toBe(second);
    expect(useModelsStore.getState().isLoading).toBe(true);
    expect(snapshots).toHaveLength(1);

    await vi.waitFor(() => {
      expect(backendMocks.listImageModels).toHaveBeenCalledTimes(1);
      expect(backendMocks.listVideoModels).toHaveBeenCalledTimes(1);
    });

    image.resolve(response("nano_banana_2"));
    await Promise.resolve();

    expect(useModelsStore.getState()).toMatchObject({
      imageModels: supportedImageOverlay,
      videoModels: supportedVideoOverlay,
      loaded: false,
      isLoading: true,
    });
    expect(snapshots).toHaveLength(1);

    video.resolve(response("seedance_2p0"));
    await Promise.all([first, second]);
    unsubscribe();

    expect(modelListMocks.buildImageModelsFromListing).toHaveBeenCalledWith(
      supportedImageOverlay,
      [{ model: "nano_banana_2" }],
      ["nano_banana_2"],
    );
    expect(modelListMocks.buildVideoModelsFromListing).toHaveBeenCalledWith(
      supportedVideoOverlay,
      [{ model: "seedance_2p0" }],
      ["seedance_2p0"],
    );
    expect(useModelsStore.getState()).toMatchObject({
      imageModels: [{ tauriId: "built-nano_banana_2" }],
      videoModels: [{ tauriId: "built-seedance_2p0" }],
      loaded: true,
      isLoading: false,
    });
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1]).toMatchObject({ loaded: true, isLoading: false });
  });

  it("keeps the last-known-good family when only one backend call succeeds", async () => {
    backendMocks.listImageModels.mockRejectedValue(
      new Error("image unavailable"),
    );
    backendMocks.listVideoModels.mockResolvedValue(response("seedance_2p0"));

    await useModelsStore.getState().loadModelsFromBackend();

    expect(modelListMocks.buildImageModelsFromListing).not.toHaveBeenCalled();
    expect(useModelsStore.getState()).toMatchObject({
      imageModels: supportedImageOverlay,
      videoModels: [{ tauriId: "built-seedance_2p0" }],
      loaded: true,
      isLoading: false,
    });
  });

  it("clears the in-flight request after completion so a later call can retry", async () => {
    backendMocks.listImageModels.mockResolvedValue(response("nano_banana_2"));
    backendMocks.listVideoModels.mockResolvedValue(response("seedance_2p0"));

    await useModelsStore.getState().loadModelsFromBackend();
    await useModelsStore.getState().loadModelsFromBackend();

    expect(backendMocks.listImageModels).toHaveBeenCalledTimes(2);
    expect(backendMocks.listVideoModels).toHaveBeenCalledTimes(2);
  });

  it("filters forward-listed video models that the desktop command cannot deserialize", async () => {
    backendMocks.listImageModels.mockResolvedValue(response("nano_banana_2"));
    backendMocks.listVideoModels.mockResolvedValue({
      payload: {
        success: true,
        models: [
          { model: "seedance_2p0" },
          { model: "veo_3p1_lite" },
          { model: "vidu_q3_turbo" },
        ],
        providers: [
          {
            provider: "test",
            models: [
              { model: "seedance_2p0" },
              { model: "veo_3p1_lite" },
              { model: "vidu_q3_turbo" },
            ],
          },
        ],
      },
    });

    await useModelsStore.getState().loadModelsFromBackend();

    expect(modelListMocks.buildVideoModelsFromListing).toHaveBeenCalledWith(
      supportedVideoOverlay,
      [{ model: "seedance_2p0" }],
      ["seedance_2p0"],
    );
    expect(isDesktopVideoCommandModel("seedance_2p0")).toBe(true);
    expect(isDesktopVideoCommandModel("veo_3p1_lite")).toBe(false);
  });

  it("filters forward-listed image models that the desktop command cannot deserialize", async () => {
    backendMocks.listImageModels.mockResolvedValue({
      payload: {
        success: true,
        models: [
          { model: "nano_banana_2" },
          { model: "seedream_5p0_pro" },
          { model: "seedream_5p0_pro_ultra" },
        ],
        providers: [
          {
            provider: "test",
            models: [
              { model: "nano_banana_2" },
              { model: "seedream_5p0_pro" },
              { model: "seedream_5p0_pro_ultra" },
            ],
          },
        ],
      },
    });
    backendMocks.listVideoModels.mockResolvedValue(response("seedance_2p0"));

    await useModelsStore.getState().loadModelsFromBackend();

    expect(modelListMocks.buildImageModelsFromListing).toHaveBeenCalledWith(
      supportedImageOverlay,
      [{ model: "nano_banana_2" }],
      ["nano_banana_2"],
    );
    expect(isDesktopImageCommandModel("nano_banana_2")).toBe(true);
    expect(isDesktopImageCommandModel("flux_pro_1p1_ultra")).toBe(true);
    expect(isDesktopImageCommandModel("seedream_5p0_pro")).toBe(false);
  });
});
