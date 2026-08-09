import { describe, expect, it } from "vitest";
import { videoStoreToGenerationMode } from "./videoStoreToGenerationMode.js";
import type { RefImage } from "@storyteller/ui-promptbox";

const image = {} as RefImage;

describe("videoStoreToGenerationMode", () => {
  it("keeps video/audio-only reference mode explicit with zero image refs", () => {
    expect(
      videoStoreToGenerationMode("reference", [], undefined, true),
    ).toEqual({
      type: "reference_image_to_video",
      count: 0,
    });
  });

  it("does not use reference mode when the effective projection rejects it", () => {
    expect(
      videoStoreToGenerationMode("reference", [], undefined, false),
    ).toEqual({ type: "text_to_video" });
  });

  it("prices an end-only keyframe request as a single-image generation", () => {
    expect(videoStoreToGenerationMode("keyframe", [], image, false)).toEqual({
      type: "start_frame_to_video",
    });
  });

  it("distinguishes paired start/end keyframes", () => {
    expect(
      videoStoreToGenerationMode("keyframe", [image], image, false),
    ).toEqual({ type: "start_and_end_frame_to_video" });
  });
});
