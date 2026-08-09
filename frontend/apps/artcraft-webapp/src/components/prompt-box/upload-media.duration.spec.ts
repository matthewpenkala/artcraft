import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@storyteller/api", () => ({ MediaUploadApi: class {} }));

import {
  getAudioDuration,
  getAudioDurationFromUrl,
  getVideoDuration,
  getVideoDurationFromUrl,
} from "./upload-media";

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
      get: () => "https://cdn.example/media",
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

describe("webapp upload media duration helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    { kind: "video", read: getVideoDurationFromUrl },
    { kind: "audio", read: getAudioDurationFromUrl },
  ])(
    "keeps nearest-ms $kind metadata and returns null on failure",
    async ({ read }) => {
      mockMetadataDurations([14.9994, null]);

      await expect(read("https://cdn.example/valid")).resolves.toBe(14.999);
      await expect(read("https://cdn.example/unreadable")).resolves.toBeNull();
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
    "times out a hanging $kind probe and revokes its temporary URL exactly once",
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
        lateMetadata?: (event: Event) => unknown;
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
            captured.lateMetadata =
              captured.media?.onloadedmetadata ?? undefined;
          },
        });
        return captured.media;
      }) as typeof document.createElement);

      const result = read(new File(["media"], fileName, { type: mimeType }));
      await vi.advanceTimersByTimeAsync(10_000);

      await expect(result).resolves.toBeNull();
      expect(removeAttribute).toHaveBeenCalledOnce();
      expect(removeAttribute).toHaveBeenCalledWith("src");
      expect(captured.media?.onloadedmetadata).toBeNull();
      expect(captured.media?.onerror).toBeNull();
      expect(revokeObjectURL).toHaveBeenCalledTimes(1);

      captured.lateMetadata?.(new Event("loadedmetadata"));
      await Promise.resolve();
      expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    },
  );
});
