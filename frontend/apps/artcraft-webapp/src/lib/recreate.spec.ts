/* eslint-disable @nx/enforce-module-boundaries -- focused test loads local workspace source instead of stale built declarations */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMedia: vi.fn(),
  getPrompt: vi.fn(),
  setImagePending: vi.fn(),
  setVideoPending: vi.fn(),
  toastError: vi.fn(),
  imagePending: null as unknown,
  videoPending: null as unknown,
}));

vi.mock("react-router-dom", () => ({ useNavigate: vi.fn() }));
vi.mock("@storyteller/common", async () => ({
  ...(await import("../../../../libs/common/src/lib/utils/media-reference-state")),
  ...(await import("../../../../libs/common/src/lib/utils/media-duration")),
}));
vi.mock("@storyteller/api", () => ({
  MediaFilesApi: class {
    GetMediaFileByToken = mocks.getMedia;
  },
  PromptsApi: class {
    GetPromptsByToken = mocks.getPrompt;
  },
}));
vi.mock("../components/toast/toast", () => ({
  toast: { error: mocks.toastError },
}));
vi.mock("../pages/create-image/create-image-store", () => ({
  useCreateImageStore: {
    getState: () => ({
      pendingRecreate: mocks.imagePending,
      setPendingRecreate: (payload: unknown) => {
        mocks.setImagePending(payload);
        mocks.imagePending = payload;
      },
    }),
  },
}));
vi.mock("../pages/create-video/create-video-store", () => ({
  useCreateVideoStore: {
    getState: () => ({
      pendingRecreate: mocks.videoPending,
      setPendingRecreate: (payload: unknown) => {
        mocks.setVideoPending(payload);
        mocks.videoPending = payload;
      },
    }),
  },
}));

import { applyRecreateFromPromptToken, buildRecreatePayload } from "./recreate";

const context = (semantic: string, mediaToken: string) => ({
  semantic,
  media_token: mediaToken,
  media_links: { cdn_url: `https://cdn/${mediaToken}` },
});

const hydration = {
  loadDurationMillis: async (token: string) =>
    token === "video-api" ? 5_401 : token === "audio-api" ? 3_201 : null,
  probeVideoDuration: async (url: string) =>
    url.endsWith("video-fallback") ? 5.599_6 : null,
  probeAudioDuration: async () => null,
};

describe("webapp Recreate hydration", () => {
  beforeEach(() => {
    [
      mocks.getMedia,
      mocks.getPrompt,
      mocks.setImagePending,
      mocks.setVideoPending,
      mocks.toastError,
    ].forEach((mock) => mock.mockReset());
    mocks.imagePending = null;
    mocks.videoPending = null;
  });

  it("hydrates exact durations, semantic slots, and stable token dedupe", async () => {
    const payload = await buildRecreatePayload(
      {
        maybe_positive_prompt: "restored prompt",
        maybe_model_class: "video",
        maybe_generation_mode: "reference",
        maybe_context_images: [
          context("imgref", "image"),
          context("imgref", "image"),
          context("vid_start_frame", "start"),
          context("vid_end_frame", "end"),
          context("vid_ref", "video-api"),
          context("vid_ref", "video-api"),
          context("vid_ref", "video-fallback"),
          context("audioref", "audio-api"),
          context("audioref", "audio-bad"),
          context("", "unknown"),
        ],
      } as Parameters<typeof buildRecreatePayload>[0],
      "video",
      hydration,
    );

    expect(payload.inputMode).toBe("keyframe");
    expect(payload.referenceImages.map((item) => item.mediaToken)).toEqual([
      "image",
      "start",
    ]);
    expect(payload.endFrameImage?.mediaToken).toBe("end");
    expect(payload.referenceVideos).toMatchObject([
      { mediaToken: "video-api", duration: 5.401 },
      { mediaToken: "video-fallback", duration: 5.6 },
    ]);
    expect(payload.referenceAudios).toMatchObject([
      { mediaToken: "audio-api", duration: 3.201 },
    ]);
    expect(payload.excludedReferenceCount).toBe(2);
    expect(payload.referenceImages.every((item) => item.file == null)).toBe(
      true,
    );
  });

  it("fails closed when image Recreate contains video-only media", async () => {
    await expect(
      buildRecreatePayload(
        {
          maybe_model_class: "image",
          maybe_context_images: [context("vid_ref", "video-api")],
        } as Parameters<typeof buildRecreatePayload>[0],
        "image",
        hydration,
      ),
    ).rejects.toThrow("non-image reference media");
  });

  it("rejects a raw image-class video context before unreadable media can be excluded", async () => {
    await expect(
      buildRecreatePayload(
        {
          maybe_model_class: "image",
          maybe_context_images: [context("vid_ref", "unreadable")],
        } as Parameters<typeof buildRecreatePayload>[0],
        "image",
        {
          loadDurationMillis: async () => null,
          probeVideoDuration: async () => null,
          probeAudioDuration: async () => null,
        },
      ),
    ).rejects.toThrow("non-image reference media");
  });

  it("infers reference mode for legacy video/audio-only prompts", async () => {
    const payload = await buildRecreatePayload(
      {
        maybe_model_class: "video",
        maybe_context_images: [
          context("vid_ref", "video-api"),
          context("audioref", "audio-api"),
        ],
      } as Parameters<typeof buildRecreatePayload>[0],
      "video",
      hydration,
    );

    expect(payload.inputMode).toBe("reference");
    expect(payload.referenceImages).toEqual([]);
    expect(payload.referenceVideos).toHaveLength(1);
    expect(payload.referenceAudios).toHaveLength(1);
  });

  it("rejects partial video hydration that would rebind @VideoN", async () => {
    await expect(
      buildRecreatePayload(
        {
          maybe_positive_prompt: "Transition from @Video2",
          maybe_model_class: "video",
          maybe_context_images: [
            context("vid_ref", "unreadable"),
            context("vid_ref", "video-api"),
          ],
        } as Parameters<typeof buildRecreatePayload>[0],
        "video",
        hydration,
      ),
    ).rejects.toThrow("cannot preserve @Video2");
  });

  it("rejects server-filtered context before hydration can compact ordinals", async () => {
    await expect(
      buildRecreatePayload(
        {
          context_items_complete: false,
          maybe_model_class: "video",
          maybe_context_images: [context("vid_ref", "video-api")],
        } as Parameters<typeof buildRecreatePayload>[0],
        "video",
        hydration,
      ),
    ).rejects.toThrow("context is incomplete");
  });

  it("rejects duplicate end-frame records transactionally", async () => {
    await expect(
      buildRecreatePayload(
        {
          maybe_model_class: "video",
          maybe_context_images: [
            context("vid_end_frame", "end-a"),
            context("vid_end_frame", "end-b"),
          ],
        } as Parameters<typeof buildRecreatePayload>[0],
        "video",
        hydration,
      ),
    ).rejects.toThrow("multiple end frames");
  });

  it("prevents slow A from mutating or navigating after fast B", async () => {
    let resolveA!: (value: unknown) => void;
    mocks.getPrompt.mockImplementation(({ token }: { token: string }) => {
      if (token === "A") {
        return new Promise((resolve) => {
          resolveA = resolve;
        });
      }
      return Promise.resolve({
        success: true,
        data: {
          maybe_positive_prompt: "B",
          maybe_model_class: "video",
          maybe_context_images: [],
        },
      });
    });
    const navigateA = vi.fn();
    const navigateB = vi.fn();

    const slowA = applyRecreateFromPromptToken("A", "video", navigateA);
    const fastB = applyRecreateFromPromptToken("B", "video", navigateB);
    await fastB;
    expect(mocks.setVideoPending).toHaveBeenCalledTimes(1);
    expect(navigateB).toHaveBeenCalledWith("/create-video");

    resolveA({
      success: true,
      data: {
        maybe_positive_prompt: "A",
        maybe_model_class: "video",
        maybe_context_images: [],
      },
    });
    await slowA;
    expect(mocks.setVideoPending).toHaveBeenCalledTimes(1);
    expect(navigateA).not.toHaveBeenCalled();
  });

  it("invalidates both previously queued destinations when a newer request fails", async () => {
    mocks.imagePending = { prompt: "old image" };
    mocks.videoPending = { prompt: "old video" };
    mocks.getPrompt.mockResolvedValue({ success: false });
    const navigate = vi.fn();

    await applyRecreateFromPromptToken("new", "video", navigate);

    expect(mocks.setImagePending).toHaveBeenCalledWith(null);
    expect(mocks.setVideoPending).toHaveBeenCalledWith(null);
    expect(navigate).not.toHaveBeenCalled();
  });
});
