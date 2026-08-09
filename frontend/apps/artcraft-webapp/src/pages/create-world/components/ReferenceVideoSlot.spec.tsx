import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UploaderStates, type UploaderState } from "@storyteller/common";
import { ReferenceVideoSlot } from "./ReferenceVideoSlot";

const mocks = vi.hoisted(() => ({
  getVideoDuration: vi.fn(),
  uploadVideo: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("../../../components/prompt-box/upload-media", () => ({
  getVideoDuration: mocks.getVideoDuration,
  uploadVideo: mocks.uploadVideo,
}));
vi.mock("../../../components/toast/toast", () => ({
  toast: { error: mocks.toastError },
}));
describe("ReferenceVideoSlot upload lifecycle", () => {
  beforeEach(() => {
    mocks.getVideoDuration.mockReset().mockResolvedValue(5.4);
    mocks.uploadVideo.mockReset();
    mocks.toastError.mockReset();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:world-video"),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(["replacement", "unmount"] as const)(
    "does not publish a deferred success after %s",
    async (boundary) => {
      let complete!: (state: UploaderState) => void;
      let settle!: () => void;
      mocks.uploadVideo.mockImplementation(
        ({ progressCallback }) =>
          new Promise<void>((resolve) => {
            complete = progressCallback;
            settle = resolve;
          }),
      );
      const onChange = vi.fn();
      const { container, rerender, unmount } = render(
        <ReferenceVideoSlot onChange={onChange} />,
      );
      const input = container.querySelector<HTMLInputElement>(
        'input[accept="video/*"]',
      );
      if (!input) throw new Error("missing video input");
      fireEvent.change(input, {
        target: {
          files: [new File(["late"], "late.mp4", { type: "video/mp4" })],
        },
      });
      await waitFor(() => expect(mocks.uploadVideo).toHaveBeenCalledOnce());

      if (boundary === "unmount") {
        unmount();
      } else {
        rerender(
          <ReferenceVideoSlot
            onChange={onChange}
            video={{
              id: "replacement",
              url: "https://cdn.example/replacement.mp4",
              mediaToken: "replacement",
              duration: 4,
            }}
          />,
        );
      }
      complete({ status: UploaderStates.success, data: "late-token" });
      settle();
      await Promise.resolve();

      expect(onChange).not.toHaveBeenCalled();
      expect(URL.createObjectURL).toHaveBeenCalledOnce();
      expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
    },
  );

  it("reports a callback-delivered server failure once and releases its preview", async () => {
    mocks.uploadVideo.mockImplementation(async ({ progressCallback }) => {
      progressCallback({
        status: UploaderStates.assetError,
        errorMessage: "Server rejected the video",
      });
      progressCallback({
        status: UploaderStates.assetError,
        errorMessage: "duplicate",
      });
    });
    const { container } = render(<ReferenceVideoSlot onChange={vi.fn()} />);
    const input = container.querySelector<HTMLInputElement>(
      'input[accept="video/*"]',
    );
    if (!input) throw new Error("missing video input");

    fireEvent.change(input, {
      target: {
        files: [new File(["bad"], "bad.mp4", { type: "video/mp4" })],
      },
    });

    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Server rejected the video",
      ),
    );
    expect(mocks.toastError).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:world-video");
  });

  it.each(["replacement", "unmount"] as const)(
    "does not toast a rejected stale upload after %s",
    async (boundary) => {
      let rejectUpload!: (error: Error) => void;
      mocks.uploadVideo.mockImplementation(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectUpload = reject;
          }),
      );
      const onChange = vi.fn();
      const view = render(<ReferenceVideoSlot onChange={onChange} />);
      const input = view.container.querySelector<HTMLInputElement>(
        'input[accept="video/*"]',
      );
      if (!input) throw new Error("missing video input");
      fireEvent.change(input, {
        target: {
          files: [new File(["late"], "late.mp4", { type: "video/mp4" })],
        },
      });
      await waitFor(() => expect(mocks.uploadVideo).toHaveBeenCalledOnce());

      if (boundary === "unmount") {
        view.unmount();
      } else {
        view.rerender(
          <ReferenceVideoSlot
            onChange={onChange}
            video={{
              id: "replacement",
              url: "https://cdn.example/replacement.mp4",
              mediaToken: "replacement",
              duration: 4,
            }}
          />,
        );
      }
      rejectUpload(new Error("late failure"));
      await Promise.resolve();
      await Promise.resolve();

      expect(mocks.toastError).not.toHaveBeenCalled();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:world-video");
    },
  );
});
