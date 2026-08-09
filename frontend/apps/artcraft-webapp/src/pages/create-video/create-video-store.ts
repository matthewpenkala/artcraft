import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { RecreatePayload } from "../../lib/recreate";
import type { RefImage, RefVideo, RefAudio } from "../../components/prompt-box";
import {
  reconcileOwnedMediaObjectUrlOwners,
  reconcileOwnedMediaObjectUrls,
} from "@storyteller/common";

const VIDEO_IMAGES_OWNER = Symbol("webapp-create-video-images");
const VIDEO_END_IMAGE_OWNER = Symbol("webapp-create-video-end-image");
const VIDEO_VIDEOS_OWNER = Symbol("webapp-create-video-videos");
const VIDEO_AUDIOS_OWNER = Symbol("webapp-create-video-audios");
const VIDEO_PENDING_IMAGES_OWNER = Symbol("webapp-create-video-pending-images");
const VIDEO_PENDING_VIDEOS_OWNER = Symbol("webapp-create-video-pending-videos");

export interface GeneratedVideo {
  media_token: string;
  cdn_url: string;
  maybe_thumbnail_template?: string;
}

export type VideoBatch = {
  id: string;
  prompt: string;
  status: "pending" | "complete" | "failed";
  video?: GeneratedVideo;
  createdAt: number;
  modelLabel: string;
  jobToken?: string;
  failureReason?: string;
  batchCount?: number;
};

export type VideoInputMode = "keyframe" | "reference";

export type VideoUiState = {
  selectedModelId: string | null;
  prompt: string;
  selectedSize: string;
  duration: number | null;
  resolution: string | null;
  bitrate: string | null;
  generateWithSound: boolean;
  inputMode: VideoInputMode;
  numVideos: number;
};

export type VideoRefsState = {
  referenceImages: RefImage[];
  endFrameImage: RefImage | undefined;
  referenceVideos: RefVideo[];
  referenceAudios: RefAudio[];
};

type CreateVideoState = {
  batches: VideoBatch[];
  ui: VideoUiState;
  refs: VideoRefsState;
  pendingRecreate: RecreatePayload | null;
  // Reference media sent from another page (library "Send to prompt").
  // Consumed by the create-video page, which applies the real per-model caps.
  pendingRefImages: RefImage[] | null;
  pendingRefVideos: RefVideo[] | null;
  setUi: (patch: Partial<VideoUiState>) => void;
  setRefs: (patch: Partial<VideoRefsState>) => void;
  setPendingRecreate: (payload: RecreatePayload | null) => void;
  consumePendingRecreate: () => RecreatePayload | null;
  setPendingRefImages: (refs: RefImage[] | null) => void;
  setPendingRefVideos: (refs: RefVideo[] | null) => void;
  startBatch: (
    prompt: string,
    modelLabel: string,
    batchCount?: number,
  ) => string;
  setBatchJobToken: (batchId: string, jobToken: string) => void;
  completeBatch: (batchId: string, video: GeneratedVideo) => void;
  failBatch: (batchId: string, reason?: string) => void;
  dismissBatch: (id: string) => void;
  clearCompleted: () => void;
  reset: () => void;
};

const DEFAULT_UI: VideoUiState = {
  selectedModelId: null,
  prompt: "",
  selectedSize: "wide_sixteen_by_nine",
  duration: null,
  resolution: null,
  bitrate: null,
  generateWithSound: false,
  inputMode: "reference",
  numVideos: 1,
};

const DEFAULT_REFS: VideoRefsState = {
  referenceImages: [],
  endFrameImage: undefined,
  referenceVideos: [],
  referenceAudios: [],
};

export const useCreateVideoStore = create<CreateVideoState>()(
  persist(
    (set, get) => ({
      batches: [],
      ui: { ...DEFAULT_UI },
      refs: { ...DEFAULT_REFS },
      pendingRecreate: null,
      pendingRefImages: null,
      pendingRefVideos: null,

      setUi: (patch) => set((s) => ({ ui: { ...s.ui, ...patch } })),

      setRefs: (patch) =>
        set((state) => {
          const next = { ...state.refs, ...patch };
          reconcileVideoRefUrls(state.refs, next);
          return { refs: next };
        }),

      setPendingRecreate: (payload) => set({ pendingRecreate: payload }),

      consumePendingRecreate: () => {
        const payload = get().pendingRecreate;
        if (payload) set({ pendingRecreate: null });
        return payload;
      },

      setPendingRefImages: (refs) =>
        set((state) => {
          reconcileOwnedMediaObjectUrls(
            VIDEO_PENDING_IMAGES_OWNER,
            (state.pendingRefImages ?? []).map((reference) => reference.url),
            (refs ?? []).map((reference) => reference.url),
          );
          return { pendingRefImages: refs };
        }),

      setPendingRefVideos: (refs) =>
        set((state) => {
          reconcileOwnedMediaObjectUrls(
            VIDEO_PENDING_VIDEOS_OWNER,
            (state.pendingRefVideos ?? []).map((reference) => reference.url),
            (refs ?? []).map((reference) => reference.url),
          );
          return { pendingRefVideos: refs };
        }),

      startBatch: (prompt, modelLabel, batchCount) => {
        const id = crypto.randomUUID();
        const batch: VideoBatch = {
          id,
          prompt,
          status: "pending",
          createdAt: Date.now(),
          modelLabel,
          batchCount,
        };
        set((s) => ({ batches: [...s.batches, batch] }));
        return id;
      },

      setBatchJobToken: (batchId, jobToken) => {
        set((s) => ({
          batches: s.batches.map((b) =>
            b.id === batchId ? { ...b, jobToken } : b,
          ),
        }));
      },

      completeBatch: (batchId, video) => {
        set((s) => ({
          batches: s.batches.map((b) =>
            b.id === batchId ? { ...b, status: "complete" as const, video } : b,
          ),
        }));
      },

      failBatch: (batchId, reason) => {
        set((s) => ({
          batches: s.batches.map((b) =>
            b.id === batchId
              ? { ...b, status: "failed" as const, failureReason: reason }
              : b,
          ),
        }));
      },

      dismissBatch: (id) => {
        set((s) => ({ batches: s.batches.filter((b) => b.id !== id) }));
      },

      clearCompleted: () => {
        set((s) => ({
          batches: s.batches.filter((b) => b.status !== "complete"),
        }));
      },

      reset: () => set({ batches: [] }),
    }),
    {
      name: "artcraft-video-batches",
      // Bumped to 1 when reference became the default input mode, and to 2
      // when Seedance 2.5 replaced 2.0 as the default model: each migration
      // runs once for pre-existing persisted state so everyone lands on the
      // new defaults.
      version: 2,
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as {
          batches?: VideoBatch[];
          ui?: VideoUiState;
        };
        const ui = { ...DEFAULT_UI, ...(p.ui ?? {}) };
        if (version < 1) {
          ui.inputMode = "reference";
        }
        if (version < 2) {
          // Seedance 2.5 replaced 2.0 as the default: users still on the old
          // default follow it (null resolves to DEFAULT_MODEL_ID at read
          // time); explicit picks of other models are left alone. Everyone
          // lands back on Omni Reference as the default input mode.
          if (ui.selectedModelId === "seedance_2p0") {
            ui.selectedModelId = null;
          }
          ui.inputMode = "reference";
        }
        return { batches: p.batches ?? [], ui };
      },
      // Persist prompt + lightweight settings alongside pending batches so a
      // full page reload (e.g. returning from a credit top-up) keeps the
      // user's draft. Reference media (refs) is excluded for the same reason
      // as the image store: File handles + blob URLs don't survive serialization.
      partialize: (state) => ({
        batches: state.batches.filter((b) => b.status === "pending"),
        ui: state.ui,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<CreateVideoState>;
        return {
          ...current,
          ...p, // restores persisted pending batches
          ui: { ...current.ui, ...((p.ui as Partial<VideoUiState>) ?? {}) },
        };
      },
    },
  ),
);

function reconcileVideoRefUrls(
  previous: VideoRefsState,
  next: VideoRefsState,
): void {
  reconcileOwnedMediaObjectUrlOwners([
    {
      owner: VIDEO_IMAGES_OWNER,
      previousUrls: previous.referenceImages.map((reference) => reference.url),
      nextUrls: next.referenceImages.map((reference) => reference.url),
    },
    {
      owner: VIDEO_END_IMAGE_OWNER,
      previousUrls: previous.endFrameImage ? [previous.endFrameImage.url] : [],
      nextUrls: next.endFrameImage ? [next.endFrameImage.url] : [],
    },
    {
      owner: VIDEO_VIDEOS_OWNER,
      previousUrls: previous.referenceVideos.map((reference) => reference.url),
      nextUrls: next.referenceVideos.map((reference) => reference.url),
    },
    {
      owner: VIDEO_AUDIOS_OWNER,
      previousUrls: previous.referenceAudios.map((reference) => reference.url),
      nextUrls: next.referenceAudios.map((reference) => reference.url),
    },
  ]);
}
