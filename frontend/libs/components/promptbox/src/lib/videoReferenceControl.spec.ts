import { describe, expect, it, vi } from "vitest";
import {
  projectPromptVideoReferences,
  synchronizePromptVideoReferences,
  type PromptVideoReferenceState,
} from "./videoReferenceControl.js";
import type { RefAudio, RefImage, RefVideo } from "./promptStore.js";

const image = (id: string): RefImage =>
  ({ id, mediaToken: `${id}-token` }) as RefImage;
const video = (id: string): RefVideo =>
  ({ id, mediaToken: `${id}-token`, duration: 1 }) as RefVideo;
const audio = (id: string): RefAudio =>
  ({ id, mediaToken: `${id}-token`, duration: 1 }) as RefAudio;

const state = (
  values: Partial<PromptVideoReferenceState> = {},
): PromptVideoReferenceState => ({
  inputMode: "reference",
  referenceImages: [],
  endFrameImage: undefined,
  referenceVideos: [],
  referenceAudios: [],
  ...values,
});

describe("PromptBox video reference consumer", () => {
  it("uses one projection for independent UI gates and request media", () => {
    const projected = projectPromptVideoReferences(
      {
        supportsImageReferences: false,
        supportsVideoReferences: true,
        supportsAudioReferences: false,
        maxReferenceImages: 9,
        maxReferenceVideos: 1,
        maxReferenceAudios: 2,
      },
      state({
        referenceImages: [image("image")],
        endFrameImage: image("end"),
        referenceVideos: [video("video")],
        referenceAudios: [audio("audio")],
      }),
    );

    expect(projected).toMatchObject({
      inputMode: "reference",
      acceptsImages: false,
      acceptsVideos: true,
      acceptsAudio: false,
      maxImageCount: 0,
    });
    expect(projected.referenceImages).toEqual([]);
    expect(projected.referenceVideos.map((item) => item.id)).toEqual(["video"]);
    expect(projected.referenceAudios).toEqual([]);
    expect(projected.requestMedia).toEqual({
      reference_image_media_tokens: undefined,
      reference_video_media_tokens: ["video-token"],
      reference_audio_media_tokens: undefined,
    });
  });

  it("honors an explicit zero limit in UI and request output", () => {
    const projected = projectPromptVideoReferences(
      {
        supportsImageReferences: true,
        maxReferenceImages: 0,
      },
      state({ referenceImages: [image("image")] }),
    );

    expect(projected.capabilities.declaresReferenceMode).toBe(true);
    expect(projected.capabilities.supportsReferenceMode).toBe(false);
    expect(projected.inputMode).toBe("keyframe");
    expect(projected.acceptsImages).toBe(false);
    expect(projected.maxImageCount).toBe(0);
    expect(projected.referenceImages).toEqual([]);
    expect(projected.requestMedia.reference_image_media_tokens).toBeUndefined();
  });

  it("keeps a supported unspecified count distinct from legacy defaults", () => {
    const projected = projectPromptVideoReferences(
      { supportsVideoReferences: true },
      state({ referenceVideos: [video("video")] }),
    );

    expect(projected.capabilities.maxReferenceVideos).toBeNull();
    expect(projected.maxVideoCount).toBe(Number.MAX_SAFE_INTEGER);
    expect(projected.acceptsVideos).toBe(true);
    expect(projected.requestMedia.reference_video_media_tokens).toEqual([
      "video-token",
    ]);
  });

  it("keeps usable image UI/request media while rejecting zero-duration video", () => {
    const projected = projectPromptVideoReferences(
      {
        supportsImageReferences: true,
        maxReferenceImages: 1,
        supportsVideoReferences: true,
        maxReferenceVideos: 1,
        maxVideoRefDuration: 0,
      },
      state({
        referenceImages: [image("image")],
        referenceVideos: [video("video")],
      }),
    );

    expect(projected).toMatchObject({
      inputMode: "reference",
      acceptsReferenceImages: true,
      acceptsVideos: false,
      referenceVideos: [],
    });
    expect(projected.requestMedia).toEqual({
      reference_image_media_tokens: ["image-token"],
      reference_video_media_tokens: undefined,
      reference_audio_media_tokens: undefined,
    });
  });

  it("keeps an end-only keyframe target separate from the start-image count", () => {
    const projected = projectPromptVideoReferences(
      { startFrame: false, endFrame: true },
      state({
        referenceImages: [image("stale-start")],
        endFrameImage: image("end"),
      }),
    );

    expect(projected).toMatchObject({
      inputMode: "keyframe",
      maxImageCount: 0,
      acceptsReferenceImages: false,
      acceptsStartFrame: false,
      acceptsEndFrame: true,
      acceptsImages: true,
      referenceImages: [],
    });
    expect(projected.requestMedia).toEqual({
      start_frame_image_media_token: undefined,
      end_frame_image_media_token: "end-token",
    });
  });

  it("normalizes an invalid mode and persists only unsupported model-switch state", () => {
    const current = state({
      referenceImages: [image("first"), image("second")],
      endFrameImage: image("end"),
      referenceVideos: [video("video")],
      referenceAudios: [audio("audio")],
    });
    const projected = projectPromptVideoReferences(
      {
        startFrame: true,
        endFrame: false,
        supportsImageReferences: false,
        supportsVideoReferences: false,
        supportsAudioReferences: false,
      },
      current,
    );
    const setters = {
      setInputMode: vi.fn(),
      setReferenceImages: vi.fn(),
      setEndFrameImage: vi.fn(),
      setReferenceVideos: vi.fn(),
      setReferenceAudios: vi.fn(),
    };

    synchronizePromptVideoReferences(current, projected, setters);

    expect(projected.requestMedia).toEqual({
      start_frame_image_media_token: "first-token",
      end_frame_image_media_token: undefined,
    });
    expect(setters.setInputMode).toHaveBeenCalledWith("keyframe");
    expect(setters.setReferenceImages).toHaveBeenCalledWith([
      expect.objectContaining({ id: "first" }),
    ]);
    expect(setters.setEndFrameImage).toHaveBeenCalledWith(undefined);
    expect(setters.setReferenceVideos).toHaveBeenCalledWith([]);
    expect(setters.setReferenceAudios).toHaveBeenCalledWith([]);
  });

  it("does not write unchanged projected state back to the store", () => {
    const current = state({
      inputMode: "keyframe",
      referenceImages: [image("first")],
    });
    const projected = projectPromptVideoReferences(
      { startFrame: true },
      current,
    );
    const setters = {
      setInputMode: vi.fn(),
      setReferenceImages: vi.fn(),
      setEndFrameImage: vi.fn(),
      setReferenceVideos: vi.fn(),
      setReferenceAudios: vi.fn(),
    };

    synchronizePromptVideoReferences(current, projected, setters);

    expect(
      Object.values(setters).every((setter) => !setter.mock.calls.length),
    ).toBe(true);
  });
});
