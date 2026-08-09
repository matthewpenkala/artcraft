import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UploaderStates } from "@storyteller/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getVideoDuration: vi.fn(),
  getAudioDuration: vi.fn(),
  uploadVideo: vi.fn(),
  uploadAudio: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("./upload-media", () => ({
  getVideoDuration: mocks.getVideoDuration,
  getAudioDuration: mocks.getAudioDuration,
  uploadVideo: mocks.uploadVideo,
  uploadAudio: mocks.uploadAudio,
}));
vi.mock("./ImagePromptRow", () => ({
  AddButton: ({
    onUpload,
    title,
  }: {
    onUpload: () => void;
    title?: string;
  }) => (
    <button type="button" aria-label={title} onClick={onUpload}>
      Add
    </button>
  ),
}));
vi.mock("../toast/toast", () => ({
  toast: { error: mocks.toastError },
}));
vi.mock("@storyteller/ui-promptbox", () => ({
  AUDIO_FILE_ACCEPT: "audio/*",
  AUDIO_FILE_TYPE_ERROR: "invalid audio",
  isAudioFile: (file: File) => file.type.startsWith("audio/"),
}));

import { MediaReferenceRow } from "./MediaReferenceRow";
import type { RefAudio, RefVideo } from "./types";

const video = (id: string, duration: number): RefVideo => ({
  id,
  url: `https://cdn.example/${id}.mp4`,
  file: new File([id], `${id}.mp4`, { type: "video/mp4" }),
  mediaToken: id,
  duration,
});

const audio = (id: string, duration: number): RefAudio => ({
  id,
  url: `https://cdn.example/${id}.mp3`,
  file: new File([id], `${id}.mp3`, { type: "audio/mpeg" }),
  mediaToken: id,
  duration,
});

describe("MediaReferenceRow duration limits", () => {
  beforeEach(() => {
    mocks.getVideoDuration.mockReset().mockResolvedValue(3.4);
    mocks.getAudioDuration.mockReset().mockResolvedValue(3.4);
    mocks.toastError.mockReset();
    mocks.uploadVideo
      .mockReset()
      .mockImplementation(
        async ({
          progressCallback,
        }: {
          progressCallback: (state: {
            status: UploaderStates;
            data: string;
          }) => void;
        }) => {
          progressCallback({
            status: UploaderStates.success,
            data: "video-c",
          });
        },
      );
    mocks.uploadAudio.mockReset();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:committed-video"),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("accepts a file when current refs plus its duration equal the exact cap", async () => {
    const onReferenceVideosChange = vi.fn();
    const { container } = render(
      <MediaReferenceRow
        videoSupported
        audioSupported={false}
        referenceVideos={[video("video-a", 6.2), video("video-b", 5.4)]}
        onReferenceVideosChange={onReferenceVideosChange}
        maxVideoCount={3}
        maxVideoRefDuration={15}
        referenceAudios={[]}
        onReferenceAudiosChange={vi.fn()}
        maxAudioCount={0}
        maxAudioRefDuration={0}
      />,
    );

    const input = container.querySelector<HTMLInputElement>(
      'input[accept="video/*"]',
    );
    if (!input) throw new Error("missing video input");
    fireEvent.change(input, {
      target: {
        files: [new File(["c"], "video-c.mp4", { type: "video/mp4" })],
      },
    });

    await waitFor(() => expect(onReferenceVideosChange).toHaveBeenCalledOnce());
    const next = onReferenceVideosChange.mock.calls[0]?.[0] as RefVideo[];
    expect(next.map((reference) => reference.duration)).toEqual([
      6.2, 5.4, 3.4,
    ]);
    expect(mocks.uploadVideo).toHaveBeenCalledOnce();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it("rejects a deferred video success after support or caps change", async () => {
    let complete!: (token: string) => void;
    let settle!: () => void;
    mocks.uploadVideo.mockImplementation(
      ({ progressCallback }: Parameters<typeof mocks.uploadVideo>[0]) =>
        new Promise<void>((resolve) => {
          settle = resolve;
          complete = (token) =>
            progressCallback({
              status: UploaderStates.success,
              data: token,
            });
        }),
    );
    const onReferenceVideosChange = vi.fn();
    const props = {
      videoSupported: true,
      audioSupported: false,
      referenceVideos: [] as RefVideo[],
      onReferenceVideosChange,
      maxVideoCount: 1,
      maxVideoRefDuration: 15,
      referenceAudios: [] as RefAudio[],
      onReferenceAudiosChange: vi.fn(),
      maxAudioCount: 0,
      maxAudioRefDuration: 0,
    };
    const { container, rerender } = render(<MediaReferenceRow {...props} />);
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

    rerender(
      <MediaReferenceRow {...props} videoSupported={false} maxVideoCount={0} />,
    );
    complete("late-token");
    settle();
    await Promise.resolve();

    expect(onReferenceVideosChange).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("does not resurrect cleared audio state from a deferred success", async () => {
    let complete!: (token: string) => void;
    let settle!: () => void;
    mocks.uploadAudio.mockImplementation(
      ({ progressCallback }: Parameters<typeof mocks.uploadAudio>[0]) =>
        new Promise<void>((resolve) => {
          settle = resolve;
          complete = (token) =>
            progressCallback({
              status: UploaderStates.success,
              data: token,
            });
        }),
    );
    const onReferenceAudiosChange = vi.fn();
    const baseProps = {
      videoSupported: false,
      audioSupported: true,
      referenceVideos: [] as RefVideo[],
      onReferenceVideosChange: vi.fn(),
      maxVideoCount: 0,
      maxVideoRefDuration: 0,
      onReferenceAudiosChange,
      maxAudioCount: 2,
      maxAudioRefDuration: 15,
    };
    const { container, rerender } = render(
      <MediaReferenceRow
        {...baseProps}
        referenceAudios={[audio("removed", 4)]}
      />,
    );
    const input = container.querySelector<HTMLInputElement>(
      'input[accept="audio/*"]',
    );
    if (!input) throw new Error("missing audio input");
    fireEvent.change(input, {
      target: {
        files: [new File(["late"], "late.mp3", { type: "audio/mpeg" })],
      },
    });
    await waitFor(() => expect(mocks.uploadAudio).toHaveBeenCalledOnce());
    expect(screen.queryByRole("button", { name: "Add audio" })).toBeNull();

    rerender(<MediaReferenceRow {...baseProps} referenceAudios={[]} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Add audio" })).toBeTruthy(),
    );
    complete("late-token");
    settle();
    await Promise.resolve();

    expect(onReferenceAudiosChange).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Add audio" })).toBeTruthy();
  });

  it("cancels a pending audio upload when mutually exclusive host state changes", async () => {
    let complete!: (token: string) => void;
    let settle!: () => void;
    mocks.uploadAudio.mockImplementation(
      ({ progressCallback }: Parameters<typeof mocks.uploadAudio>[0]) =>
        new Promise<void>((resolve) => {
          settle = resolve;
          complete = (token) =>
            progressCallback({
              status: UploaderStates.success,
              data: token,
            });
        }),
    );
    const onReferenceAudiosChange = vi.fn();
    const props = {
      videoSupported: false,
      audioSupported: true,
      referenceVideos: [] as RefVideo[],
      onReferenceVideosChange: vi.fn(),
      maxVideoCount: 0,
      maxVideoRefDuration: 0,
      referenceAudios: [] as RefAudio[],
      onReferenceAudiosChange,
      maxAudioCount: 1,
      maxAudioRefDuration: 15,
    };
    const initialHostState: unknown[] = [];
    const { container, rerender } = render(
      <MediaReferenceRow {...props} externalOperationKey={initialHostState} />,
    );
    const input = container.querySelector<HTMLInputElement>(
      'input[accept="audio/*"]',
    );
    if (!input) throw new Error("missing audio input");
    fireEvent.change(input, {
      target: {
        files: [new File(["late"], "late.mp3", { type: "audio/mpeg" })],
      },
    });
    await waitFor(() => expect(mocks.uploadAudio).toHaveBeenCalledOnce());

    rerender(
      <MediaReferenceRow
        {...props}
        externalOperationKey={["new-image-reference"]}
      />,
    );
    complete("late-token");
    settle();
    await Promise.resolve();

    expect(onReferenceAudiosChange).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Add audio" })).toBeTruthy();
  });

  it("restores video controls when an external replacement cancels an upload", async () => {
    let complete!: (token: string) => void;
    let settle!: () => void;
    mocks.uploadVideo.mockImplementation(
      ({ progressCallback }: Parameters<typeof mocks.uploadVideo>[0]) =>
        new Promise<void>((resolve) => {
          settle = resolve;
          complete = (token) =>
            progressCallback({
              status: UploaderStates.success,
              data: token,
            });
        }),
    );
    const onReferenceVideosChange = vi.fn();
    const props = {
      videoSupported: true,
      audioSupported: false,
      onReferenceVideosChange,
      maxVideoCount: 2,
      maxVideoRefDuration: 15,
      referenceAudios: [] as RefAudio[],
      onReferenceAudiosChange: vi.fn(),
      maxAudioCount: 0,
      maxAudioRefDuration: 0,
    };
    const { container, rerender } = render(
      <MediaReferenceRow {...props} referenceVideos={[]} />,
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
    expect(screen.queryByRole("button", { name: "Add video" })).toBeNull();

    rerender(
      <MediaReferenceRow {...props} referenceVideos={[video("library", 3)]} />,
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Add video" })).toBeTruthy(),
    );
    complete("late-token");
    settle();
    await Promise.resolve();

    expect(onReferenceVideosChange).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Add video" })).toBeTruthy();
  });

  it("does not publish or allocate a URL after unmount", async () => {
    let complete!: (token: string) => void;
    let settle!: () => void;
    mocks.uploadVideo.mockImplementation(
      ({ progressCallback }: Parameters<typeof mocks.uploadVideo>[0]) =>
        new Promise<void>((resolve) => {
          settle = resolve;
          complete = (token) =>
            progressCallback({
              status: UploaderStates.success,
              data: token,
            });
        }),
    );
    const onReferenceVideosChange = vi.fn();
    const { container, unmount } = render(
      <MediaReferenceRow
        videoSupported
        audioSupported={false}
        referenceVideos={[]}
        onReferenceVideosChange={onReferenceVideosChange}
        maxVideoCount={1}
        maxVideoRefDuration={15}
        referenceAudios={[]}
        onReferenceAudiosChange={vi.fn()}
        maxAudioCount={0}
        maxAudioRefDuration={0}
      />,
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

    unmount();
    complete("late-token");
    settle();
    await Promise.resolve();

    expect(onReferenceVideosChange).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
