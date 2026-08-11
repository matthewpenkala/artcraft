import { describe, expect, it, vi } from "vitest";
import { generateBeforeNotifying } from "./generationEnqueueControl.js";

describe("desktop generation enqueue publication", () => {
  it("publishes neither metadata nor a pending job when generation rejects", async () => {
    const error = new Error("rejected");
    const storeEnqueueMetadata = vi.fn();
    const notifyEnqueued = vi.fn();

    await expect(
      generateBeforeNotifying(
        () => Promise.reject(error),
        () => {
          storeEnqueueMetadata();
          notifyEnqueued();
        },
      ),
    ).resolves.toEqual({ ok: false, error });
    expect(storeEnqueueMetadata).not.toHaveBeenCalled();
    expect(notifyEnqueued).not.toHaveBeenCalled();
  });

  it("publishes metadata once before announcing an accepted job", async () => {
    const storeEnqueueMetadata = vi.fn();
    const notifyEnqueued = vi.fn();

    await expect(
      generateBeforeNotifying(
        () => Promise.resolve("accepted"),
        () => {
          storeEnqueueMetadata();
          notifyEnqueued();
        },
      ),
    ).resolves.toEqual({ ok: true, value: "accepted" });
    expect(storeEnqueueMetadata).toHaveBeenCalledTimes(1);
    expect(notifyEnqueued).toHaveBeenCalledTimes(1);
    expect(storeEnqueueMetadata.mock.invocationCallOrder[0]).toBeLessThan(
      notifyEnqueued.mock.invocationCallOrder[0],
    );
  });
});
