// Shared model store: the single source of truth for the model dropdowns.
//
// Seeded synchronously from the frontend OVERLAY (`IMAGE_MODELS` / `VIDEO_MODELS`
// in `@storyteller/model-list`) so the UI is never empty. On app boot,
// `loadModelsFromBackend()` fetches the authoritative omni listing via the Tauri
// commands and rebuilds the lists FROM that response (membership + order come
// from the backend; the overlay only enriches UI metadata; backend models with
// no overlay entry are built minimally so NEW models appear). If the fetch fails
// the store keeps the overlay.

import { create } from "zustand";
import {
  ImageModel,
  VideoModel,
  IMAGE_MODELS,
  VIDEO_MODELS,
  buildImageModelsFromListing,
  buildVideoModelsFromListing,
} from "@storyteller/model-list";
import { ListImageModels } from "../generate/models/image/ListImageModels.js";
import { ListVideoModels } from "../generate/models/video/ListVideoModels.js";

export interface ModelsStoreState {
  imageModels: ImageModel[];
  videoModels: VideoModel[];
  // True once a backend reconciliation has completed at least once.
  loaded: boolean;
  isLoading: boolean;
  loadModelsFromBackend: () => Promise<void>;
}

let modelsLoadInFlight: Promise<void> | null = null;

// Exact serde names and accepted aliases implemented by TauriImageModel.
const DESKTOP_IMAGE_COMMAND_MODEL_IDS = new Set([
  "flux_1_dev",
  "flux_1_schnell",
  "flux_pro_11",
  "flux_pro_1p1",
  "flux_pro_11_ultra",
  "flux_pro_1p1_ultra",
  "grok_image",
  "grok_imagine_image",
  "recraft_3",
  "gpt_image_1",
  "gpt_image_1p5",
  "gpt_image_2",
  "gemini_25_flash",
  "nano_banana",
  "nano_banana_2",
  "nano_banana_pro",
  "seedream_4",
  "seedream_4p5",
  "seedream_5_lite",
  "midjourney",
  "midjourney_7",
  "midjourney_7_niji",
  "midjourney_8",
  "flux_pro_kontext_max",
  "qwen_edit_2511_angles",
  "flux_2_lora_angles",
  "flux_dev_juggernaut",
  "flux_pro_1",
]);

export const isDesktopImageCommandModel = (modelId: string): boolean =>
  DESKTOP_IMAGE_COMMAND_MODEL_IDS.has(modelId);

// The listing endpoint is forward-compatible and can expose server models
// before the desktop generate command's serde enum/adapters support them.
// Keep those models out of the desktop picker so every hydrated selection is
// serializable by `TauriVideoModel` in generate_video/request.rs.
const DESKTOP_VIDEO_COMMAND_MODEL_IDS = new Set([
  "grok_video",
  "grok_imagine_video",
  "grok_imagine_video_1p5",
  "kling_1.6_pro",
  "kling_1p6_pro",
  "kling_2.1_pro",
  "kling_2p1_pro",
  "kling_2.1_master",
  "kling_2p1_master",
  "kling_2p5_turbo_pro",
  "kling_2p6_pro",
  "kling_3p0_standard",
  "kling_3p0_pro",
  "happy_horse_1p0",
  "seedance_1.0_lite",
  "seedance_1p0_lite",
  "seedance_1p5_pro",
  "seedance_2p0",
  "seedance_2p0_fast",
  "sora_2",
  "sora_2_pro",
  "veo_2",
  "veo_3",
  "veo_3_fast",
  "veo_3p1",
  "veo_3p1_fast",
]);

export const isDesktopVideoCommandModel = (modelId: string): boolean =>
  DESKTOP_VIDEO_COMMAND_MODEL_IDS.has(modelId);

const DESKTOP_IMAGE_MODELS = IMAGE_MODELS.filter((model) =>
  isDesktopImageCommandModel(model.tauriId),
);
const DESKTOP_VIDEO_MODELS = VIDEO_MODELS.filter((model) =>
  isDesktopVideoCommandModel(model.tauriId),
);

export const useModelsStore = create<ModelsStoreState>((set) => ({
  imageModels: DESKTOP_IMAGE_MODELS,
  videoModels: DESKTOP_VIDEO_MODELS,
  loaded: false,
  isLoading: false,
  loadModelsFromBackend: () => {
    if (modelsLoadInFlight) return modelsLoadInFlight;

    const load = Promise.resolve().then(async () => {
      console.log("[models] loadModelsFromBackend() — calling Tauri commands…");
      const [imageResult, videoResult] = await Promise.allSettled([
        Promise.resolve().then(() => ListImageModels()),
        Promise.resolve().then(() => ListVideoModels()),
      ]);

      const next: Partial<ModelsStoreState> = {
        isLoading: false,
        loaded: true,
      };

      if (imageResult.status === "fulfilled") {
        try {
          const { models, providers } = imageResult.value.payload;
          const compatibleModels = models.filter((model) =>
            isDesktopImageCommandModel(model.model),
          );
          const offered = providers
            .flatMap((p) => p.models.map((pm) => pm.model))
            .filter(isDesktopImageCommandModel);
          const built = buildImageModelsFromListing(
            DESKTOP_IMAGE_MODELS,
            compatibleModels,
            offered,
          );
          next.imageModels = built;
          console.log(
            `[models] image: backend returned ${models.length} (${compatibleModels.length} desktop-compatible) → ${built.length} models shown`,
            built.map((m) => m.tauriId),
          );
        } catch (error) {
          console.error("[models] failed to reconcile image models:", error);
        }
      } else {
        console.error(
          "[models] failed to load image models from backend:",
          imageResult.reason,
        );
      }

      if (videoResult.status === "fulfilled") {
        try {
          const { models, providers } = videoResult.value.payload;
          const compatibleModels = models.filter((model) =>
            isDesktopVideoCommandModel(model.model),
          );
          const offered = providers
            .flatMap((p) => p.models.map((pm) => pm.model))
            .filter(isDesktopVideoCommandModel);
          const built = buildVideoModelsFromListing(
            DESKTOP_VIDEO_MODELS,
            compatibleModels,
            offered,
          );
          next.videoModels = built;
          console.log(
            `[models] video: backend returned ${models.length} (${compatibleModels.length} desktop-compatible) → ${built.length} models shown`,
            built.map((m) => m.tauriId),
          );
        } catch (error) {
          console.error("[models] failed to reconcile video models:", error);
        }
      } else {
        console.error(
          "[models] failed to load video models from backend:",
          videoResult.reason,
        );
      }

      // Reconcile both model families in one store update. A failed family is
      // omitted so its last known-good list remains intact.
      set(next);
    });

    const trackedLoad = load.finally(() => {
      modelsLoadInFlight = null;
    });
    modelsLoadInFlight = trackedLoad;

    // Mark the request synchronously only after the shared promise exists, so
    // even re-entrant subscribers join this load instead of starting another.
    set({ isLoading: true });
    return trackedLoad;
  },
}));

// Hook selectors for React consumers.
export const useImageModels = (): ImageModel[] =>
  useModelsStore((s) => s.imageModels);
export const useVideoModels = (): VideoModel[] =>
  useModelsStore((s) => s.videoModels);
