import { describe, expect, it, vi } from "vitest";
import { resolvePendingRecreateTargetModel } from "./pending-recreate-model";

const models = [{ model: "default-model" }, { model: "exact-model" }];

describe("resolvePendingRecreateTargetModel", () => {
  it("refuses an explicit unavailable model before commit or navigation", () => {
    const payload = { modelId: "unavailable-model" };
    const clearAndReport = vi.fn();
    const commit = vi.fn();
    const navigate = vi.fn();

    const target = resolvePendingRecreateTargetModel({
      payload,
      currentPending: payload,
      models,
      defaultModelId: "default-model",
      onUnavailable: clearAndReport,
    });
    if (target) {
      commit(target);
      navigate();
    }

    expect(target).toBeNull();
    expect(clearAndReport).toHaveBeenCalledWith("unavailable-model");
    expect(commit).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("does not clear a newer pending payload", () => {
    const payload = { modelId: "unavailable-model" };
    const clearAndReport = vi.fn();

    expect(
      resolvePendingRecreateTargetModel({
        payload,
        currentPending: { modelId: "newer-model" },
        models,
        defaultModelId: "default-model",
        onUnavailable: clearAndReport,
      }),
    ).toBeNull();
    expect(clearAndReport).not.toHaveBeenCalled();
  });

  it("uses the exact explicit model instead of the default", () => {
    const payload = { modelId: "exact-model" };

    expect(
      resolvePendingRecreateTargetModel({
        payload,
        currentPending: payload,
        models,
        defaultModelId: "default-model",
        onUnavailable: vi.fn(),
      }),
    ).toBe(models[1]);
  });
});
