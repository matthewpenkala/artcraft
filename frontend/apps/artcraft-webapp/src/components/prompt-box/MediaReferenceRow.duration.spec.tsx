import { fireEvent, render, waitFor } from "@testing-library/react";
import { UploaderStates } from "@storyteller/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getVideoDuration: vi.fn(),
  uploadVideo: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("./upload-media", () => ({
  getVideoDuration: mocks.getVideoDuration,
  getAudioDuration: vi.fn(),
  uploadVideo: mocks.uploadVideo,
  uploadAudio: vi.fn(),
}));
vi.mock("./ImagePromptRow", () => ({
  AddButton: ({ onUpload }: { onUpload: () => void }) => (
    <button type="button" onClick={onUpload}>
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
import type { RefVideo } from "./types";

const video = (id: string, duration: number): RefVideo => ({
  id,
  url: `https://cdn.example/${id}.mp4`,
  file: new File([id], `${id}.mp4`, { type: "video/mp4" }),
  mediaToken: id,
  duration,
});

describe("MediaReferenceRow duration limits", () => {
  beforeEach(() => {
    mocks.getVideoDuration.mockReset().mockResolvedValue(3.4);
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
});
