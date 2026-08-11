import { act, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { PromptBox } from "./PromptBox";

const mocks = vi.hoisted(() => ({
  keyframeProps: null as {
    onSwap?: () => void;
    showFirstFrame?: boolean;
    showLastFrame?: boolean;
    onLastAddActions?: unknown[];
  } | null,
  deckOptions: null as Record<string, unknown> | null,
}));

vi.mock("@storyteller/ui-promptbox", () => ({
  KeyframeCards: (props: {
    onSwap?: () => void;
    showFirstFrame?: boolean;
    showLastFrame?: boolean;
    onLastAddActions?: unknown[];
  }) => {
    mocks.keyframeProps = props;
    return null;
  },
  MentionTextarea: () => null,
  PromptClearAllButton: () => null,
  ReferenceDeck: () => null,
  buildMentionColorMap: () => ({}),
  getMentionColor: () => "white",
  useDeckMedia: (options: Record<string, unknown>) => {
    mocks.deckOptions = options;
    return {
      uploadingImages: [],
      uploadingEnd: null,
      uploadingVideo: null,
      uploadingAudio: null,
      availableImageSlots: 0,
      processImageFiles: vi.fn(),
      processVideoFiles: vi.fn(),
      processAudioFiles: vi.fn(),
      openImageUpload: vi.fn(),
      openEndUpload: vi.fn(),
      openVideoUpload: vi.fn(),
      openAudioUpload: vi.fn(),
      openAnyUpload: vi.fn(),
      removeReference: vi.fn(),
      replaceImages: vi.fn(),
      reorderImages: vi.fn(),
      clearReferences: (commit?: () => void) => commit?.(),
      fileInputs: null,
    };
  },
}));

vi.mock("@storyteller/icons", () => ({
  ChevronDownIcon: () => null,
  ChevronUpIcon: () => null,
  DynamicIcon: () => null,
}));

vi.mock("./PromptBoxDropZone", () => ({
  PromptBoxDropOverlay: () => null,
  usePromptBoxDrop: () => ({ dropZoneProps: {}, dragState: "idle" }),
}));

vi.mock("./PromptFullscreen", () => ({
  PromptFullscreenButton: () => null,
  PromptFullscreenModal: ({ children }: { children: ReactNode }) => children,
  useFullscreenPrompt: () => ({
    isFullscreen: false,
    openFullscreen: vi.fn(),
    closeFullscreen: vi.fn(),
  }),
}));

vi.mock("./upload-image", () => ({ uploadImage: vi.fn() }));
vi.mock("./upload-media", () => ({
  uploadVideo: vi.fn(),
  uploadAudio: vi.fn(),
}));
vi.mock("../toast/toast", () => ({ toast: { error: vi.fn() } }));
vi.mock("@storyteller/ui-button", () => ({
  GenerateIconButton: () => null,
}));
vi.mock("@storyteller/ui-tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../../lib/enter-to-generate-store", () => ({
  useEnterToGenerateStore: () => false,
}));

const reference = (id: string) => ({
  id,
  url: `blob:${id}`,
  fullUrl: `blob:${id}`,
  file: new File([id], `${id}.png`, { type: "image/png" }),
  mediaToken: `${id}-token`,
});

describe("PromptBox keyframe swap", () => {
  it("routes the swap through the host's atomic frame callback", () => {
    const first = reference("first");
    const last = reference("last");
    const setImages = vi.fn();
    const setEnd = vi.fn();
    const setFrames = vi.fn();

    render(
      <PromptBox
        prompt=""
        onPromptChange={vi.fn()}
        onSubmit={vi.fn()}
        isSubmitting={false}
        supportsImagePrompts
        referenceImages={[first]}
        onReferenceImagesChange={setImages}
        isVideo
        isReferenceMode={false}
        endFrameImage={last}
        onEndFrameImageChange={setEnd}
        onReferenceFramesChange={setFrames}
        showEndFrameSection
      />,
    );

    expect(mocks.keyframeProps?.onSwap).toBeTypeOf("function");
    act(() => mocks.keyframeProps?.onSwap?.());

    expect(setFrames).toHaveBeenCalledWith([last], first);
    expect(setImages).not.toHaveBeenCalled();
    expect(setEnd).not.toHaveBeenCalled();
  });

  it("forwards model/mode identity and removes unsupported media setters", () => {
    const setVideos = vi.fn();
    const setAudios = vi.fn();
    const commonProps = {
      prompt: "",
      onPromptChange: vi.fn(),
      onSubmit: vi.fn(),
      isSubmitting: false,
      supportsImagePrompts: true,
      referenceImages: [],
      onReferenceImagesChange: vi.fn(),
      isVideo: true,
      videoRefsSupported: true,
      referenceVideos: [],
      onReferenceVideosChange: setVideos,
      audioRefsSupported: true,
      referenceAudios: [],
      onReferenceAudiosChange: setAudios,
    };
    const view = render(
      <PromptBox
        {...commonProps}
        isReferenceMode
        referenceOperationKey="model-a:reference"
      />,
    );

    expect(mocks.deckOptions).toMatchObject({
      operationKey: "model-a:reference",
      setReferenceVideos: setVideos,
      setReferenceAudios: setAudios,
    });

    view.rerender(
      <PromptBox
        {...commonProps}
        isReferenceMode={false}
        referenceOperationKey="model-b:keyframe"
      />,
    );
    expect(mocks.deckOptions).toMatchObject({
      operationKey: "model-b:keyframe",
      setReferenceVideos: undefined,
      setReferenceAudios: undefined,
    });
  });

  it("keeps the keyframe control visible for an end-only model", () => {
    render(
      <PromptBox
        prompt=""
        onPromptChange={vi.fn()}
        onSubmit={vi.fn()}
        isSubmitting={false}
        supportsImagePrompts={false}
        supportsStartFrame={false}
        referenceImages={[]}
        onReferenceImagesChange={vi.fn()}
        isVideo
        isReferenceMode={false}
        showEndFrameSection
        onEndFrameImageChange={vi.fn()}
      />,
    );

    expect(mocks.keyframeProps).toMatchObject({
      showFirstFrame: false,
      showLastFrame: true,
    });
    expect(mocks.keyframeProps?.onLastAddActions).not.toHaveLength(0);
  });
});
