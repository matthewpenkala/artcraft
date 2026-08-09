import { describe, expect, it } from "vitest";
import {
  getEffectiveVideoReferenceCapabilities,
  projectVideoReferenceMedia,
} from "./VideoReferenceCapabilities.js";

describe("video reference capabilities", () => {
  it.each([
    ["image", true, false, false],
    ["video", false, true, false],
    ["audio", false, false, true],
  ])(
    "derives aggregate reference mode from %s support independently",
    (_label, image, video, audio) => {
      const result = getEffectiveVideoReferenceCapabilities({
        supportsImageReferences: image,
        supportsVideoReferences: video,
        supportsAudioReferences: audio,
      });

      expect(result).toMatchObject({
        supportsImageReferences: image,
        supportsVideoReferences: video,
        supportsAudioReferences: audio,
        supportsReferenceMode: true,
      });
    },
  );

  it("uses zero for unsupported media and no arbitrary defaults for supported media", () => {
    expect(
      getEffectiveVideoReferenceCapabilities({
        supportsImageReferences: false,
        supportsVideoReferences: false,
        supportsAudioReferences: false,
        maxReferenceImages: 9,
        maxReferenceVideos: 3,
        maxReferenceAudios: 2,
      }),
    ).toMatchObject({
      supportsReferenceMode: false,
      maxReferenceImages: 0,
      maxReferenceVideos: 0,
      maxVideoRefDuration: 0,
      maxReferenceAudios: 0,
      maxAudioRefDuration: 0,
    });

    const supportedWithoutLimits = getEffectiveVideoReferenceCapabilities({
      supportsImageReferences: true,
      supportsVideoReferences: true,
      supportsAudioReferences: true,
    });
    expect(supportedWithoutLimits.maxReferenceImages).toBeNull();
    expect(supportedWithoutLimits.maxReferenceVideos).toBeNull();
    expect(supportedWithoutLimits.maxVideoRefDuration).toBe(Infinity);
    expect(supportedWithoutLimits.maxReferenceAudios).toBeNull();
    expect(supportedWithoutLimits.maxAudioRefDuration).toBe(Infinity);
  });

  it("keeps explicit zero limits authoritative and disables an unusable mode", () => {
    expect(
      getEffectiveVideoReferenceCapabilities({
        supportsImageReferences: true,
        supportsVideoReferences: true,
        supportsAudioReferences: true,
        maxReferenceImages: 0,
        maxReferenceVideos: 0,
        maxVideoRefDuration: 0,
        maxReferenceAudios: 0,
        maxAudioRefDuration: 0,
      }),
    ).toMatchObject({
      declaresReferenceMode: true,
      canUseImageReferences: false,
      canUseVideoReferences: false,
      canUseAudioReferences: false,
      supportsReferenceMode: false,
      maxReferenceImages: 0,
      maxReferenceVideos: 0,
      maxVideoRefDuration: 0,
      maxReferenceAudios: 0,
      maxAudioRefDuration: 0,
    });
  });

  it("keeps usable media available when other declared media have zero limits", () => {
    expect(
      getEffectiveVideoReferenceCapabilities({
        supportsImageReferences: true,
        maxReferenceImages: 0,
        supportsVideoReferences: true,
        maxReferenceVideos: 1,
        maxVideoRefDuration: 0,
        supportsAudioReferences: true,
        maxReferenceAudios: 1,
        maxAudioRefDuration: 5,
      }),
    ).toMatchObject({
      declaresReferenceMode: true,
      canUseImageReferences: false,
      canUseVideoReferences: false,
      canUseAudioReferences: true,
      supportsReferenceMode: true,
    });
  });

  it("removes unsupported media, applies count limits, and normalizes mode", () => {
    const image1 = { id: "image-1" };
    const image2 = { id: "image-2" };
    const video = { id: "video", duration: 1 };
    const audio = { id: "audio", duration: 1 };

    expect(
      projectVideoReferenceMedia(
        {
          startFrame: true,
          endFrame: false,
          supportsImageReferences: false,
          supportsVideoReferences: false,
          supportsAudioReferences: false,
        },
        {
          inputMode: "reference",
          referenceImages: [image1, image2],
          endFrameImage: image2,
          referenceVideos: [video],
          referenceAudios: [audio],
        },
      ),
    ).toMatchObject({
      inputMode: "keyframe",
      referenceImages: [image1],
      endFrameImage: undefined,
      referenceVideos: [],
      referenceAudios: [],
    });
  });

  it("projects each reference medium and its count independently", () => {
    const result = projectVideoReferenceMedia(
      {
        supportsImageReferences: true,
        supportsVideoReferences: false,
        supportsAudioReferences: true,
        maxReferenceImages: 1,
        maxReferenceVideos: 5,
        maxVideoRefDuration: 10,
        maxReferenceAudios: 1,
        maxAudioRefDuration: 10,
      },
      {
        inputMode: "reference",
        referenceImages: [{ id: "image-1" }, { id: "image-2" }],
        endFrameImage: { id: "end" },
        referenceVideos: [{ id: "video", duration: 1 }],
        referenceAudios: [
          { id: "audio-1", duration: 1 },
          { id: "audio-2", duration: 1 },
        ],
      },
    );

    expect(result.inputMode).toBe("reference");
    expect(result.referenceImages.map((item) => item.id)).toEqual(["image-1"]);
    expect(result.endFrameImage).toBeUndefined();
    expect(result.referenceVideos).toEqual([]);
    expect(result.referenceAudios.map((item) => item.id)).toEqual(["audio-1"]);
  });

  it("applies aggregate video and audio duration limits on model switch", () => {
    const result = projectVideoReferenceMedia(
      {
        supportsVideoReferences: true,
        supportsAudioReferences: true,
        maxReferenceVideos: 3,
        maxVideoRefDuration: 5,
        maxReferenceAudios: 3,
        maxAudioRefDuration: 4,
      },
      {
        inputMode: "reference",
        referenceImages: [],
        referenceVideos: [
          { id: "video-1", duration: 3 },
          { id: "video-2", duration: 3 },
        ],
        referenceAudios: [
          { id: "audio-1", duration: 2 },
          { id: "audio-2", duration: 2 },
          { id: "audio-3", duration: 1 },
        ],
      },
    );

    expect(result.referenceVideos.map((item) => item.id)).toEqual(["video-1"]);
    expect(result.referenceAudios.map((item) => item.id)).toEqual([
      "audio-1",
      "audio-2",
    ]);
  });

  it.each([
    ["zero", 0],
    ["NaN", Number.NaN],
    ["infinite", Number.POSITIVE_INFINITY],
  ])(
    "fails closed on %s duration before a later valid capped reference",
    (_label, invalidDuration) => {
      const result = projectVideoReferenceMedia(
        {
          supportsVideoReferences: true,
          maxReferenceVideos: 3,
          maxVideoRefDuration: 10,
        },
        {
          inputMode: "reference",
          referenceImages: [],
          referenceVideos: [
            { id: "invalid", duration: invalidDuration },
            { id: "later-valid", duration: 2 },
          ],
          referenceAudios: [],
        },
      );

      expect(result.referenceVideos).toEqual([]);
    },
  );
});
