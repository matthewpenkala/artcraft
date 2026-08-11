import { CommonBitrate } from "@storyteller/api-enums";
import { beforeEach, describe, expect, it } from "vitest";
import { usePromptVideoStore } from "./promptStore.js";

describe("PromptVideoStore bitrate state", () => {
  beforeEach(() => {
    usePromptVideoStore.getState().setBitrate(null);
  });

  it("stores an explicit selection for Generate and Recreate consumers", () => {
    usePromptVideoStore.getState().setBitrate(CommonBitrate.High);

    expect(usePromptVideoStore.getState().bitrate).toBe(CommonBitrate.High);
  });

  it("can clear a stale selection", () => {
    const store = usePromptVideoStore.getState();
    store.setBitrate(CommonBitrate.Normal);
    store.setBitrate(null);

    expect(usePromptVideoStore.getState().bitrate).toBeNull();
  });

  it("atomically replaces a stale selection during Recreate", () => {
    const store = usePromptVideoStore.getState();
    store.setBitrate(CommonBitrate.High);
    store.commitRecreate({
      prompt: "restored",
      resolution: "720p",
      aspectRatio: null,
      bitrate: null,
      referenceImages: [],
      endFrameImage: undefined,
      referenceVideos: [],
      referenceAudios: [],
      generateWithSound: false,
      duration: 5,
      inputMode: "keyframe",
      generationCount: 1,
    });

    expect(usePromptVideoStore.getState()).toMatchObject({
      prompt: "restored",
      bitrate: null,
    });
  });
});
