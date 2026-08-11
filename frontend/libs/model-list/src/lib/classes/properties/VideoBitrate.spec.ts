import { CommonBitrate } from "@storyteller/api-enums";
import { describe, expect, it } from "vitest";
import {
  normalizeVideoBitrateOptions,
  resolveVideoBitrate,
  videoBitrateLabel,
} from "./VideoBitrate.js";

describe("video bitrate capabilities", () => {
  const model = {
    bitrateOptions: [CommonBitrate.Normal, CommonBitrate.High],
    defaultBitrate: CommonBitrate.High,
  };

  it("preserves a legal user or Recreate selection", () => {
    expect(resolveVideoBitrate(model, CommonBitrate.Normal)).toBe(
      CommonBitrate.Normal,
    );
  });

  it("uses the advertised default before the first option", () => {
    expect(resolveVideoBitrate(model, null)).toBe(CommonBitrate.High);
    expect(resolveVideoBitrate(model, "future_bitrate" as CommonBitrate)).toBe(
      CommonBitrate.High,
    );
  });

  it("falls back to the first option when the default is not advertised", () => {
    expect(
      resolveVideoBitrate(
        {
          bitrateOptions: [CommonBitrate.Normal],
          defaultBitrate: CommonBitrate.High,
        },
        null,
      ),
    ).toBe(CommonBitrate.Normal);
  });

  it("omits bitrate for models without advertised options", () => {
    expect(resolveVideoBitrate({}, CommonBitrate.High)).toBeNull();
  });

  it("normalizes known options and rejects unknown listing values", () => {
    expect(
      normalizeVideoBitrateOptions([
        "high",
        "future_bitrate",
        "normal",
        "high",
      ]),
    ).toEqual([CommonBitrate.High, CommonBitrate.Normal]);
    expect(normalizeVideoBitrateOptions([])).toEqual([]);
    expect(normalizeVideoBitrateOptions(null)).toEqual([]);
    expect(normalizeVideoBitrateOptions(undefined)).toBeUndefined();
  });

  it("provides stable display labels", () => {
    expect(videoBitrateLabel(CommonBitrate.Normal)).toBe("Normal");
    expect(videoBitrateLabel(CommonBitrate.High)).toBe("High");
  });
});
