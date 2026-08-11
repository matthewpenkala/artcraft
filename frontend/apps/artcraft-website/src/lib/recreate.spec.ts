/* eslint-disable @nx/enforce-module-boundaries -- focused test loads local workspace source instead of stale built declarations */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMedia: vi.fn(),
  getPrompt: vi.fn(),
  setImagePending: vi.fn(),
  setVideoPending: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-router-dom", () => ({}));
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
    getState: () => ({ setPendingRecreate: mocks.setImagePending }),
  },
}));
vi.mock("../pages/create-video/create-video-store", () => ({
  useCreateVideoStore: {
    getState: () => ({ setPendingRecreate: mocks.setVideoPending }),
  },
}));

import { applyRecreateFromMediaToken, buildRecreatePayload } from "./recreate";

const context = (semantic: string, mediaToken: string) => ({
  semantic,
  media_token: mediaToken,
  media_links: { cdn_url: `https://cdn/${mediaToken}` },
});

describe("website Recreate consumer", () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockReset());
  });

  it("hydrates API millis and metadata fallback without placeholder files", async () => {
    const payload = await buildRecreatePayload(
      {
        maybe_model_class: "video",
        maybe_context_images: [
          context("imgref", "image"),
          context("vid_ref", "api"),
          context("vid_ref", "fallback"),
          context("audioref", "bad"),
        ],
      } as Parameters<typeof buildRecreatePayload>[0],
      "video",
      {
        loadDurationMillis: async (token) => (token === "api" ? 5_401 : null),
        probeVideoDuration: async () => 5.599_6,
        probeAudioDuration: async () => null,
      },
    );

    expect(payload.referenceVideos).toMatchObject([
      { mediaToken: "api", duration: 5.401 },
      { mediaToken: "fallback", duration: 5.6 },
    ]);
    expect(payload.referenceAudios).toEqual([]);
    expect(payload.excludedReferenceCount).toBe(1);
    expect(payload.referenceImages[0]?.file).toBeUndefined();
  });

  it("fails the raw semantic class boundary before unreadable timed media is excluded", async () => {
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

  it("infers reference mode for a legacy audio-only prompt", async () => {
    const payload = await buildRecreatePayload(
      {
        maybe_model_class: "video",
        maybe_context_images: [context("audioref", "audio")],
      } as Parameters<typeof buildRecreatePayload>[0],
      "video",
      {
        loadDurationMillis: async () => 2_501,
        probeVideoDuration: async () => null,
        probeAudioDuration: async () => null,
      },
    );

    expect(payload.inputMode).toBe("reference");
    expect(payload.referenceImages).toEqual([]);
    expect(payload.referenceAudios).toMatchObject([
      { mediaToken: "audio", duration: 2.501 },
    ]);
  });

  it("rejects partial audio hydration that would rebind @AudioN", async () => {
    await expect(
      buildRecreatePayload(
        {
          maybe_positive_prompt: "Match @Audio2",
          maybe_model_class: "video",
          maybe_context_images: [
            context("audioref", "unreadable"),
            context("audioref", "audio"),
          ],
        } as Parameters<typeof buildRecreatePayload>[0],
        "video",
        {
          loadDurationMillis: async (token) =>
            token === "audio" ? 2_501 : null,
          probeVideoDuration: async () => null,
          probeAudioDuration: async () => null,
        },
      ),
    ).rejects.toThrow("cannot preserve @Audio2");
  });

  it("rejects server-filtered context before hydration can compact ordinals", async () => {
    await expect(
      buildRecreatePayload(
        {
          context_items_complete: false,
          maybe_model_class: "video",
          maybe_context_images: [context("audioref", "audio")],
        } as Parameters<typeof buildRecreatePayload>[0],
        "video",
      ),
    ).rejects.toThrow("context is incomplete");
  });

  it("prevents slow A from mutating or navigating after fast B", async () => {
    mocks.getMedia.mockImplementation(
      ({ mediaFileToken }: { mediaFileToken: string }) =>
        Promise.resolve({
          success: true,
          data: { maybe_prompt_token: `${mediaFileToken}-prompt` },
        }),
    );
    let resolveA!: (value: unknown) => void;
    mocks.getPrompt.mockImplementation(({ token }: { token: string }) => {
      if (token === "A-prompt") {
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

    const slowA = applyRecreateFromMediaToken("A", "video", navigateA);
    await vi.waitFor(() => expect(mocks.getPrompt).toHaveBeenCalledTimes(1));
    const fastB = applyRecreateFromMediaToken("B", "video", navigateB);
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
});
