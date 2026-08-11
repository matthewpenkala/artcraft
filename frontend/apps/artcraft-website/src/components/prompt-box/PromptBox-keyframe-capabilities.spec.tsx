import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { PromptBox } from "./PromptBox";

const mocks = vi.hoisted(() => ({
  keyframeProps: null as {
    showFirstFrame?: boolean;
    showLastFrame?: boolean;
    onLastAddActions?: unknown[];
  } | null,
}));

vi.mock("@storyteller/ui-promptbox", () => ({
  KeyframeCards: (props: {
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
  useDeckMedia: () => ({
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
  }),
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
vi.mock("@storyteller/ui-button", () => ({ GenerateIconButton: () => null }));
vi.mock("@storyteller/ui-tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../../lib/enter-to-generate-store", () => ({
  useEnterToGenerateStore: () => false,
}));

describe("PromptBox keyframe capabilities", () => {
  it("renders an independently supported end-frame slot without a start slot", () => {
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
