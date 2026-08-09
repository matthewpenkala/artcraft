import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { RefAudio, RefImage } from "../../components/prompt-box";
import { reconcileOwnedMediaObjectUrls } from "@storyteller/common";

const AUDIO_REFS_OWNER = Symbol("webapp-create-audio-audios");
const AUDIO_IMAGES_OWNER = Symbol("webapp-create-audio-images");

export type AudioUiState = {
  selectedModelId: string | null;
  prompt: string;
  stylePrompt: string;
  // Suno toggles
  isInstrumental: boolean;
  keepLyrics: boolean;
  isLoopable: boolean;
  // Suno Sounds beat controls. bpm null = "Auto" (omitted from the request).
  bpm: number | null;
  musicalKey: string;
  // Seed Audio output shaping. sampleRateHz is resolved against the current
  // model's options at read time (sticky across model switches).
  sampleRateHz: number | null;
  speed: number;
  volume: number;
  pitch: number;
};

type CreateAudioState = {
  ui: AudioUiState;
  referenceAudios: RefAudio[];
  referenceImages: RefImage[];
  setUi: (patch: Partial<AudioUiState>) => void;
  setReferenceAudios: (audios: RefAudio[]) => void;
  setReferenceImages: (images: RefImage[]) => void;
  reset: () => void;
};

const DEFAULT_UI: AudioUiState = {
  selectedModelId: null,
  prompt: "",
  stylePrompt: "",
  isInstrumental: false,
  keepLyrics: false,
  isLoopable: false,
  bpm: null,
  musicalKey: "auto",
  sampleRateHz: null,
  speed: 1,
  volume: 1,
  pitch: 0,
};

export const useCreateAudioStore = create<CreateAudioState>()(
  persist(
    (set) => ({
      ui: { ...DEFAULT_UI },
      referenceAudios: [],
      referenceImages: [],

      setUi: (patch) => set((s) => ({ ui: { ...s.ui, ...patch } })),

      setReferenceAudios: (audios) =>
        set((state) => {
          reconcileOwnedMediaObjectUrls(
            AUDIO_REFS_OWNER,
            state.referenceAudios.map((reference) => reference.url),
            audios.map((reference) => reference.url),
          );
          return { referenceAudios: audios };
        }),

      setReferenceImages: (images) =>
        set((state) => {
          reconcileOwnedMediaObjectUrls(
            AUDIO_IMAGES_OWNER,
            state.referenceImages.map((reference) => reference.url),
            images.map((reference) => reference.url),
          );
          return { referenceImages: images };
        }),

      reset: () => set({ ui: { ...DEFAULT_UI } }),
    }),
    {
      name: "artcraft-audio-prompt",
      // Persist prompt + settings so a full page reload keeps the user's
      // draft. Reference audios/images are excluded: File handles aren't
      // serializable and uploads can exceed the localStorage quota.
      partialize: (state) => ({ ui: state.ui }),
      merge: (persisted, current) => {
        const persistedUi = (persisted as { ui?: Partial<AudioUiState> } | null)
          ?.ui;
        return { ...current, ui: { ...current.ui, ...(persistedUi ?? {}) } };
      },
    },
  ),
);
