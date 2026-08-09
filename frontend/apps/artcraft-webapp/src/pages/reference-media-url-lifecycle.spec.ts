import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createOwnedMediaObjectUrl,
  discardOwnedMediaObjectUrl,
  reconcileOwnedMediaObjectUrls,
  resetOwnedMediaObjectUrlsForTests,
} from "@storyteller/common";
import { useCreateImageStore } from "./create-image/create-image-store";
import { useCreateVideoStore } from "./create-video/create-video-store";

describe("production reference store URL ownership", () => {
  const revokeObjectUrl = vi.fn();
  let sequence = 0;

  beforeEach(() => {
    sequence = 0;
    revokeObjectUrl.mockReset();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => `blob:store-${++sequence}`),
      revokeObjectURL: revokeObjectUrl,
    });
  });

  afterEach(() => {
    useCreateImageStore.getState().setReferenceImages([]);
    useCreateImageStore.getState().setPendingRefImages(null);
    useCreateVideoStore.getState().setRefs({
      referenceImages: [],
      endFrameImage: undefined,
      referenceVideos: [],
      referenceAudios: [],
    });
    useCreateVideoStore.getState().setPendingRefImages(null);
    useCreateVideoStore.getState().setPendingRefVideos(null);
    resetOwnedMediaObjectUrlsForTests();
    vi.unstubAllGlobals();
  });

  it("transfers an owned frame from pending navigation state before release", () => {
    const url = createOwnedMediaObjectUrl(new Blob(["frame"]));
    const reference = {
      id: "frame",
      url,
      file: new File(["frame"], "frame.png"),
      mediaToken: "frame-token",
    };

    useCreateImageStore.getState().setPendingRefImages([reference]);
    expect(discardOwnedMediaObjectUrl(url)).toBe(false);
    useCreateImageStore.getState().setReferenceImages([reference]);
    useCreateImageStore.getState().setPendingRefImages(null);
    expect(revokeObjectUrl).not.toHaveBeenCalled();

    useCreateImageStore.getState().setReferenceImages([]);
    expect(revokeObjectUrl).toHaveBeenCalledTimes(1);
  });

  it("keeps a shared URL alive across image and video consumers", () => {
    const url = createOwnedMediaObjectUrl(new Blob(["shared"]));
    const reference = {
      id: "shared",
      url,
      file: new File(["shared"], "shared.png"),
      mediaToken: "shared-token",
    };

    useCreateImageStore.getState().setReferenceImages([reference]);
    useCreateVideoStore.getState().setRefs({ referenceImages: [reference] });
    useCreateImageStore.getState().setReferenceImages([]);
    expect(revokeObjectUrl).not.toHaveBeenCalled();

    useCreateVideoStore.getState().setRefs({ referenceImages: [] });
    expect(revokeObjectUrl).toHaveBeenCalledTimes(1);
  });

  it("keeps an extracted frame alive after its destination releases it", () => {
    const url = createOwnedMediaObjectUrl(new Blob(["frame"]));
    const reference = {
      id: "frame-retained",
      url,
      file: new File(["frame"], "frame.png"),
      mediaToken: "frame-token",
    };

    reconcileOwnedMediaObjectUrls("extractor-frame-list", [], [url]);
    useCreateImageStore.getState().setPendingRefImages([reference]);
    useCreateImageStore.getState().setReferenceImages([reference]);
    useCreateImageStore.getState().setPendingRefImages(null);
    useCreateImageStore.getState().setReferenceImages([]);

    expect(revokeObjectUrl).not.toHaveBeenCalled();
    reconcileOwnedMediaObjectUrls("extractor-frame-list", [url], []);
    expect(revokeObjectUrl).toHaveBeenCalledTimes(1);
  });

  it("moves one owned frame between video fields without revoking it", () => {
    const url = createOwnedMediaObjectUrl(new Blob(["frame"]));
    const reference = {
      id: "cross-field",
      url,
      file: new File(["frame"], "frame.png"),
      mediaToken: "frame-token",
    };

    useCreateVideoStore.getState().setRefs({ referenceImages: [reference] });
    useCreateVideoStore.getState().setRefs({
      referenceImages: [],
      endFrameImage: reference,
    });
    expect(revokeObjectUrl).not.toHaveBeenCalled();

    useCreateVideoStore.getState().setRefs({ endFrameImage: undefined });
    expect(revokeObjectUrl).toHaveBeenCalledTimes(1);
  });

  it("never revokes borrowed blob-looking URLs on a store clear", () => {
    useCreateImageStore.getState().setReferenceImages([
      {
        id: "borrowed",
        url: "blob:borrowed",
        file: new File(["borrowed"], "borrowed.png"),
        mediaToken: "borrowed-token",
      },
    ]);
    useCreateImageStore.getState().setReferenceImages([]);

    expect(revokeObjectUrl).not.toHaveBeenCalled();
  });
});
