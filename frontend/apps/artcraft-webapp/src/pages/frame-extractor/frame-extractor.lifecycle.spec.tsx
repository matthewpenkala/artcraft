import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  createOwnedMediaObjectUrl,
  resetOwnedMediaObjectUrlsForTests,
} from "@storyteller/common";
import { StrictMode, type MutableRefObject, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtractedFrame } from "./lib/extract-frames";

const mocks = vi.hoisted(() => ({
  captureFrameAt: vi.fn(),
  extractFrames: vi.fn(),
  navigate: vi.fn(),
  sendFrameToCreate: vi.fn(),
  uploadFrame: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => mocks.navigate,
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));
vi.mock("@storyteller/api", () => ({ MediaFilesApi: class {} }));
vi.mock("@storyteller/ui-gallery-modal", () => ({
  GalleryModal: () => null,
}));
vi.mock("@storyteller/common", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@storyteller/common")>()),
  addCorsParam: (url: string) => url,
}));
vi.mock("../../components/seo", () => ({ default: () => null }));
vi.mock("../../components/toast/toast", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock("../../components/signup-cta-modal", () => ({
  useSignupCta: () => ({ loggedIn: true, openSignupCta: vi.fn() }),
}));
vi.mock("../../components/lightbox/shared", () => ({
  isVideoUrl: () => true,
}));
vi.mock("./video-drop-zone", () => ({
  VideoDropZone: ({
    onFilesSelected,
  }: {
    onFilesSelected: (files: FileList) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onFilesSelected({
          0: new File(["video"], "source.mp4", { type: "video/mp4" }),
          length: 1,
          item: () => null,
        } as unknown as FileList)
      }
    >
      Load source
    </button>
  ),
}));
vi.mock("./video-scrubber", () => ({
  VideoScrubber: ({
    videoRef,
  }: {
    videoRef: MutableRefObject<HTMLVideoElement | null>;
  }) => {
    videoRef.current = { currentTime: 0 } as HTMLVideoElement;
    return null;
  },
}));
vi.mock("./extraction-panel", () => ({
  ExtractionPanel: ({
    onCaptureCurrent,
    onExtractBurst,
  }: {
    onCaptureCurrent: () => void;
    onExtractBurst: () => void;
  }) => (
    <>
      <button type="button" onClick={onCaptureCurrent}>
        Capture current
      </button>
      <button type="button" onClick={onExtractBurst}>
        Extract burst
      </button>
    </>
  ),
}));
vi.mock("./frames-grid", () => ({
  FramesGrid: ({
    frames,
    onUseAsImageRef,
    onRemove,
    onClear,
  }: {
    frames: ExtractedFrame[];
    onUseAsImageRef: (frame: ExtractedFrame) => void;
    onRemove: (frame: ExtractedFrame) => void;
    onClear: () => void;
  }) => (
    <div>
      <output data-testid="frame-count">{frames.length}</output>
      {frames[0] && (
        <>
          <button type="button" onClick={() => onUseAsImageRef(frames[0]!)}>
            Use frame
          </button>
          <button type="button" onClick={() => onRemove(frames[0]!)}>
            Remove frame
          </button>
          <button type="button" onClick={onClear}>
            Clear frames
          </button>
        </>
      )}
    </div>
  ),
}));
vi.mock("./lib/frame-actions", () => ({
  downloadFrame: vi.fn(),
  sendFrameToCreate: mocks.sendFrameToCreate,
  uploadFrame: mocks.uploadFrame,
}));
vi.mock("./lib/extract-frames", () => ({
  captureFrameAt: mocks.captureFrameAt,
  extractFrames: mocks.extractFrames,
  FrameExtractionError: class FrameExtractionError extends Error {},
}));

import FrameExtractor from "./frame-extractor";

const frame = (id: string): ExtractedFrame => ({
  id,
  blob: new Blob([id]),
  objectUrl: createOwnedMediaObjectUrl(new Blob([id])),
  timestamp: 0,
  width: 1280,
  height: 720,
});

describe("FrameExtractor StrictMode lifecycle", () => {
  beforeEach(() => {
    let objectUrlSequence = 0;
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => `blob:owned-${++objectUrlSequence}`),
      revokeObjectURL: vi.fn(),
    });
    mocks.captureFrameAt.mockReset().mockResolvedValue(frame("capture"));
    mocks.extractFrames.mockReset().mockResolvedValue([frame("burst")]);
    mocks.navigate.mockReset();
    mocks.sendFrameToCreate.mockReset();
    mocks.uploadFrame.mockReset().mockResolvedValue({
      success: true,
      mediaToken: "frame-token",
    });
  });

  afterEach(() => {
    cleanup();
    resetOwnedMediaObjectUrlsForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    { action: "Capture current", expected: "capture" },
    { action: "Extract burst", expected: "burst" },
  ])(
    "retains a completed $expected frame after Strict Effects",
    async ({ action }) => {
      render(
        <StrictMode>
          <FrameExtractor />
        </StrictMode>,
      );

      fireEvent.click(screen.getByRole("button", { name: "Load source" }));
      fireEvent.click(screen.getByRole("button", { name: action }));

      await waitFor(() =>
        expect(screen.getByTestId("frame-count").textContent).toBe("1"),
      );
    },
  );

  it.each([
    { action: "Capture current", kind: "capture" },
    { action: "Extract burst", kind: "burst" },
  ])(
    "discards a stale $kind result after the source changes",
    async ({ action, kind }) => {
      let complete!: (frames: ExtractedFrame | ExtractedFrame[]) => void;
      const deferred = new Promise<ExtractedFrame | ExtractedFrame[]>(
        (resolve) => {
          complete = resolve;
        },
      );
      if (kind === "capture") {
        mocks.captureFrameAt.mockReturnValue(deferred);
      } else {
        mocks.extractFrames.mockReturnValue(deferred);
      }
      render(<FrameExtractor />);
      fireEvent.click(screen.getByRole("button", { name: "Load source" }));
      fireEvent.click(screen.getByRole("button", { name: action }));
      await waitFor(() =>
        expect(
          kind === "capture" ? mocks.captureFrameAt : mocks.extractFrames,
        ).toHaveBeenCalledOnce(),
      );

      fireEvent.click(screen.getByRole("button", { name: "Switch Video" }));
      const staleFrame = frame("stale");
      await act(async () => {
        complete(kind === "capture" ? staleFrame : [staleFrame]);
        await Promise.resolve();
      });

      await waitFor(() =>
        expect(screen.getByTestId("frame-count").textContent).toBe("0"),
      );
      await waitFor(() =>
        expect(URL.revokeObjectURL).toHaveBeenCalledWith(staleFrame.objectUrl),
      );
    },
  );

  it.each(["remove", "clear", "source", "unmount"] as const)(
    "does not hand off or navigate after a pending send is invalidated by %s",
    async (boundary) => {
      let finishUpload!: () => void;
      mocks.uploadFrame.mockImplementation(
        () =>
          new Promise((resolve) => {
            finishUpload = () =>
              resolve({ success: true, mediaToken: "late-token" });
          }),
      );
      const view = render(<FrameExtractor />);
      fireEvent.click(screen.getByRole("button", { name: "Load source" }));
      fireEvent.click(screen.getByRole("button", { name: "Capture current" }));
      await waitFor(() =>
        expect(screen.getByTestId("frame-count").textContent).toBe("1"),
      );
      fireEvent.click(screen.getByRole("button", { name: "Use frame" }));
      await waitFor(() => expect(mocks.uploadFrame).toHaveBeenCalledOnce());

      if (boundary === "remove") {
        fireEvent.click(screen.getByRole("button", { name: "Remove frame" }));
      } else if (boundary === "clear") {
        fireEvent.click(screen.getByRole("button", { name: "Clear frames" }));
      } else if (boundary === "source") {
        fireEvent.click(screen.getByRole("button", { name: "Switch Video" }));
      } else {
        view.unmount();
      }
      finishUpload();
      await Promise.resolve();
      await Promise.resolve();

      expect(mocks.sendFrameToCreate).not.toHaveBeenCalled();
      expect(mocks.navigate).not.toHaveBeenCalled();
    },
  );
});
