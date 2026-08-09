import { describe, expect, it } from "vitest";
import {
  appendMediaReference,
  type TimedMediaReferenceLike,
} from "./media-reference-state";

const ref = (
  id: string,
  duration: number,
  mediaToken = id,
): TimedMediaReferenceLike => ({ id, mediaToken, duration });

describe("media reference append reconciliation", () => {
  it("atomically reconciles concurrent A/B completions against fresh state", async () => {
    let current: TimedMediaReferenceLike[] = [];
    const complete = async (
      candidate: TimedMediaReferenceLike,
      release: Promise<void>,
    ) => {
      await release;
      const result = appendMediaReference(current, candidate, {
        maxCount: 2,
        maxTotalSeconds: 10,
      });
      if (result.status === "added") current = result.next;
      return result.status;
    };
    let releaseA!: () => void;
    let releaseB!: () => void;
    const a = complete(
      ref("a", 5),
      new Promise((resolve) => (releaseA = resolve)),
    );
    const b = complete(
      ref("b", 5),
      new Promise((resolve) => (releaseB = resolve)),
    );

    releaseB();
    releaseA();
    await expect(Promise.all([a, b])).resolves.toEqual(["added", "added"]);
    expect(current.map((item) => item.id).sort()).toEqual(["a", "b"]);
  });

  it("allows only one completion when A/B share the last slot", async () => {
    let current: TimedMediaReferenceLike[] = [];
    const complete = async (
      candidate: TimedMediaReferenceLike,
      release: Promise<void>,
    ) => {
      await release;
      const result = appendMediaReference(current, candidate, {
        maxCount: 1,
        maxTotalSeconds: 10,
      });
      if (result.status === "added") current = result.next;
      return result.status;
    };
    let releaseA!: () => void;
    let releaseB!: () => void;
    const a = complete(
      ref("a", 5),
      new Promise((resolve) => (releaseA = resolve)),
    );
    const b = complete(
      ref("b", 5),
      new Promise((resolve) => (releaseB = resolve)),
    );

    releaseA();
    releaseB();
    expect((await Promise.all([a, b])).sort()).toEqual(["added", "over-count"]);
    expect(current).toHaveLength(1);
  });

  it("uses the current collection after a deferred upload and removal", async () => {
    let current = [ref("removed", 4)];
    let release!: () => void;
    const completion = (async () => {
      await new Promise<void>((resolve) => (release = resolve));
      const result = appendMediaReference(current, ref("upload", 5), {
        maxCount: 2,
        maxTotalSeconds: 10,
      });
      if (result.status === "added") current = result.next;
    })();

    current = [];
    release();
    await completion;
    expect(current).toEqual([ref("upload", 5)]);
  });

  it("deduplicates identity and token while preserving distinct equal durations", () => {
    const first = appendMediaReference([], ref("a", 5.4), {
      maxCount: 2,
      maxTotalSeconds: 11,
    });
    expect(first.status).toBe("added");
    expect(
      appendMediaReference(first.next, ref("duplicate-id", 1, "a"), {
        maxCount: 2,
        maxTotalSeconds: 11,
      }).status,
    ).toBe("duplicate");
    expect(
      appendMediaReference(first.next, ref("b", 5.4), {
        maxCount: 2,
        maxTotalSeconds: 11,
      }).status,
    ).toBe("added");
  });

  it("fails closed on invalid, count, and cumulative duration states", () => {
    expect(
      appendMediaReference([], ref("invalid", 0), {
        maxCount: 2,
        maxTotalSeconds: 11,
      }).status,
    ).toBe("invalid-duration");
    expect(
      appendMediaReference([ref("a", 5)], ref("b", 5), {
        maxCount: 1,
        maxTotalSeconds: 11,
      }).status,
    ).toBe("over-count");
    expect(
      appendMediaReference([ref("a", 5.4)], ref("b", 5.601), {
        maxCount: 2,
        maxTotalSeconds: 11,
      }).status,
    ).toBe("over-duration");
  });
});
