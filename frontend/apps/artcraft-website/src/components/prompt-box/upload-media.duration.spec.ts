import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@storyteller/api", () => ({ MediaUploadApi: class {} }));

import { getAudioDuration, getVideoDuration } from "./upload-media";

function mockMetadataDurations(durations: Array<number | null>) {
  const originalCreateElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
    const element = originalCreateElement(tagName);
    if (tagName !== "video" && tagName !== "audio") return element;
    const duration = durations.shift();
    if (duration === undefined) throw new Error("missing mocked duration");
    Object.defineProperty(element, "duration", {
      configurable: true,
      value: duration ?? Number.NaN,
    });
    Object.defineProperty(element, "src", {
      configurable: true,
      get: () => "blob:metadata",
      set: () => {
        queueMicrotask(() => {
          if (duration == null) element.onerror?.(new Event("error"));
          else element.onloadedmetadata?.(new Event("loadedmetadata"));
        });
      },
    });
    return element;
  }) as typeof document.createElement);
}

describe("website upload media duration helpers", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:metadata"),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    {
      kind: "video",
      read: getVideoDuration,
      fileName: "video.mp4",
      mimeType: "video/mp4",
    },
    {
      kind: "audio",
      read: getAudioDuration,
      fileName: "audio.mp3",
      mimeType: "audio/mpeg",
    },
  ])(
    "keeps nearest-ms $kind metadata and returns zero on failure",
    async ({ read, fileName, mimeType }) => {
      mockMetadataDurations([14.9994, null]);
      const valid = new File(["media"], `valid-${fileName}`, {
        type: mimeType,
      });
      const unreadable = new File(["media"], `unreadable-${fileName}`, {
        type: mimeType,
      });

      await expect(read(valid)).resolves.toBe(14.999);
      await expect(read(unreadable)).resolves.toBe(0);
    },
  );

  it.each([
    {
      kind: "video",
      read: getVideoDuration,
      fileName: "video.mp4",
      mimeType: "video/mp4",
    },
    {
      kind: "audio",
      read: getAudioDuration,
      fileName: "audio.mp3",
      mimeType: "audio/mpeg",
    },
  ])(
    "times out a hanging $kind probe, cleans handlers, and revokes once",
    async ({ read, fileName, mimeType }) => {
      vi.useFakeTimers();
      const revokeObjectURL = vi.fn();
      vi.stubGlobal("URL", {
        createObjectURL: vi.fn(() => "blob:hanging-media"),
        revokeObjectURL,
      });

      const originalCreateElement = document.createElement.bind(document);
      const captured: {
        media?: HTMLMediaElement;
        lateError?: (event: Event | string) => unknown;
      } = {};
      const removeAttribute = vi.fn();
      vi.spyOn(document, "createElement").mockImplementation(((
        tagName: string,
      ) => {
        const element = originalCreateElement(tagName);
        if (tagName !== "video" && tagName !== "audio") return element;
        captured.media = element as HTMLMediaElement;
        captured.media.removeAttribute = removeAttribute;
        Object.defineProperty(captured.media, "src", {
          configurable: true,
          set: () => {
            captured.lateError = captured.media?.onerror ?? undefined;
          },
        });
        return captured.media;
      }) as typeof document.createElement);

      const result = read(new File(["media"], fileName, { type: mimeType }));
      await vi.advanceTimersByTimeAsync(10_000);

      await expect(result).resolves.toBe(0);
      expect(removeAttribute).toHaveBeenCalledWith("src");
      expect(captured.media?.onloadedmetadata).toBeNull();
      expect(captured.media?.onerror).toBeNull();
      expect(revokeObjectURL).toHaveBeenCalledTimes(1);

      captured.lateError?.(new Event("error"));
      await Promise.resolve();
      expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    },
  );
});
