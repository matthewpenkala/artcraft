import { describe, expect, it, vi } from "vitest";
import { appendProbedMediaReferenceBatch } from "./media-reference-batch";
import type { TimedMediaReferenceLike } from "./media-reference-state";

const ref = (
  id: string,
  duration: number,
  mediaToken = id,
): TimedMediaReferenceLike => ({ id, mediaToken, duration });

describe("probed media reference batch reconciliation", () => {
  it("appends against state changed while probing instead of restoring a snapshot", async () => {
    let current = [ref("kept", 4)];
    let resolve!: (duration: number | null) => void;
    const pending = appendProbedMediaReferenceBatch(
      [{ id: "new", url: "https://cdn/new.mp4", mediaToken: "new" }],
      {
        isCurrent: () => true,
        getCurrent: () => current,
        publish: (next) => {
          current = next;
        },
        probeDuration: () =>
          new Promise<number | null>((done) => {
            resolve = done;
          }),
        getLimits: () => ({ maxCount: 3, maxTotalSeconds: 15 }),
        toReference: (candidate, duration) =>
          ref(candidate.id, duration, candidate.mediaToken),
      },
    );

    current = [ref("concurrent", 5)];
    resolve(5.4);

    await expect(pending).resolves.toEqual({
      status: "complete",
      added: 1,
      unreadable: 0,
    });
    expect(current.map((item) => item.id)).toEqual(["concurrent", "new"]);
  });

  it("does not publish after clear, policy change, or unmount invalidates the operation", async () => {
    let active = true;
    let resolve!: (duration: number | null) => void;
    const publish = vi.fn();
    const pending = appendProbedMediaReferenceBatch(
      [{ id: "late", url: "https://cdn/late.mp4", mediaToken: "late" }],
      {
        isCurrent: () => active,
        getCurrent: () => [],
        publish,
        probeDuration: () =>
          new Promise<number | null>((done) => {
            resolve = done;
          }),
        getLimits: () => ({ maxCount: 1, maxTotalSeconds: 6 }),
        toReference: (candidate, duration) =>
          ref(candidate.id, duration, candidate.mediaToken),
      },
    );

    active = false;
    resolve(5.4);

    await expect(pending).resolves.toEqual({
      status: "stale",
      added: 0,
      unreadable: 0,
    });
    expect(publish).not.toHaveBeenCalled();
  });

  it("isolates unreadable items and evaluates later candidates against live caps", async () => {
    let current = [ref("existing", 5)];
    const onUnreadable = vi.fn();
    const onRejected = vi.fn();
    const result = await appendProbedMediaReferenceBatch(
      [
        { id: "bad", url: "https://cdn/bad.mp4", mediaToken: "bad" },
        { id: "fits", url: "https://cdn/fits.mp4", mediaToken: "fits" },
        { id: "over", url: "https://cdn/over.mp4", mediaToken: "over" },
      ],
      {
        isCurrent: () => true,
        getCurrent: () => current,
        publish: (next) => {
          current = next;
        },
        probeDuration: async (url) =>
          url.includes("bad") ? null : url.includes("fits") ? 5.4 : 5,
        getLimits: () => ({ maxCount: 3, maxTotalSeconds: 11 }),
        toReference: (candidate, duration) =>
          ref(candidate.id, duration, candidate.mediaToken),
        onUnreadable,
        onRejected,
      },
    );

    expect(result).toEqual({ status: "complete", added: 1, unreadable: 1 });
    expect(current.map((item) => item.id)).toEqual(["existing", "fits"]);
    expect(onUnreadable).toHaveBeenCalledOnce();
    expect(onRejected).toHaveBeenCalledWith(
      expect.objectContaining({ id: "over" }),
      "over-duration",
    );
  });
});
