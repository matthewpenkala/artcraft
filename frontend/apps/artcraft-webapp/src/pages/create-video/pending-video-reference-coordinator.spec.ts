import { afterEach, describe, expect, it, vi } from "vitest";
import { useCreateVideoStore } from "./create-video-store";
import { applyPendingVideoReferenceBatch } from "./pending-video-reference-coordinator";

const reference = (id: string, duration: number) => ({
  id,
  url: `https://cdn/${id}.mp4`,
  mediaToken: `${id}-token`,
  duration,
});

describe("pending video reference consumer", () => {
  afterEach(() => {
    useCreateVideoStore.getState().setRefs({ referenceVideos: [] });
    useCreateVideoStore.getState().setPendingRefVideos(null);
  });

  it("lets fast B win while slow A cannot resurrect removed refs or exceed cap", async () => {
    const removed = reference("removed", 4);
    const batchA = [reference("A", 0)];
    const batchB = [reference("B", 5.6)];
    useCreateVideoStore.getState().setRefs({ referenceVideos: [removed] });
    useCreateVideoStore.getState().setPendingRefVideos(batchA);

    let resolveA!: (duration: number | null) => void;
    const slowProbe = vi.fn(
      () => new Promise<number | null>((resolve) => (resolveA = resolve)),
    );
    const run = (batch: typeof batchA, probeDuration: typeof slowProbe) =>
      applyPendingVideoReferenceBatch(batch, {
        isCurrent: () =>
          useCreateVideoStore.getState().pendingRefVideos === batch,
        getCurrent: () => useCreateVideoStore.getState().refs.referenceVideos,
        publish: (next) =>
          useCreateVideoStore.getState().setRefs({ referenceVideos: next }),
        probeDuration,
        limits: { maxCount: 1, maxTotalSeconds: 6 },
      });

    const slowA = run(batchA, slowProbe);
    useCreateVideoStore.getState().setRefs({ referenceVideos: [] });
    useCreateVideoStore.getState().setPendingRefVideos(batchB);
    const fastB = run(
      batchB,
      vi.fn(async () => 5.6),
    );
    await expect(fastB).resolves.toEqual({ status: "complete", added: 1 });

    resolveA(5.4);
    await expect(slowA).resolves.toEqual({ status: "stale", added: 0 });
    expect(
      useCreateVideoStore
        .getState()
        .refs.referenceVideos.map((item) => item.id),
    ).toEqual(["B"]);
  });

  it("treats a supported-to-supported policy change as stale", async () => {
    const batch = [reference("pending", 5.4)];
    useCreateVideoStore.getState().setPendingRefVideos(batch);
    let active = true;
    let resolveProbe!: (duration: number | null) => void;
    const publish = vi.fn();
    const operation = applyPendingVideoReferenceBatch(batch, {
      isCurrent: () =>
        active && useCreateVideoStore.getState().pendingRefVideos === batch,
      getCurrent: () => [],
      publish,
      probeDuration: () =>
        new Promise<number | null>((resolve) => {
          resolveProbe = resolve;
        }),
      limits: { maxCount: 2, maxTotalSeconds: 15 },
    });

    active = false;
    resolveProbe(5.4);

    await expect(operation).resolves.toEqual({ status: "stale", added: 0 });
    expect(publish).not.toHaveBeenCalled();
  });
});
