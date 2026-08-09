import { describe, expect, it } from "vitest";
import { buildVideoCostEstimateRequest } from "./video-cost-estimate";

const base = {
  model: "video-model",
  hasStartFrame: false,
  hasEndFrame: false,
  isReferenceMode: true,
  referenceImageCount: 0,
};

const videoPairs = (durations: readonly number[]) =>
  durations.map((durationSeconds, index) => ({
    mediaToken: `video-${index}`,
    durationSeconds,
  }));

describe("video estimate reference hints", () => {
  it.each([
    [[5.4, 5.4], [5_400, 5_400], 10_800],
    [[5.6, 5.6], [5_600, 5_600], 11_200],
    [[5, 5], [5_000, 5_000], 10_000],
    [[1, 2.001, 2.001, 4.999], [1_000, 2_001, 2_001, 4_999], 10_001],
    [[5.4, 5.4, 5.4], [5_400, 5_400, 5_400], 16_200],
  ])(
    "preserves per-file millis for backend billing for %j",
    (durations, perFile, rawTotal) => {
      const request = buildVideoCostEstimateRequest({
        ...base,
        referenceVideoDurationPairs: videoPairs(durations),
      });

      expect(request?.reference_video_media_tokens).toHaveLength(
        durations.length,
      );
      expect(request?.estimate_only?.reference_video_durations_millis).toEqual(
        perFile,
      );
      expect(request?.estimate_only?.total_input_video_duration_millis).toBe(
        rawTotal,
      );
    },
  );

  it("preserves equal-duration videos when their media tokens differ", () => {
    const request = buildVideoCostEstimateRequest({
      ...base,
      referenceImageCount: 2,
      referenceVideoDurationPairs: [
        { mediaToken: "video-a", durationSeconds: 5.4 },
        { mediaToken: "video-b", durationSeconds: 5.4 },
      ],
      referenceAudioDurationPairs: [
        { mediaToken: "audio-a", durationSeconds: 5.6 },
        { mediaToken: "audio-b", durationSeconds: 5.6 },
      ],
    });

    expect(request).toMatchObject({
      reference_image_media_tokens: ["placeholder", "placeholder"],
      reference_video_media_tokens: ["video-a", "video-b"],
      reference_audio_media_tokens: ["audio-a", "audio-b"],
      estimate_only: {
        reference_video_durations_millis: [5_400, 5_400],
        total_input_video_duration_millis: 10_800,
        total_input_audio_duration_millis: 11_200,
      },
    });
  });

  it("stable-deduplicates by media token and retains the first duration", () => {
    const request = buildVideoCostEstimateRequest({
      ...base,
      referenceVideoDurationPairs: [
        { mediaToken: "same-video", durationSeconds: 5.4 },
        { mediaToken: "same-video", durationSeconds: 9.9 },
        { mediaToken: "other-video", durationSeconds: 5.4 },
      ],
      referenceAudioDurationPairs: [
        { mediaToken: "same-audio", durationSeconds: 5.6 },
        { mediaToken: "same-audio", durationSeconds: 9.9 },
      ],
    });

    expect(request).toMatchObject({
      reference_video_media_tokens: ["same-video", "other-video"],
      reference_audio_media_tokens: ["same-audio"],
      estimate_only: {
        reference_video_durations_millis: [5_400, 5_400],
        total_input_video_duration_millis: 10_800,
        total_input_audio_duration_millis: 5_600,
      },
    });
  });

  it("fails closed when a duration pair has no usable media token", () => {
    expect(
      buildVideoCostEstimateRequest({
        ...base,
        referenceVideoDurationPairs: [{ mediaToken: "", durationSeconds: 5.4 }],
      }),
    ).toBeNull();
    expect(
      buildVideoCostEstimateRequest({
        ...base,
        referenceAudioDurationPairs: [
          {
            mediaToken: undefined as unknown as string,
            durationSeconds: 5.6,
          },
        ],
      }),
    ).toBeNull();
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "fails closed for an invalid video duration: %s",
    (duration) => {
      expect(
        buildVideoCostEstimateRequest({
          ...base,
          referenceVideoDurationPairs: [
            { mediaToken: "video", durationSeconds: duration },
          ],
        }),
      ).toBeNull();
    },
  );

  it.each([0, Number.NaN, Number.POSITIVE_INFINITY])(
    "fails closed for an invalid audio duration: %s",
    (duration) => {
      expect(
        buildVideoCostEstimateRequest({
          ...base,
          referenceAudioDurationPairs: [
            { mediaToken: "audio", durationSeconds: duration },
          ],
        }),
      ).toBeNull();
    },
  );

  it("fails closed before serializing duration millis outside Rust u32", () => {
    expect(
      buildVideoCostEstimateRequest({
        ...base,
        referenceVideoDurationPairs: [
          {
            mediaToken: "video",
            durationSeconds: 0xffff_ffff / 1_000 + 0.001,
          },
        ],
      }),
    ).toBeNull();
    expect(
      buildVideoCostEstimateRequest({
        ...base,
        referenceAudioDurationPairs: [
          {
            mediaToken: "audio",
            durationSeconds: 0xffff_ffff / 1_000 + 0.001,
          },
        ],
      }),
    ).toBeNull();
  });

  it("uses frame fields without reference-only estimate hints", () => {
    expect(
      buildVideoCostEstimateRequest({
        ...base,
        isReferenceMode: false,
        hasStartFrame: true,
        hasEndFrame: true,
      }),
    ).toMatchObject({
      start_frame_image_media_token: "placeholder",
      end_frame_image_media_token: "placeholder",
    });
  });
});
