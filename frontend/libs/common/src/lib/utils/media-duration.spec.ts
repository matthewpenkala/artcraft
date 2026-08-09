import { describe, expect, it } from "vitest";
import {
  durationMillisToSeconds,
  durationSecondsToMillis,
  formatMediaDurationMillis,
  formatMediaDurationSeconds,
  mediaDurationLimitStatus,
  normalizeMediaDurationMillis,
  normalizeMediaDurationSeconds,
  remainingMediaDurationSeconds,
  sumMediaBillingDurationMillis,
  sumMediaDurationMillis,
  validateMediaReferences,
} from "./media-duration";

describe("media duration precision", () => {
  it("converts seconds and milliseconds without whole-second rounding", () => {
    expect(durationSecondsToMillis(14.999)).toBe(14_999);
    expect(durationMillisToSeconds(14_999)).toBe(14.999);
    expect(normalizeMediaDurationMillis(14_999)).toBe(14.999);
    expect(normalizeMediaDurationSeconds(5.599_999_904_6)).toBe(5.6);
  });

  it("accepts 14.999 seconds under a 15 second cap", () => {
    expect(mediaDurationLimitStatus([14.999], 15)).toBe("within-limit");
  });

  it("rejects 15.001 seconds over a 15 second cap", () => {
    expect(mediaDurationLimitStatus([15.001], 15)).toBe("over-limit");
  });

  it("aggregates decimal durations as integer milliseconds", () => {
    const elevenPointTwo = sumMediaDurationMillis([5.6, 5.6]);
    const tenPointEight = sumMediaDurationMillis([5.4, 5.4]);
    expect(elevenPointTwo).toBe(11_200);
    expect(tenPointEight).toBe(10_800);
    expect(durationMillisToSeconds(elevenPointTwo ?? -1)).toBe(11.2);
    expect(durationMillisToSeconds(tenPointEight ?? -1)).toBe(10.8);
    expect(mediaDurationLimitStatus([5.6, 5.6], 11.2)).toBe("within-limit");
    expect(mediaDurationLimitStatus([5.4, 5.4], 10.799)).toBe("over-limit");
  });

  it("accepts an exact decimal aggregate cap without float overflow", () => {
    const durations = [6.2, 5.4, 3.4];
    expect(sumMediaDurationMillis(durations)).toBe(15_000);
    expect(mediaDurationLimitStatus(durations, 15)).toBe("within-limit");
    expect(remainingMediaDurationSeconds(durations, 15)).toBe(0);
    expect(remainingMediaDurationSeconds([6.2, 5.4], 15)).toBe(3.4);
  });

  it.each([
    [[5.4, 5.4], 12_000],
    [[5.6, 5.6], 12_000],
    [[5, 5], 10_000],
    [[1, 2.001, 2.001, 4.999], 12_000],
    [[5.4, 5.4, 5.4], 18_000],
  ])("ceil-bills each input file independently: %j", (durations, expected) => {
    expect(sumMediaBillingDurationMillis(durations)).toBe(expected);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses an invalid billing duration: %s",
    (duration) => {
      expect(sumMediaBillingDurationMillis([5.4, duration])).toBeNull();
    },
  );

  it("rounds browser floats to the nearest millisecond at the cap edge", () => {
    expect(normalizeMediaDurationSeconds(14.999_499_9)).toBe(14.999);
    expect(normalizeMediaDurationSeconds(14.999_5)).toBe(15);
    expect(mediaDurationLimitStatus([15.000_499_9], 15)).toBe("within-limit");
    expect(mediaDurationLimitStatus([15.000_5], 15)).toBe("over-limit");
  });

  it("refuses invalid duration state at the final validation boundary", () => {
    expect(validateMediaReferences([5.4, 0], 2, 30)).toBe("invalid-duration");
    expect(validateMediaReferences([5.4, 5.4], 1, 30)).toBe("over-count");
    expect(validateMediaReferences([5.4, 5.4], 2, 10.799)).toBe(
      "over-duration",
    );
  });

  it("keeps compact display rounding separate from validation", () => {
    expect(formatMediaDurationSeconds(14.999)).toBe("15");
    expect(formatMediaDurationMillis(14_999)).toBe("15");
    expect(formatMediaDurationSeconds(5.599_999_904_6)).toBe("5.6");
    expect(formatMediaDurationSeconds(0)).toBe("0");
    expect(mediaDurationLimitStatus([14.999], 15)).toBe("within-limit");
  });

  it("fails closed for invalid or unknown metadata", () => {
    for (const duration of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(normalizeMediaDurationSeconds(duration)).toBeNull();
      expect(mediaDurationLimitStatus([duration], 15)).toBe("invalid");
    }
    expect(durationMillisToSeconds(1.5)).toBeNull();
    expect(normalizeMediaDurationMillis(0)).toBeNull();
    expect(formatMediaDurationSeconds(Number.NaN)).toBe("—");
    expect(formatMediaDurationMillis(1.5)).toBe("—");
  });
});
