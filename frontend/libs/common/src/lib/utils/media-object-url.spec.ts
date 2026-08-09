import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createOwnedMediaObjectUrl,
  discardOwnedMediaObjectUrl,
  isOwnedMediaObjectUrl,
  reconcileOwnedMediaObjectUrlOwners,
  reconcileOwnedMediaObjectUrls,
  resetOwnedMediaObjectUrlsForTests,
  withTemporaryMediaObjectUrl,
} from "./media-object-url";

describe("media object URL ownership", () => {
  let nextUrl = 0;
  let revokeObjectUrl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    nextUrl = 0;
    revokeObjectUrl = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => `blob:owned-${++nextUrl}`),
      revokeObjectURL: revokeObjectUrl,
    });
  });

  afterEach(() => {
    resetOwnedMediaObjectUrlsForTests();
    vi.unstubAllGlobals();
  });

  it("never infers ownership from a borrowed blob URL", () => {
    reconcileOwnedMediaObjectUrls("store", [], ["blob:borrowed"]);
    reconcileOwnedMediaObjectUrls("store", ["blob:borrowed"], []);
    expect(discardOwnedMediaObjectUrl("blob:borrowed")).toBe(false);
    expect(revokeObjectUrl).not.toHaveBeenCalled();
  });

  it("revokes an owned URL exactly once after its final owner releases it", () => {
    const url = createOwnedMediaObjectUrl(new Blob(["video"]));
    reconcileOwnedMediaObjectUrls("mobile", [], [url]);
    reconcileOwnedMediaObjectUrls("desktop", [], [url]);

    expect(discardOwnedMediaObjectUrl(url)).toBe(false);
    reconcileOwnedMediaObjectUrls("mobile", [url], []);
    expect(isOwnedMediaObjectUrl(url)).toBe(true);
    reconcileOwnedMediaObjectUrls("desktop", [url], []);
    reconcileOwnedMediaObjectUrls("desktop", [url], []);

    expect(isOwnedMediaObjectUrl(url)).toBe(false);
    expect(revokeObjectUrl).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith(url);
  });

  it("keeps a URL alive while the same store retains it across navigation", () => {
    const url = createOwnedMediaObjectUrl(new Blob(["frame"]));
    reconcileOwnedMediaObjectUrls("pending", [], [url]);
    reconcileOwnedMediaObjectUrls("destination", [], [url]);
    reconcileOwnedMediaObjectUrls("pending", [url], []);

    expect(revokeObjectUrl).not.toHaveBeenCalled();
    reconcileOwnedMediaObjectUrls("destination", [url], []);
    expect(revokeObjectUrl).toHaveBeenCalledTimes(1);
  });

  it("registers all next fields before releasing any previous field", () => {
    const url = createOwnedMediaObjectUrl(new Blob(["frame"]));
    reconcileOwnedMediaObjectUrlOwners([
      { owner: "first", previousUrls: [], nextUrls: [url] },
      { owner: "last", previousUrls: [], nextUrls: [] },
    ]);

    reconcileOwnedMediaObjectUrlOwners([
      { owner: "first", previousUrls: [url], nextUrls: [] },
      { owner: "last", previousUrls: [], nextUrls: [url] },
    ]);

    expect(revokeObjectUrl).not.toHaveBeenCalled();
    expect(isOwnedMediaObjectUrl(url)).toBe(true);

    reconcileOwnedMediaObjectUrlOwners([
      { owner: "first", previousUrls: [], nextUrls: [] },
      { owner: "last", previousUrls: [url], nextUrls: [] },
    ]);
    expect(revokeObjectUrl).toHaveBeenCalledTimes(1);
  });

  it("always releases temporary URLs on resolve and rejection", async () => {
    await expect(
      withTemporaryMediaObjectUrl(new Blob(["ok"]), async () => "done"),
    ).resolves.toBe("done");
    await expect(
      withTemporaryMediaObjectUrl(new Blob(["bad"]), async () => {
        throw new Error("probe failed");
      }),
    ).rejects.toThrow("probe failed");

    expect(revokeObjectUrl).toHaveBeenCalledTimes(2);
  });
});
