import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { RecreatePayload } from "../../lib/recreate";
import type { RefImage, RefVideo, RefAudio } from "../../components/prompt-box";
import { reconcileOwnedMediaObjectUrlOwners } from "@storyteller/common";

const VIDEO_IMAGES_OWNER = Symbol("website-create-video-images");
const VIDEO_END_IMAGE_OWNER = Symbol("website-create-video-end-image");
const VIDEO_VIDEOS_OWNER = Symbol("website-create-video-videos");
const VIDEO_AUDIOS_OWNER = Symbol("website-create-video-audios");

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
  setUi: (patch: Partial<VideoUiState>) => void;
  setRefs: (patch: Partial<VideoRefsState>) => void;
  setPendingRecreate: (payload: RecreatePayload | null) => void;
  consumePendingRecreate: () => RecreatePayload | null;
  commitPendingRecreate: (
    payload: RecreatePayload,
    ui: VideoUiState,
    refs: VideoRefsState,
  ) => boolean;
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
  inputMode: "keyframe",
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

      commitPendingRecreate: (payload, ui, refs) => {
        let committed = false;
        set((state) => {
          if (state.pendingRecreate !== payload) return state;
          reconcileVideoRefUrls(state.refs, refs);
          committed = true;
          return { pendingRecreate: null, ui, refs };
        });
        return committed;
      },

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
      partialize: (state) => ({
        batches: state.batches.filter((b) => b.status === "pending"),
      }),
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
