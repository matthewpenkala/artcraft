import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePromptAudioStore } from "./promptStore";

const mocks = vi.hoisted(() => ({
  galleryUseSelected: undefined as
    | ((items: Array<{ id: string; fullImage?: string }>) => Promise<void>)
    | undefined,
  coordinator: undefined as { isCurrent: () => boolean } | undefined,
  releaseBatch: undefined as (() => void) | undefined,
  appendBatch: vi.fn(),
}));

vi.mock("@storyteller/common", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@storyteller/common")>();
  return {
    ...actual,
    appendProbedMediaReferenceBatch: mocks.appendBatch,
  };
});
vi.mock("@storyteller/ui-gallery-modal", () => ({
  GalleryModal: ({
    onUseSelected,
  }: {
    onUseSelected: typeof mocks.galleryUseSelected;
  }) => {
    mocks.galleryUseSelected = onUseSelected;
    return null;
  },
}));
vi.mock("@storyteller/ui-popover", () => ({
  PopoverMenu: () => null,
}));
vi.mock("@storyteller/ui-tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@storyteller/ui-button", () => ({
  GenerateButton: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  ToggleButton: () => null,
}));
vi.mock("@storyteller/omni-gen", () => ({
  enqueueAudioGeneration: vi.fn(),
  AUDIO_MODELS_REQUIRING_AUDIO_REF: new Set<string>(),
  OMNI_GENERATE_OUTAGE_MESSAGE: "unavailable",
}));
vi.mock("@storyteller/model-list", () => ({
  CommonAspectRatio: {},
  CommonResolution: {},
  CommonQuality: {},
  getCreatorIconPathForModelId: () => "",
  getModelDescription: () => "",
  getModelInfo: () => "",
}));
vi.mock("@storyteller/google-analytics", () => ({ gtagEvent: vi.fn() }));
vi.mock("./useAutoGrowEditorHeight", () => ({
  useAutoGrowEditorHeight: () => ({
    isExpanded: false,
    toggleExpand: vi.fn(),
  }),
}));
vi.mock("./PromptFullscreenModal", () => ({
  PromptFullscreenModal: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  useFullscreenPrompt: () => ({
    isFullscreen: false,
    openFullscreen: vi.fn(),
    closeFullscreen: vi.fn(),
  }),
}));
vi.mock("./PromptFullscreenButton", () => ({
  PromptFullscreenButton: () => null,
}));
vi.mock("./PromptClearAllButton", () => ({
  PromptClearAllButton: ({ onClick }: { onClick: () => void }) => (
    <button type="button" aria-label="clear-prompt" onClick={onClick} />
  ),
}));
vi.mock("./common/AudioReferenceRow", async () => {
  const React = await import("react");
  return {
    AudioReferenceRow: React.forwardRef(
      (
        { onPickAudioFromLibrary }: { onPickAudioFromLibrary?: () => void },
        _ref,
      ) => (
        <button
          type="button"
          aria-label="open-audio-library"
          onClick={onPickAudioFromLibrary}
        />
      ),
    ),
  };
});
vi.mock("./deck/usePromptBoxDrop", () => ({
  PromptBoxDropOverlay: () => null,
  usePromptBoxDrop: () => ({
    dragState: null,
    dropZoneProps: {},
  }),
}));
vi.mock("./common/AudioTuningPopover", () => ({
  AudioTuningPopover: () => null,
}));
vi.mock("./common/SoundsSettingsPopover", () => ({
  SoundsSettingsPopover: () => null,
}));
vi.mock("./common/StylePromptRow", () => ({ StylePromptRow: () => null }));

import { PromptBoxAudio } from "./PromptBoxAudio";

const models = [
  {
    model: "audio-a",
    full_name: "Audio A",
    audio_references_supported: true,
    audio_references_max: 2,
  },
  {
    model: "audio-b",
    full_name: "Audio B",
    audio_references_supported: true,
    audio_references_max: 1,
  },
];

describe("PromptBoxAudio library settlement", () => {
  beforeEach(() => {
    mocks.galleryUseSelected = undefined;
    mocks.coordinator = undefined;
    mocks.releaseBatch = undefined;
    mocks.appendBatch.mockReset().mockImplementation((_items, coordinator) => {
      mocks.coordinator = coordinator;
      return new Promise((resolve) => {
        mocks.releaseBatch = () =>
          resolve({ status: "stale", added: 0, unreadable: 0 });
      });
    });
    usePromptAudioStore.setState({
      prompt: "",
      selectedModelId: "audio-a",
      referenceAudios: [],
      referenceImages: [],
    });
  });

  afterEach(() => {
    act(() => {
      usePromptAudioStore.getState().setReferenceAudios([]);
      usePromptAudioStore.getState().setReferenceImages([]);
    });
    vi.clearAllMocks();
  });

  it.each(["model change", "clear", "unmount"] as const)(
    "invalidates a deferred library probe after %s",
    async (boundary) => {
      const view = render(<PromptBoxAudio models={models} />);
      fireEvent.click(
        screen.getByRole("button", { name: "open-audio-library" }),
      );
      if (!mocks.galleryUseSelected) throw new Error("missing gallery handler");

      let operation!: Promise<void>;
      act(() => {
        operation = mocks.galleryUseSelected!([
          { id: "late", fullImage: "https://cdn.example/late.mp3" },
        ]);
      });
      await waitFor(() => expect(mocks.coordinator).toBeDefined());

      if (boundary === "model change") {
        act(() => usePromptAudioStore.getState().setSelectedModelId("audio-b"));
      } else if (boundary === "clear") {
        fireEvent.click(
          screen.getAllByRole("button", { name: "clear-prompt" })[0]!,
        );
      } else {
        view.unmount();
      }

      expect(mocks.coordinator?.isCurrent()).toBe(false);
      await act(async () => {
        mocks.releaseBatch?.();
        await operation;
      });
      expect(usePromptAudioStore.getState().referenceAudios).toEqual([]);
    },
  );
});
