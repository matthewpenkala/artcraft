import { afterEach, describe, expect, it, vi } from "vitest";
import { useCreateAudioStore } from "./create-audio-store";
import { applyAudioLibraryReferenceBatch } from "./audio-library-reference-coordinator";

const candidate = {
  id: "late",
  url: "https://cdn.example/late.mp3",
  mediaToken: "late-token",
};

describe("create-audio library reference consumer", () => {
  afterEach(() => {
    useCreateAudioStore.getState().setReferenceAudios([]);
    useCreateAudioStore.getState().setReferenceImages([]);
  });

  it("does not resurrect cleared audio after a supported model cap changes", async () => {
    let epoch = 1;
    let policy = {
      modelId: "audio-a",
      supported: true,
      maxCount: 2,
      maxTotalSeconds: 600,
    };
    let resolve!: (duration: number | null) => void;
    const publish = vi.fn((next) =>
      useCreateAudioStore.getState().setReferenceAudios(next),
    );
    const pending = applyAudioLibraryReferenceBatch([candidate], {
      operationEpoch: epoch,
      operationModelId: policy.modelId,
      isMounted: () => true,
      getEpoch: () => epoch,
      getPolicy: () => policy,
      getCurrent: () => useCreateAudioStore.getState().referenceAudios,
      publish,
      probeDuration: () =>
        new Promise<number | null>((done) => {
          resolve = done;
        }),
      toReference: (item, duration) => ({ ...item, duration }),
    });

    useCreateAudioStore.getState().setReferenceAudios([]);
    policy = { ...policy, modelId: "audio-b", maxCount: 1 };
    epoch++;
    resolve(5.4);

    await expect(pending).resolves.toEqual({
      status: "stale",
      added: 0,
      unreadable: 0,
    });
    expect(publish).not.toHaveBeenCalled();
    expect(useCreateAudioStore.getState().referenceAudios).toEqual([]);
  });

  it("appends to the live collection after a concurrent addition", async () => {
    const policy = {
      modelId: "audio-a",
      supported: true,
      maxCount: 3,
      maxTotalSeconds: 600,
    };
    let resolve!: (duration: number | null) => void;
    const pending = applyAudioLibraryReferenceBatch([candidate], {
      operationEpoch: 1,
      operationModelId: policy.modelId,
      isMounted: () => true,
      getEpoch: () => 1,
      getPolicy: () => policy,
      getCurrent: () => useCreateAudioStore.getState().referenceAudios,
      publish: (next) =>
        useCreateAudioStore.getState().setReferenceAudios(next),
      probeDuration: () =>
        new Promise<number | null>((done) => {
          resolve = done;
        }),
      toReference: (item, duration) => ({ ...item, duration }),
    });

    useCreateAudioStore.getState().setReferenceAudios([
      {
        id: "concurrent",
        url: "https://cdn.example/concurrent.mp3",
        mediaToken: "concurrent-token",
        duration: 4,
      },
    ]);
    resolve(5.4);

    await expect(pending).resolves.toEqual({
      status: "complete",
      added: 1,
      unreadable: 0,
    });
    expect(
      useCreateAudioStore
        .getState()
        .referenceAudios.map((reference) => reference.id),
    ).toEqual(["concurrent", "late"]);
  });
});
