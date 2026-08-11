import { describe, expect, it } from "vitest";
import {
  resolveTargetModelCount,
  resolveTargetModelOption,
} from "./model-setting";

describe("target-model Recreate setting normalization", () => {
  it("keeps supported options and replaces stale values deterministically", () => {
    expect(resolveTargetModelOption("two_k", ["one_k", "two_k"], "one_k")).toBe(
      "two_k",
    );
    expect(
      resolveTargetModelOption("four_k", ["one_k", "two_k"], "one_k"),
    ).toBe("one_k");
    expect(resolveTargetModelOption("four_k", ["one_k", "two_k"], "bad")).toBe(
      "one_k",
    );
  });

  it("retains legacy values when no option list is advertised", () => {
    expect(resolveTargetModelOption("wide", undefined, "square")).toBe("wide");
    expect(resolveTargetModelOption(undefined, undefined, "square")).toBe(
      "square",
    );
  });

  it("clamps and snaps restored batch counts to the target contract", () => {
    expect(resolveTargetModelCount(9, [1, 2, 4], 1, 4, 2)).toBe(4);
    expect(resolveTargetModelCount(3, [1, 2, 4], 1, 4, 2)).toBe(2);
    expect(resolveTargetModelCount(undefined, [1, 2, 4], 1, 4, 2)).toBe(2);
    expect(resolveTargetModelCount(Number.NaN, undefined, 2, 3, 9)).toBe(3);
  });
});
