import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { CommonBitrate } from "@storyteller/api-enums";
import type { JobContextType } from "@storyteller/common";
import type { VideoModel } from "@storyteller/model-list";
import { useCharactersStore, usePromptVideoStore } from "./promptStore";
import { PromptBoxVideo } from "./PromptBoxVideo";

const mocks = vi.hoisted(() => ({
  generateVideo: vi.fn((request: unknown) => {
    void request;
    return Promise.resolve();
  }),
  gtagEvent: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@preact/signals-react/runtime", () => ({
  useSignals: () => undefined,
}));

vi.mock("@storyteller/common", async () => ({
  ...(await import("../../../../common/src/index.ts")),
  formatMediaDurationSeconds: (seconds: number) => String(seconds),
  reconcileOwnedMediaObjectUrlOwners: vi.fn(),
  reconcileOwnedMediaObjectUrls: vi.fn(),
}));

vi.mock("@storyteller/tauri-api", () => ({
  GenerateVideo: mocks.generateVideo,
}));

vi.mock("@storyteller/google-analytics", () => ({
  gtagEvent: mocks.gtagEvent,
}));

vi.mock("@storyteller/ui-toaster", () => ({
  toast: { error: mocks.toastError },
}));

vi.mock("@storyteller/ui-button", () => ({
  ToggleButton: () => null,
  GenerateIconButton: (
    buttonProps: ButtonHTMLAttributes<HTMLButtonElement> & {
      loading?: boolean;
      credits?: number | null;
    },
  ) => {
    const { loading, disabled, credits, ...props } = buttonProps;
    void credits;
    return (
      <button
        type="button"
        aria-label="Generate video"
        data-loading={String(!!loading)}
        disabled={disabled || loading}
        {...props}
      />
    );
  },
}));

vi.mock("@storyteller/ui-popover", () => ({
  PopoverMenu: ({
    children,
    items,
    onSelect,
    panelTitle,
  }: {
    children?: ReactNode;
    items?: Array<{ label: string; selected?: boolean }>;
    onSelect?: (item: { label: string; selected?: boolean }) => void;
    panelTitle?: string;
  }) =>
    panelTitle === "Bitrate" ? (
      <div>
        <output aria-label="Displayed bitrate">
          {items?.find((item) => item.selected)?.label ?? "None"}
        </output>
        {items?.map((item) => (
          <button
            key={item.label}
            type="button"
            aria-label={`Select ${item.label} bitrate`}
            onClick={() => onSelect?.(item)}
          >
            {item.label}
          </button>
        ))}
      </div>
    ) : (
      (children ?? null)
    ),
}));

vi.mock("@storyteller/ui-sliderv2", () => ({ SliderV2: () => null }));

vi.mock("@storyteller/ui-tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@storyteller/icons", () => ({
  DynamicIcon: () => <span aria-hidden="true" />,
}));

vi.mock("@storyteller/api", () => ({
  CharactersApi: class {
    ListAllCharacters = () => Promise.resolve({ success: true, data: [] });
  },
}));

vi.mock("./deck/ReferenceDeck", () => ({ ReferenceDeck: () => null }));
vi.mock("./deck/KeyframeCards", () => ({ KeyframeCards: () => null }));

vi.mock("./deck/useDeckMedia", () => ({
  useDeckMedia: () => ({
    fileInputs: null,
    galleryModal: null,
    uploadingImages: [],
    uploadingEnd: null,
    uploadingVideo: null,
    uploadingAudio: null,
    availableImageSlots: 0,
    replaceImages: vi.fn(),
    replaceVideos: vi.fn(),
    replaceAudios: vi.fn(),
    removeReference: vi.fn(),
    reorderImages: vi.fn(),
    clearReferences: vi.fn((commit?: () => void) => commit?.()),
    processImageFiles: vi.fn(),
    processVideoFiles: vi.fn(),
    processAudioFiles: vi.fn(),
    openImageUpload: vi.fn(),
    openEndUpload: vi.fn(),
    openVideoUpload: vi.fn(),
    openAudioUpload: vi.fn(),
    openAnyUpload: vi.fn(),
    openGallery: vi.fn(),
  }),
}));

vi.mock("./deck/usePromptBoxDrop", () => ({
  PromptBoxDropOverlay: () => null,
  usePromptBoxDrop: () => ({ dragState: null, dropZoneProps: {} }),
}));

vi.mock("./CharactersModal", () => ({ CharactersModal: () => null }));

vi.mock("./MentionTextarea", async () => {
  const { forwardRef } = await vi.importActual<typeof import("react")>("react");
  return {
    MentionTextarea: forwardRef<
      HTMLTextAreaElement,
      {
        value: string;
        onChange: (value: string) => void;
        onKeyDown?: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
      }
    >(({ value, onChange, onKeyDown }, ref) => (
      <textarea
        ref={ref}
        aria-label="Video prompt"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
    )),
  };
});

vi.mock("./PromptFullscreenModal", () => ({
  useFullscreenPrompt: () => ({
    isFullscreen: false,
    openFullscreen: vi.fn(),
    closeFullscreen: vi.fn(),
  }),
  PromptFullscreenModal: () => null,
}));

vi.mock("./PromptFullscreenButton", () => ({
  PromptFullscreenButton: () => null,
}));

vi.mock("./PromptClearAllButton", () => ({
  PromptClearAllButton: () => null,
}));

const makeModel = ({
  bitrateOptions,
  defaultBitrate,
  id = "bitrate-model",
}: {
  bitrateOptions?: CommonBitrate[];
  defaultBitrate?: CommonBitrate;
  id?: string;
}): VideoModel =>
  ({
    id,
    tauriId: id,
    maxPromptLength: 1_000,
    requiresImage: false,
    textToVideoSupported: true,
    startFrame: false,
    endFrame: false,
    supportsReferenceMode: false,
    supportsImageReferences: false,
    supportsVideoReferences: false,
    supportsAudioReferences: false,
    maxReferenceImages: 0,
    maxReferenceVideos: 0,
    maxVideoRefDuration: 0,
    maxReferenceAudios: 0,
    maxAudioRefDuration: 0,
    generateWithSound: false,
    supportsCommonAspectRatio: false,
    supportsSystemPrompt: true,
    sizeOptions: [],
    bitrateOptions,
    defaultBitrate,
  }) as unknown as VideoModel;

const fullModel = makeModel({
  bitrateOptions: [CommonBitrate.Normal, CommonBitrate.High],
  defaultBitrate: CommonBitrate.Normal,
});

const renderPromptBox = (selectedModel: VideoModel) =>
  render(
    <PromptBoxVideo
      selectedModel={selectedModel}
      useJobContext={() => ({}) as JobContextType}
    />,
  );

const generate = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Generate video" }));
  await waitFor(() => expect(mocks.generateVideo).toHaveBeenCalled());
  return mocks.generateVideo.mock.calls.at(-1)?.[0] as Record<string, unknown>;
};

describe("PromptBoxVideo bitrate consumer", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mocks.generateVideo.mockClear();
    mocks.gtagEvent.mockClear();
    mocks.toastError.mockClear();
    useCharactersStore.setState({ characters: [], loaded: true });
    usePromptVideoStore.setState({
      prompt: "Animate this scene",
      resolution: "720p",
      aspectRatio: null,
      bitrate: null,
      referenceImages: [],
      endFrameImage: undefined,
      referenceVideos: [],
      referenceAudios: [],
      generateWithSound: false,
      duration: null,
      inputMode: "keyframe",
      generationCount: 1,
    });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("displays and sends the catalog default when the store is empty", async () => {
    const catalogDefaultModel = makeModel({
      bitrateOptions: [CommonBitrate.Normal, CommonBitrate.High],
      defaultBitrate: CommonBitrate.High,
    });

    renderPromptBox(catalogDefaultModel);

    expect(screen.getByLabelText("Displayed bitrate").textContent).toBe("High");
    expect(usePromptVideoStore.getState().bitrate).toBeNull();
    expect(await generate()).toMatchObject({ bitrate: CommonBitrate.High });
  });

  it("sends an immediate High selection made just before Generate", async () => {
    renderPromptBox(fullModel);

    fireEvent.click(
      screen.getByRole("button", { name: "Select High bitrate" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Generate video" }));

    await waitFor(() => expect(mocks.generateVideo).toHaveBeenCalledOnce());
    expect(usePromptVideoStore.getState().bitrate).toBe(CommonBitrate.High);
    expect(mocks.generateVideo.mock.calls[0][0]).toMatchObject({
      bitrate: CommonBitrate.High,
    });
  });

  it("sends the only legal model value without erasing the sticky choice", async () => {
    const normalOnlyModel = makeModel({
      bitrateOptions: [CommonBitrate.Normal],
      defaultBitrate: CommonBitrate.Normal,
      id: "normal-only-model",
    });
    const { rerender } = renderPromptBox(fullModel);

    fireEvent.click(
      screen.getByRole("button", { name: "Select High bitrate" }),
    );
    expect(usePromptVideoStore.getState().bitrate).toBe(CommonBitrate.High);

    rerender(
      <PromptBoxVideo
        selectedModel={normalOnlyModel}
        useJobContext={() => ({}) as JobContextType}
      />,
    );
    expect(screen.getByLabelText("Displayed bitrate").textContent).toBe(
      "Normal",
    );
    expect(await generate()).toMatchObject({ bitrate: CommonBitrate.Normal });
    expect(usePromptVideoStore.getState().bitrate).toBe(CommonBitrate.High);

    rerender(
      <PromptBoxVideo
        selectedModel={fullModel}
        useJobContext={() => ({}) as JobContextType}
      />,
    );
    expect(screen.getByLabelText("Displayed bitrate").textContent).toBe("High");
  });

  it.each([
    [
      "an explicit empty option list",
      makeModel({
        bitrateOptions: [],
        defaultBitrate: CommonBitrate.High,
        id: "explicit-empty-model",
      }),
    ],
    ["a model without bitrate support", makeModel({ id: "unsupported-model" })],
  ])("hides and omits bitrate for %s", async (_label, selectedModel) => {
    act(() => usePromptVideoStore.getState().setBitrate(CommonBitrate.High));

    renderPromptBox(selectedModel);

    expect(screen.queryByLabelText("Displayed bitrate")).toBeNull();
    expect(await generate()).not.toHaveProperty("bitrate");
    expect(usePromptVideoStore.getState().bitrate).toBe(CommonBitrate.High);
  });
});
