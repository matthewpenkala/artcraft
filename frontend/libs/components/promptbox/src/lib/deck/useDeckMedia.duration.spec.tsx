import { useState, type ReactElement } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastMocks = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("@storyteller/ui-toaster", () => ({
  toast: { error: toastMocks.error },
}));

import { useDeckMedia, type DeckRefLike } from "./useDeckMedia";

interface TestMediaRef extends DeckRefLike {
  file: File;
  duration: number;
}

function useTestDeck(ownGalleryModal = false) {
  const [images, setImages] = useState<DeckRefLike[]>([]);
  const [videos, setVideos] = useState<TestMediaRef[]>([]);
  const [audios, setAudios] = useState<TestMediaRef[]>([]);
  const deck = useDeckMedia({
    referenceImages: images,
    setReferenceImages: setImages,
    maxImages: 3,
    referenceVideos: videos,
    setReferenceVideos: setVideos,
    maxVideos: 3,
    maxVideoTotalSec: 15,
    referenceAudios: audios,
    setReferenceAudios: setAudios,
    maxAudios: 3,
    maxAudioTotalSec: 60,
    ownGalleryModal,
  });
  return { deck, videos, audios };
}

function mockMetadataDurations(durations: Array<number | null>) {
  const originalCreateElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((
    tagName: string,
    options?: ElementCreationOptions,
  ) => {
    const element = originalCreateElement(tagName, options);
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

describe("useDeckMedia duration ingestion", () => {
  beforeEach(() => {
    toastMocks.error.mockReset();
    let nextObjectUrl = 0;
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => `blob:upload-${++nextObjectUrl}`),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("normalizes browser video metadata to the nearest millisecond", async () => {
    mockMetadataDurations([14.9994]);
    const { result } = renderHook(() => useTestDeck());

    await act(async () => {
      await result.current.deck.processVideoFiles([
        new File(["video"], "video.mp4", { type: "video/mp4" }),
      ]);
    });

    expect(result.current.videos[0]?.duration).toBe(14.999);
  });

  it("normalizes browser audio metadata without whole-second rounding", async () => {
    mockMetadataDurations([5.5996]);
    const { result } = renderHook(() => useTestDeck());

    await act(async () => {
      await result.current.deck.processAudioFiles([
        new File(["audio"], "audio.mp3", { type: "audio/mpeg" }),
      ]);
    });

    expect(result.current.audios[0]?.duration).toBe(5.6);
  });

  it("uses current gallery video metadata instead of stale API milliseconds", async () => {
    mockMetadataDurations([6.1996]);
    const { result } = renderHook(() => useTestDeck(true));

    act(() => result.current.deck.openGallery("video"));
    const gallery = result.current.deck.galleryModal as ReactElement<{
      onUseSelected: (
        items: Array<{
          id: string;
          fullImage: string;
          durationMillis?: number;
        }>,
      ) => Promise<void>;
    }>;
    await act(async () => {
      await gallery.props.onUseSelected([
        {
          id: "api-video",
          fullImage: "https://cdn/api-video.mp4",
          durationMillis: 5_400,
        },
      ]);
    });

    expect(result.current.videos[0]?.duration).toBe(6.2);
  });

  it("excludes unreadable gallery videos and warns once for the batch", async () => {
    mockMetadataDurations([null, null]);
    const { result } = renderHook(() => useTestDeck(true));

    act(() => result.current.deck.openGallery("video"));
    const gallery = result.current.deck.galleryModal as ReactElement<{
      onUseSelected: (
        items: Array<{
          id: string;
          fullImage: string;
          durationMillis?: number;
        }>,
      ) => Promise<void>;
    }>;
    await act(async () => {
      await gallery.props.onUseSelected([
        {
          id: "unreadable-a",
          fullImage: "https://cdn/unreadable-a.mp4",
          durationMillis: 5_400,
        },
        {
          id: "unreadable-b",
          fullImage: "https://cdn/unreadable-b.mp4",
          durationMillis: 5_400,
        },
      ]);
    });

    expect(result.current.videos).toHaveLength(0);
    expect(toastMocks.error).toHaveBeenCalledTimes(1);
    expect(toastMocks.error).toHaveBeenCalledWith(
      "Could not read 2 selected videos",
      { id: "video-ref-duration" },
    );
  });

  it("also probes timed gallery audio and excludes unreadable URLs", async () => {
    mockMetadataDurations([6.1996, null]);
    const { result } = renderHook(() => useTestDeck(true));

    act(() => result.current.deck.openGallery("audio"));
    const gallery = result.current.deck.galleryModal as ReactElement<{
      onUseSelected: (
        items: Array<{
          id: string;
          fullImage: string;
          durationMillis?: number;
        }>,
      ) => Promise<void>;
    }>;
    await act(async () => {
      await gallery.props.onUseSelected([
        {
          id: "actual-audio",
          fullImage: "https://cdn/actual-audio.mp3",
          durationMillis: 5_400,
        },
        {
          id: "unreadable-audio",
          fullImage: "https://cdn/unreadable-audio.mp3",
          durationMillis: 5_400,
        },
      ]);
    });

    expect(result.current.audios).toHaveLength(1);
    expect(result.current.audios[0]).toMatchObject({
      mediaToken: "actual-audio",
      duration: 6.2,
    });
    expect(toastMocks.error).toHaveBeenCalledTimes(1);
    expect(toastMocks.error).toHaveBeenCalledWith(
      "Could not read 1 selected audio file",
      { id: "audio-ref-duration" },
    );
  });

  it("settles a hanging gallery probe and ignores its late metadata event", async () => {
    vi.useFakeTimers();
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
      if (tagName !== "video") return element;
      captured.media = element as HTMLMediaElement;
      captured.media.removeAttribute = removeAttribute;
      Object.defineProperty(captured.media, "src", {
        configurable: true,
        set: () => {
          captured.lateMetadata = captured.media?.onloadedmetadata ?? undefined;
        },
      });
      return captured.media;
    }) as typeof document.createElement);

    const { result } = renderHook(() => useTestDeck(true));
    act(() => result.current.deck.openGallery("video"));
    const gallery = result.current.deck.galleryModal as ReactElement<{
      onUseSelected: (
        items: Array<{ id: string; fullImage: string }>,
      ) => Promise<void>;
    }>;

    await act(async () => {
      const pending = gallery.props.onUseSelected([
        { id: "hanging", fullImage: "https://cdn/hanging.mp4" },
      ]);
      await vi.advanceTimersByTimeAsync(10_000);
      await pending;
    });

    expect(result.current.videos).toHaveLength(0);
    expect(removeAttribute).toHaveBeenCalledWith("src");
    expect(captured.media?.onloadedmetadata).toBeNull();
    expect(captured.media?.onerror).toBeNull();
    expect(toastMocks.error).toHaveBeenCalledTimes(1);

    captured.lateMetadata?.(new Event("loadedmetadata"));
    await act(async () => Promise.resolve());
    expect(result.current.videos).toHaveLength(0);
    expect(toastMocks.error).toHaveBeenCalledTimes(1);
  });
});
