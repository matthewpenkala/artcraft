import { describe, expect, it, vi } from "vitest";
import {
  appendMediaReference,
  commitValidatedRecreatedVideoReferences,
  hydrateMediaDuration,
  hydrateRecreatedReferences,
  hasNonImageRecreatedReferenceContexts,
  prepareMediaReferencesForSubmission,
  validateRecreatedVideoReferences,
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

const capabilities = {
  supportsStartFrame: true,
  supportsEndFrame: true,
  requiresStartFrame: false,
  supportsReferenceMode: true,
  maxReferenceImages: 2,
  maxReferenceVideos: 2,
  maxVideoRefDuration: 11,
  maxReferenceAudios: 1,
  maxAudioRefDuration: 5,
};

describe("transactional Recreate reference hydration", () => {
  it("prefers exact API milliseconds and bounds fallback normalization", async () => {
    const probe = vi.fn(async () => 99);
    await expect(
      hydrateMediaDuration({
        loadDurationMillis: async () => 5_401,
        probeDurationSeconds: probe,
      }),
    ).resolves.toBe(5.401);
    expect(probe).not.toHaveBeenCalled();

    await expect(
      hydrateMediaDuration({
        loadDurationMillis: async () => Number.NaN,
        probeDurationSeconds: async () => 5.599_999_9,
      }),
    ).resolves.toBe(5.6);
    await expect(
      hydrateMediaDuration({
        loadDurationMillis: async () => 0,
        probeDurationSeconds: async () => Number.POSITIVE_INFINITY,
      }),
    ).resolves.toBeNull();
  });

  it("hydrates semantic slots and excludes unreadable or malformed entries", async () => {
    const result = await hydrateRecreatedReferences(
      [
        { semantic: "imgref", mediaToken: "image", url: "image-url" },
        { semantic: "vid_start_frame", mediaToken: "start", url: "start-url" },
        { semantic: "vid_end_frame", mediaToken: "end", url: "end-url" },
        { semantic: "vid_ref", mediaToken: "api", url: "api-url" },
        { semantic: "vid_ref", mediaToken: "fallback", url: "fallback-url" },
        { semantic: "audioref", mediaToken: "bad", url: "bad-url" },
        { semantic: "imgref", mediaToken: "", url: "missing-token" },
      ],
      {
        loadDurationMillis: async (token) => (token === "api" ? 5_401 : null),
        probeVideoDuration: async (url) =>
          url === "fallback-url" ? 9.999_6 : null,
        probeAudioDuration: async () => null,
      },
      "",
    );

    expect(result.referenceImages.map((item) => item.mediaToken)).toEqual([
      "image",
      "start",
    ]);
    expect(result.endFrameImage?.mediaToken).toBe("end");
    expect(result.referenceVideos).toEqual([
      { mediaToken: "api", url: "api-url", duration: 5.401 },
      { mediaToken: "fallback", url: "fallback-url", duration: 10 },
    ]);
    expect(result.referenceAudios).toEqual([]);
    expect(result.excludedReferenceCount).toBe(2);
  });

  it("rejects ambiguous duplicate end-frame records", async () => {
    await expect(
      hydrateRecreatedReferences(
        [
          { semantic: "vid_end_frame", mediaToken: "a", url: "a" },
          { semantic: "vid_end_frame", mediaToken: "b", url: "b" },
        ],
        {
          loadDurationMillis: async () => null,
          probeVideoDuration: async () => null,
          probeAudioDuration: async () => null,
        },
        "",
      ),
    ).rejects.toThrow("multiple end frames");
  });

  it("stable-deduplicates an identical end frame before singleton validation", async () => {
    await expect(
      hydrateRecreatedReferences(
        [
          { semantic: "vid_end_frame", mediaToken: "same", url: "first" },
          { semantic: "vid_end_frame", mediaToken: "same", url: "second" },
        ],
        {
          loadDurationMillis: async () => null,
          probeVideoDuration: async () => null,
          probeAudioDuration: async () => null,
        },
        "",
      ),
    ).resolves.toMatchObject({
      endFrameImage: { mediaToken: "same", url: "first" },
      excludedReferenceCount: 0,
    });
  });

  it("does not let a malformed duplicate suppress a later usable reference", async () => {
    await expect(
      hydrateRecreatedReferences(
        [
          { semantic: "vid_ref", mediaToken: "same", url: "" },
          { semantic: "vid_ref", mediaToken: "same", url: "usable" },
        ],
        {
          loadDurationMillis: async () => 5_000,
          probeVideoDuration: async () => null,
          probeAudioDuration: async () => null,
        },
        "",
      ),
    ).resolves.toMatchObject({
      referenceVideos: [{ mediaToken: "same", url: "usable", duration: 5 }],
    });
  });

  it("rejects exclusions that would rebind or dangle timed ordinal mentions", async () => {
    const dependencies = {
      loadDurationMillis: async (token: string) =>
        token.endsWith("good") ? 5_000 : null,
      probeVideoDuration: async () => null,
      probeAudioDuration: async () => null,
    };

    await expect(
      hydrateRecreatedReferences(
        [
          { semantic: "vid_ref", mediaToken: "video-bad", url: "bad" },
          { semantic: "vid_ref", mediaToken: "video-good", url: "good" },
        ],
        dependencies,
        "Use @Video2 for the final shot",
      ),
    ).rejects.toThrow("cannot preserve @Video2");

    await expect(
      hydrateRecreatedReferences(
        [
          { semantic: "audioref", mediaToken: "audio-bad", url: "bad" },
          { semantic: "audioref", mediaToken: "audio-good", url: "good" },
        ],
        dependencies,
        "Match @Audio1",
      ),
    ).rejects.toThrow("cannot preserve @Audio1");
  });

  it("allows a provably safe unmentioned trailing timed exclusion", async () => {
    await expect(
      hydrateRecreatedReferences(
        [
          { semantic: "vid_ref", mediaToken: "kept", url: "kept" },
          { semantic: "vid_ref", mediaToken: "trailing", url: "trailing" },
        ],
        {
          loadDurationMillis: async (token) =>
            token === "kept" ? 5_000 : null,
          probeVideoDuration: async () => null,
          probeAudioDuration: async () => null,
        },
        "Animate @Video1",
      ),
    ).resolves.toMatchObject({
      referenceVideos: [{ mediaToken: "kept", duration: 5 }],
      excludedReferenceCount: 1,
    });
  });

  it("detects raw non-image semantic contexts before duration hydration", () => {
    expect(
      hasNonImageRecreatedReferenceContexts([
        { semantic: "imgref" },
        { semantic: "vid_ref" },
      ]),
    ).toBe(true);
    expect(
      hasNonImageRecreatedReferenceContexts([
        { semantic: "imgref" },
        { semantic: "vid_start_frame" },
      ]),
    ).toBe(true);
    expect(
      hasNonImageRecreatedReferenceContexts([
        { semantic: "imgref" },
        { semantic: "imgmask" },
      ]),
    ).toBe(false);
  });
});

describe("transactional Recreate validation", () => {
  it("stable-deduplicates transmitted tokens and rejects blank tokens", () => {
    const first = { mediaToken: "same", duration: 5 };
    expect(
      prepareMediaReferencesForSubmission([
        first,
        { mediaToken: "same", duration: 99 },
        { mediaToken: "other", duration: 5 },
      ]),
    ).toEqual([first, { mediaToken: "other", duration: 5 }]);
    expect(
      prepareMediaReferencesForSubmission([{ mediaToken: " ", duration: 5 }]),
    ).toBeNull();
    expect(
      prepareMediaReferencesForSubmission([
        { mediaToken: " padded", duration: 5 },
      ]),
    ).toBeNull();
  });

  it("rejects keyframe-hidden timed references and unsupported end frames", () => {
    expect(
      validateRecreatedVideoReferences(
        {
          imageCount: 1,
          hasEndFrame: false,
          videoDurations: [5],
          audioDurations: [],
        },
        "keyframe",
        capabilities,
      ),
    ).toBe("unsupported-keyframe-reference");
    expect(
      validateRecreatedVideoReferences(
        {
          imageCount: 0,
          hasEndFrame: true,
          videoDurations: [],
          audioDurations: [],
        },
        "keyframe",
        { ...capabilities, supportsEndFrame: false },
      ),
    ).toBe("unsupported-keyframe-reference");
    expect(
      validateRecreatedVideoReferences(
        {
          imageCount: 0,
          hasEndFrame: true,
          videoDurations: [],
          audioDurations: [],
        },
        "keyframe",
        capabilities,
      ),
    ).toBe("valid");
  });

  it("enforces required starts and exact reference-mode caps", () => {
    expect(
      validateRecreatedVideoReferences(
        {
          imageCount: 0,
          hasEndFrame: false,
          videoDurations: [],
          audioDurations: [],
        },
        "keyframe",
        { ...capabilities, requiresStartFrame: true },
      ),
    ).toBe("missing-required-start-frame");
    expect(
      validateRecreatedVideoReferences(
        {
          imageCount: 0,
          hasEndFrame: false,
          videoDurations: [5.6, 5.6],
          audioDurations: [],
        },
        "reference",
        capabilities,
      ),
    ).toBe("over-video-limit");
    expect(
      validateRecreatedVideoReferences(
        {
          imageCount: 0,
          hasEndFrame: false,
          videoDurations: [0],
          audioDurations: [],
        },
        "reference",
        capabilities,
      ),
    ).toBe("invalid-video-duration");
  });

  it("keeps supported unbounded limits distinct from unsupported zero", () => {
    const collections = {
      imageCount: 20,
      hasEndFrame: false,
      videoDurations: [60, 60, 60],
      audioDurations: [90, 90],
    };
    expect(
      validateRecreatedVideoReferences(collections, "reference", {
        ...capabilities,
        maxReferenceImages: null,
        maxReferenceVideos: null,
        maxVideoRefDuration: Number.POSITIVE_INFINITY,
        maxReferenceAudios: null,
        maxAudioRefDuration: Number.POSITIVE_INFINITY,
      }),
    ).toBe("valid");
    expect(
      validateRecreatedVideoReferences(collections, "reference", {
        ...capabilities,
        maxReferenceImages: 0,
        maxReferenceVideos: 0,
        maxVideoRefDuration: 0,
        maxReferenceAudios: 0,
        maxAudioRefDuration: 0,
      }),
    ).toBe("over-image-count");
  });

  it("never invokes a consumer commit for an invalid collection", () => {
    const commit = vi.fn();
    expect(
      commitValidatedRecreatedVideoReferences(
        {
          imageCount: 0,
          hasEndFrame: false,
          videoDurations: [Number.NaN],
          audioDurations: [],
        },
        "reference",
        capabilities,
        commit,
      ),
    ).toBe("invalid-video-duration");
    expect(commit).not.toHaveBeenCalled();
  });
});
