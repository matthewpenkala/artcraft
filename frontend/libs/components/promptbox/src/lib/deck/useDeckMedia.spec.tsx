import { act, renderHook, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UploadMediaFn } from "@storyteller/api";
import {
  reconcileOwnedMediaObjectUrls,
  resetOwnedMediaObjectUrlsForTests,
  UploaderStates,
} from "@storyteller/common";
import { useDeckMedia } from "./useDeckMedia";

interface TestMediaRef {
  id: string;
  url: string;
  file: File;
  mediaToken: string;
  duration: number;
}

interface TestImageRef {
  id: string;
  url: string;
  file: File;
  mediaToken: string;
}

function useOwnedImageDeck(
  initialImages: TestImageRef[],
  uploadImage: UploadMediaFn,
) {
  const [images, setImages] = useState(initialImages);
  const deck = useDeckMedia({
    referenceImages: images,
    setReferenceImages: setImages,
    maxImages: 5,
    uploadImage,
  });
  return { deck, images };
}

function useOwnedMediaDeck(
  initialVideos: TestMediaRef[] = [],
  initialAudios: TestMediaRef[] = [],
  options: {
    uploadVideo?: UploadMediaFn;
    uploadAudio?: UploadMediaFn;
    maxVideos?: number;
    maxAudios?: number;
    ownGalleryModal?: boolean;
    operationKey?: unknown;
  } = {},
) {
  const [videos, setVideosState] = useState(initialVideos);
  const [audios, setAudiosState] = useState(initialAudios);
  const videoOwner = useRef(Symbol("test-videos"));
  const audioOwner = useRef(Symbol("test-audios"));
  const replaceVideos = (next: TestMediaRef[]) => {
    setVideosState((previous) => {
      reconcileOwnedMediaObjectUrls(
        videoOwner.current,
        previous.map((reference) => reference.url),
        next.map((reference) => reference.url),
      );
      return next;
    });
  };
  const replaceAudios = (next: TestMediaRef[]) => {
    setAudiosState((previous) => {
      reconcileOwnedMediaObjectUrls(
        audioOwner.current,
        previous.map((reference) => reference.url),
        next.map((reference) => reference.url),
      );
      return next;
    });
  };
  const deck = useDeckMedia({
    referenceImages: [],
    setReferenceImages: vi.fn(),
    maxImages: 0,
    referenceVideos: videos,
    setReferenceVideos: replaceVideos,
    maxVideos: options.maxVideos ?? 3,
    maxVideoTotalSec: 60,
    referenceAudios: audios,
    setReferenceAudios: replaceAudios,
    maxAudios: options.maxAudios ?? 3,
    maxAudioTotalSec: 60,
    uploadVideo: options.uploadVideo,
    uploadAudio: options.uploadAudio,
    ownGalleryModal: options.ownGalleryModal,
    operationKey: options.operationKey,
  });
  return { deck, videos, audios, replaceVideos, replaceAudios };
}

function mockMetadataDurations(
  durations: Array<number | null>,
  deferred = false,
): Array<() => void> {
  const originalCreateElement = document.createElement.bind(document);
  const resolvers: Array<() => void> = [];
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
        const resolve = () => {
          if (duration == null) element.onerror?.(new Event("error"));
          else element.onloadedmetadata?.(new Event("loadedmetadata"));
        };
        if (deferred) resolvers.push(resolve);
        else queueMicrotask(resolve);
      },
    });
    return element;
  }) as typeof document.createElement);
  return resolvers;
}

describe("useDeckMedia upload settlement", () => {
  const revokeObjectUrl = vi.fn();
  let nextObjectUrl = 0;

  beforeEach(() => {
    nextObjectUrl = 0;
    revokeObjectUrl.mockReset();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => `blob:upload-${++nextObjectUrl}`),
      revokeObjectURL: revokeObjectUrl,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    resetOwnedMediaObjectUrlsForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(["rejects", "resolves without a terminal callback"])(
    "clears a rejected image preview when the uploader %s",
    async (settlement) => {
      let finishUpload!: () => void;
      const uploadImage = vi.fn(
        () =>
          new Promise<void>((resolve, reject) => {
            finishUpload = () =>
              settlement === "rejects"
                ? reject(new Error("upload failed"))
                : resolve();
          }),
      );
      const { result } = renderHook(() =>
        useDeckMedia({
          referenceImages: [],
          setReferenceImages: vi.fn(),
          maxImages: 3,
          uploadImage,
        }),
      );

      act(() => {
        result.current.processImageFiles(
          [new File(["image"], "image.png", { type: "image/png" })],
          "start",
        );
      });
      await waitFor(() => {
        expect(result.current.uploadingImages).toHaveLength(1);
        expect(uploadImage).toHaveBeenCalledTimes(1);
      });

      act(() => finishUpload());
      await waitFor(() => {
        expect(result.current.uploadingImages).toHaveLength(0);
      });
      expect(revokeObjectUrl).toHaveBeenCalledTimes(1);
      expect(revokeObjectUrl).toHaveBeenCalledWith("blob:upload-1");
    },
  );

  it("settles duplicate terminal callbacks idempotently", async () => {
    const setReferenceImages = vi.fn();
    const uploadImage: UploadMediaFn = vi.fn(async ({ progressCallback }) => {
      progressCallback({ status: UploaderStates.success, data: "token" });
      progressCallback({ status: UploaderStates.success, data: "token" });
    });
    const { result } = renderHook(() =>
      useDeckMedia({
        referenceImages: [],
        setReferenceImages,
        maxImages: 3,
        uploadImage,
      }),
    );

    act(() => {
      result.current.processImageFiles(
        [new File(["image"], "image.png", { type: "image/png" })],
        "start",
      );
    });
    await waitFor(() => expect(setReferenceImages).toHaveBeenCalledTimes(1));
    expect(setReferenceImages.mock.calls[0]?.[0]).toHaveLength(1);
  });

  it.each([
    ["video", "rejects"],
    ["video", "resolves without a terminal callback"],
    ["audio", "rejects"],
    ["audio", "resolves without a terminal callback"],
  ] as const)(
    "settles a %s spinner and both probe/preview URLs when upload %s",
    async (kind, settlement) => {
      mockMetadataDurations([5.4]);
      let finishUpload!: () => void;
      const upload = vi.fn(
        () =>
          new Promise<void>((resolve, reject) => {
            finishUpload = () =>
              settlement === "rejects"
                ? reject(new Error("upload failed"))
                : resolve();
          }),
      );
      const { result } = renderHook(() =>
        useOwnedMediaDeck(
          [],
          [],
          kind === "video" ? { uploadVideo: upload } : { uploadAudio: upload },
        ),
      );
      const file = new File(
        [kind],
        `${kind}.${kind === "video" ? "mp4" : "mp3"}`,
        { type: kind === "video" ? "video/mp4" : "audio/mpeg" },
      );

      let operation!: Promise<void>;
      act(() => {
        operation =
          kind === "video"
            ? result.current.deck.processVideoFiles([file])
            : result.current.deck.processAudioFiles([file]);
      });
      await waitFor(() => {
        expect(upload).toHaveBeenCalledTimes(1);
        expect(
          kind === "video"
            ? result.current.deck.uploadingVideo
            : result.current.deck.uploadingAudio,
        ).not.toBeNull();
      });

      act(() => finishUpload());
      await act(async () => operation);
      await waitFor(() => {
        expect(
          kind === "video"
            ? result.current.deck.uploadingVideo
            : result.current.deck.uploadingAudio,
        ).toBeNull();
      });
      expect(revokeObjectUrl).toHaveBeenCalledTimes(2);
      expect(revokeObjectUrl).toHaveBeenCalledWith("blob:upload-1");
      expect(revokeObjectUrl).toHaveBeenCalledWith("blob:upload-2");
    },
  );

  it("transfers a successful video preview into store ownership", async () => {
    mockMetadataDurations([5.4]);
    const uploadVideo: UploadMediaFn = vi.fn(async ({ progressCallback }) => {
      progressCallback({
        status: UploaderStates.success,
        data: "video-token",
      });
    });
    const { result } = renderHook(() =>
      useOwnedMediaDeck([], [], { uploadVideo }),
    );

    await act(async () => {
      await result.current.deck.processVideoFiles([
        new File(["video"], "video.mp4", { type: "video/mp4" }),
      ]);
    });

    expect(result.current.videos).toHaveLength(1);
    expect(result.current.videos[0]).toMatchObject({
      mediaToken: "video-token",
      duration: 5.4,
      url: "blob:upload-2",
    });
    expect(revokeObjectUrl).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:upload-1");

    act(() => result.current.replaceVideos([]));
    expect(revokeObjectUrl).toHaveBeenCalledTimes(2);
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:upload-2");
  });

  it("transfers a successful audio preview into store ownership", async () => {
    mockMetadataDurations([5.6]);
    const uploadAudio: UploadMediaFn = vi.fn(async ({ progressCallback }) => {
      progressCallback({
        status: UploaderStates.success,
        data: "audio-token",
      });
    });
    const { result } = renderHook(() =>
      useOwnedMediaDeck([], [], { uploadAudio }),
    );

    await act(async () => {
      await result.current.deck.processAudioFiles([
        new File(["audio"], "audio.mp3", { type: "audio/mpeg" }),
      ]);
    });

    expect(result.current.audios).toHaveLength(1);
    expect(result.current.audios[0]).toMatchObject({
      mediaToken: "audio-token",
      duration: 5.6,
      url: "blob:upload-2",
    });
    expect(revokeObjectUrl).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:upload-1");

    act(() => result.current.replaceAudios([]));
    expect(revokeObjectUrl).toHaveBeenCalledTimes(2);
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:upload-2");
  });

  it("reprobes gallery media instead of trusting stale list metadata", async () => {
    const { result } = renderHook(() =>
      useOwnedMediaDeck([], [], { ownGalleryModal: true }),
    );
    mockMetadataDurations([5.4]);

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
          durationMillis: 14_999,
        },
      ]);
    });

    expect(result.current.videos).toHaveLength(1);
    expect(result.current.videos[0]?.duration).toBe(5.4);
  });

  it("keeps readable gallery fallback metadata and excludes an error", async () => {
    mockMetadataDurations([14.9994, null]);
    const { result } = renderHook(() =>
      useOwnedMediaDeck([], [], { ownGalleryModal: true }),
    );

    act(() => result.current.deck.openGallery("video"));
    const gallery = result.current.deck.galleryModal as ReactElement<{
      onUseSelected: (
        items: Array<{
          id: string;
          fullImage: string;
        }>,
      ) => Promise<void>;
    }>;
    await act(async () => {
      await gallery.props.onUseSelected([
        { id: "fallback", fullImage: "https://cdn/fallback.mp4" },
        { id: "unreadable", fullImage: "https://cdn/unreadable.mp4" },
      ]);
    });

    expect(result.current.videos).toHaveLength(1);
    expect(result.current.videos[0]).toMatchObject({
      mediaToken: "fallback",
      duration: 14.999,
    });
  });

  it("serializes A/B against fresh removals without losing B or exceeding cap", async () => {
    const metadataResolvers = mockMetadataDurations([5.4, 5.6], true);
    const uploadVideo: UploadMediaFn = vi.fn(
      async ({ assetFile, progressCallback }) => {
        progressCallback({
          status: UploaderStates.success,
          data: `${assetFile.name}-token`,
        });
      },
    );
    const existing: TestMediaRef = {
      id: "existing",
      url: "https://cdn/existing.mp4",
      file: new File(["existing"], "existing.mp4"),
      mediaToken: "existing-token",
      duration: 5,
    };
    const { result } = renderHook(() =>
      useOwnedMediaDeck([existing], [], { uploadVideo, maxVideos: 2 }),
    );

    let operationA!: Promise<void>;
    let operationB!: Promise<void>;
    act(() => {
      operationA = result.current.deck.processVideoFiles([
        new File(["A"], "A.mp4", { type: "video/mp4" }),
      ]);
      operationB = result.current.deck.processVideoFiles([
        new File(["B"], "B.mp4", { type: "video/mp4" }),
      ]);
    });
    await waitFor(() => expect(metadataResolvers).toHaveLength(1));
    act(() => result.current.replaceVideos([]));
    act(() => metadataResolvers.shift()?.());

    await waitFor(() => expect(metadataResolvers).toHaveLength(1));
    act(() => metadataResolvers.shift()?.());
    await act(async () => Promise.all([operationA, operationB]));

    expect(result.current.videos).toHaveLength(2);
    expect(result.current.videos.map((video) => video.file.name)).toEqual([
      "A.mp4",
      "B.mp4",
    ]);
    expect(result.current.videos.some((video) => video.id === "existing")).toBe(
      false,
    );
  });

  it("reconciles same-batch remove and reorder against a deferred image upload", async () => {
    let completeUpload!: () => void;
    let resolveUpload!: () => void;
    let progressCallback!: Parameters<UploadMediaFn>[0]["progressCallback"];
    const uploadImage: UploadMediaFn = vi.fn(
      ({ progressCallback: callback }) =>
        new Promise<void>((resolve) => {
          progressCallback = callback;
          resolveUpload = resolve;
          completeUpload = () => {
            callback({ status: UploaderStates.success, data: "new-token" });
            resolve();
          };
        }),
    );
    const image = (id: string): TestImageRef => ({
      id,
      url: `https://cdn/${id}.png`,
      file: new File([id], `${id}.png`, { type: "image/png" }),
      mediaToken: `${id}-token`,
    });
    const { result } = renderHook(() =>
      useOwnedImageDeck([image("remove"), image("a"), image("b")], uploadImage),
    );

    act(() => {
      result.current.deck.processImageFiles(
        [new File(["new"], "new.png", { type: "image/png" })],
        "start",
      );
    });
    await waitFor(() => expect(uploadImage).toHaveBeenCalledTimes(1));
    expect(progressCallback).toBeTypeOf("function");

    act(() => {
      result.current.deck.removeReference("remove");
      result.current.deck.reorderImages(0, 1);
      completeUpload();
    });
    await waitFor(() =>
      expect(result.current.images.map((item) => item.id)).toHaveLength(3),
    );

    expect(result.current.images.map((item) => item.mediaToken)).toEqual([
      "b-token",
      "a-token",
      "new-token",
    ]);
    expect(resolveUpload).toBeTypeOf("function");
  });

  it("clear cancels a deferred upload and releases its preview URL", async () => {
    let completeUpload!: () => void;
    const uploadImage: UploadMediaFn = vi.fn(
      ({ progressCallback }) =>
        new Promise<void>((resolve) => {
          completeUpload = () => {
            progressCallback({ status: UploaderStates.success, data: "late" });
            resolve();
          };
        }),
    );
    const { result } = renderHook(() => useOwnedImageDeck([], uploadImage));

    act(() => {
      result.current.deck.processImageFiles(
        [new File(["late"], "late.png", { type: "image/png" })],
        "start",
      );
    });
    await waitFor(() => expect(uploadImage).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.deck.clearReferences();
      completeUpload();
    });
    await waitFor(() =>
      expect(result.current.deck.uploadingImages).toEqual([]),
    );
    expect(result.current.images).toEqual([]);
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:upload-1");
  });

  it.each(["clear", "unmount"] as const)(
    "%s aborts a pending image read before an upload can start",
    async (boundary) => {
      let reader!: {
        result: string | null;
        onloadend: ((event: ProgressEvent<FileReader>) => void) | null;
        onerror: ((event: ProgressEvent<FileReader>) => void) | null;
        onabort: ((event: ProgressEvent<FileReader>) => void) | null;
        abort: ReturnType<typeof vi.fn>;
      };
      class DeferredFileReader {
        result: string | null = null;
        onloadend: ((event: ProgressEvent<FileReader>) => void) | null = null;
        onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;
        onabort: ((event: ProgressEvent<FileReader>) => void) | null = null;
        abort = vi.fn(() => {
          this.onabort?.(
            new ProgressEvent("abort") as ProgressEvent<FileReader>,
          );
        });
        readAsDataURL() {
          reader = this;
        }
      }
      vi.stubGlobal(
        "FileReader",
        DeferredFileReader as unknown as typeof FileReader,
      );
      const uploadImage = vi.fn();
      const view = renderHook(() => useOwnedImageDeck([], uploadImage));
      act(() => {
        view.result.current.deck.processImageFiles(
          [new File(["large"], "large.png", { type: "image/png" })],
          "start",
        );
      });
      await waitFor(() => expect(reader).toBeTruthy());

      if (boundary === "clear") {
        act(() => view.result.current.deck.clearReferences());
      } else {
        view.unmount();
      }
      expect(reader.abort).toHaveBeenCalledOnce();
      reader.result = "data:image/png;base64,bGF0ZQ==";
      reader.onloadend?.(
        new ProgressEvent("loadend") as ProgressEvent<FileReader>,
      );
      await Promise.resolve();

      expect(uploadImage).not.toHaveBeenCalled();
      expect(revokeObjectUrl).toHaveBeenCalledWith("blob:upload-1");
    },
  );

  it("aborts a pending end-frame read when the host model/mode identity changes", async () => {
    let reader!: {
      onloadend: ((event: ProgressEvent<FileReader>) => void) | null;
      onerror: ((event: ProgressEvent<FileReader>) => void) | null;
      onabort: ((event: ProgressEvent<FileReader>) => void) | null;
      abort: ReturnType<typeof vi.fn>;
    };
    class DeferredFileReader {
      result: string | null = null;
      onloadend: ((event: ProgressEvent<FileReader>) => void) | null = null;
      onerror: ((event: ProgressEvent<FileReader>) => void) | null = null;
      onabort: ((event: ProgressEvent<FileReader>) => void) | null = null;
      abort = vi.fn(() => {
        this.onabort?.(new ProgressEvent("abort") as ProgressEvent<FileReader>);
      });
      readAsDataURL() {
        reader = this;
      }
    }
    vi.stubGlobal(
      "FileReader",
      DeferredFileReader as unknown as typeof FileReader,
    );
    const uploadImage = vi.fn();
    const { result, rerender } = renderHook(
      ({ operationKey }) => {
        const [endFrame, setEndFrame] = useState<TestImageRef>();
        const deck = useDeckMedia<TestImageRef, TestMediaRef, TestMediaRef>({
          referenceImages: [],
          setReferenceImages: vi.fn(),
          maxImages: 1,
          endFrameImage: endFrame,
          setEndFrameImage: setEndFrame,
          endFrameEnabled: true,
          operationKey,
          uploadImage,
        });
        return { deck, endFrame };
      },
      { initialProps: { operationKey: "model-a:keyframe" } },
    );

    act(() => {
      result.current.deck.processImageFiles(
        [new File(["end"], "end.png", { type: "image/png" })],
        "end",
      );
    });
    await waitFor(() => expect(reader).toBeTruthy());

    rerender({ operationKey: "model-b:reference" });

    expect(reader.abort).toHaveBeenCalledOnce();
    expect(uploadImage).not.toHaveBeenCalled();
    expect(result.current.deck.uploadingEnd).toBeNull();
    expect(result.current.endFrame).toBeUndefined();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:upload-1");
  });

  it("applies a lowered model cap when deferred metadata completes", async () => {
    const metadataResolvers = mockMetadataDurations([5.6], true);
    const uploadVideo: UploadMediaFn = vi.fn(async ({ progressCallback }) => {
      progressCallback({ status: UploaderStates.success, data: "late-token" });
    });
    const { result, rerender } = renderHook(
      ({ maxVideos }) => useOwnedMediaDeck([], [], { uploadVideo, maxVideos }),
      { initialProps: { maxVideos: 1 } },
    );

    let operation!: Promise<void>;
    act(() => {
      operation = result.current.deck.processVideoFiles([
        new File(["late"], "late.mp4", { type: "video/mp4" }),
      ]);
    });
    await waitFor(() => expect(metadataResolvers).toHaveLength(1));
    rerender({ maxVideos: 0 });
    act(() => metadataResolvers.shift()?.());
    await act(async () => operation);

    expect(result.current.videos).toEqual([]);
    expect(uploadVideo).not.toHaveBeenCalled();
  });

  it.each(["video", "audio"] as const)(
    "cancels a deferred %s upload when the host model/mode identity changes",
    async (kind) => {
      mockMetadataDurations([5.4]);
      let complete!: (token: string) => void;
      let settle!: () => void;
      const upload: UploadMediaFn = vi.fn(
        ({ progressCallback }) =>
          new Promise<void>((resolve) => {
            complete = (token) =>
              progressCallback({
                status: UploaderStates.success,
                data: token,
              });
            settle = resolve;
          }),
      );
      const { result, rerender } = renderHook(
        ({ operationKey }) =>
          useOwnedMediaDeck([], [], {
            ...(kind === "video"
              ? { uploadVideo: upload }
              : { uploadAudio: upload }),
            operationKey,
          }),
        { initialProps: { operationKey: "model-a:reference" } },
      );
      const file = new File(
        ["late"],
        `late.${kind === "video" ? "mp4" : "mp3"}`,
        { type: kind === "video" ? "video/mp4" : "audio/mpeg" },
      );
      let operation!: Promise<void>;
      act(() => {
        operation =
          kind === "video"
            ? result.current.deck.processVideoFiles([file])
            : result.current.deck.processAudioFiles([file]);
      });
      await waitFor(() => expect(upload).toHaveBeenCalledOnce());

      rerender({ operationKey: "model-b:keyframe" });
      act(() => {
        complete("late-token");
        settle();
      });
      await act(async () => operation);

      expect(
        kind === "video" ? result.current.videos : result.current.audios,
      ).toEqual([]);
      expect(
        kind === "video"
          ? result.current.deck.uploadingVideo
          : result.current.deck.uploadingAudio,
      ).toBeNull();
      expect(revokeObjectUrl).toHaveBeenCalledWith("blob:upload-2");
    },
  );

  it.each(["video", "audio"] as const)(
    "closing the %s gallery cancels its deferred probe without publishing",
    async (kind) => {
      const metadataResolvers = mockMetadataDurations([5.4], true);
      const { result } = renderHook(() =>
        useOwnedMediaDeck([], [], { ownGalleryModal: true }),
      );
      act(() => result.current.deck.openGallery(kind));
      const gallery = result.current.deck.galleryModal as ReactElement<{
        onClose: () => void;
        onUseSelected: (
          items: Array<{ id: string; fullImage: string }>,
        ) => Promise<void>;
      }>;
      let operation!: Promise<void>;
      act(() => {
        operation = gallery.props.onUseSelected([
          { id: `late-${kind}`, fullImage: `https://cdn/late.${kind}` },
        ]);
      });
      await waitFor(() => expect(metadataResolvers).toHaveLength(1));

      act(() => gallery.props.onClose());
      act(() => metadataResolvers.shift()?.());
      await act(async () => operation);

      expect(
        kind === "video" ? result.current.videos : result.current.audios,
      ).toEqual([]);
      expect(
        (
          result.current.deck.galleryModal as ReactElement<{
            useSelectedLoading: boolean;
          }>
        ).props.useSelectedLoading,
      ).toBe(false);
    },
  );

  it.each(["video", "audio"] as const)(
    "detaches the %s queue at clear so a new upload is not blocked",
    async (kind) => {
      const metadataResolvers = mockMetadataDurations([5.4, 5.6], true);
      const upload: UploadMediaFn = vi.fn(
        async ({ assetFile, progressCallback }) => {
          progressCallback({
            status: UploaderStates.success,
            data: `${assetFile.name}-token`,
          });
        },
      );
      const options =
        kind === "video" ? { uploadVideo: upload } : { uploadAudio: upload };
      const { result } = renderHook(() => useOwnedMediaDeck([], [], options));
      const file = (name: string) =>
        new File([name], `${name}.${kind === "video" ? "mp4" : "mp3"}`, {
          type: kind === "video" ? "video/mp4" : "audio/mpeg",
        });
      const process = (files: File[]) =>
        kind === "video"
          ? result.current.deck.processVideoFiles(files)
          : result.current.deck.processAudioFiles(files);

      let stalled!: Promise<void>;
      act(() => {
        stalled = process([file("A")]);
      });
      await waitFor(() => expect(metadataResolvers).toHaveLength(1));

      let fresh!: Promise<void>;
      act(() => {
        result.current.deck.clearReferences();
        fresh = process([file("B")]);
      });
      await waitFor(() => expect(metadataResolvers).toHaveLength(2));
      act(() => metadataResolvers[1]?.());
      await act(async () => Promise.all([stalled, fresh]));

      const committed =
        kind === "video" ? result.current.videos : result.current.audios;
      expect(committed.map((reference) => reference.file.name)).toEqual([
        `B.${kind === "video" ? "mp4" : "mp3"}`,
      ]);
    },
  );

  it("cancels an end-frame upload when the host leaves keyframe mode", async () => {
    let completeUpload!: () => void;
    const uploadImage: UploadMediaFn = vi.fn(
      ({ progressCallback }) =>
        new Promise<void>((resolve) => {
          completeUpload = () => {
            progressCallback({ status: UploaderStates.success, data: "late" });
            resolve();
          };
        }),
    );
    const { result, rerender } = renderHook(
      ({ enabled }) => {
        const [endFrame, setEndFrame] = useState<TestImageRef>();
        const deck = useDeckMedia<TestImageRef, TestMediaRef, TestMediaRef>({
          referenceImages: [],
          setReferenceImages: vi.fn(),
          maxImages: 1,
          endFrameImage: endFrame,
          setEndFrameImage: setEndFrame,
          endFrameEnabled: enabled,
          uploadImage,
        });
        return { deck, endFrame };
      },
      { initialProps: { enabled: true } },
    );

    act(() => {
      result.current.deck.processImageFiles(
        [new File(["end"], "end.png", { type: "image/png" })],
        "end",
      );
    });
    await waitFor(() => expect(uploadImage).toHaveBeenCalledTimes(1));
    rerender({ enabled: false });
    act(() => completeUpload());
    await waitFor(() => expect(result.current.deck.uploadingEnd).toBeNull());

    expect(result.current.endFrame).toBeUndefined();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:upload-1");
  });

  it("rejects a stale end-frame gallery selection after keyframe mode is disabled", async () => {
    const { result, rerender } = renderHook(
      ({ enabled }) => {
        const [endFrame, setEndFrame] = useState<TestImageRef>();
        const deck = useDeckMedia<TestImageRef, TestMediaRef, TestMediaRef>({
          referenceImages: [],
          setReferenceImages: vi.fn(),
          maxImages: 1,
          endFrameImage: endFrame,
          setEndFrameImage: setEndFrame,
          endFrameEnabled: enabled,
          ownGalleryModal: true,
        });
        return { deck, endFrame };
      },
      { initialProps: { enabled: true } },
    );

    act(() => result.current.deck.openGallery("end"));
    const staleGallery = result.current.deck.galleryModal as ReactElement<{
      onUseSelected: (
        items: Array<{ id: string; fullImage: string }>,
      ) => Promise<void>;
    }>;
    rerender({ enabled: false });
    await act(async () => {
      await staleGallery.props.onUseSelected([
        { id: "stale-end", fullImage: "https://cdn/stale-end.png" },
      ]);
    });

    expect(result.current.endFrame).toBeUndefined();
  });

  it("does not probe or retain media when the matching setter is absent", async () => {
    const createObjectUrl = vi.mocked(URL.createObjectURL);
    const { result } = renderHook(() =>
      useDeckMedia<TestImageRef, TestMediaRef, TestMediaRef>({
        referenceImages: [],
        setReferenceImages: vi.fn(),
        maxImages: 0,
        referenceVideos: [],
        maxVideos: 3,
      }),
    );

    await act(async () => {
      await result.current.processVideoFiles([
        new File(["video"], "video.mp4", { type: "video/mp4" }),
      ]);
    });

    expect(createObjectUrl).not.toHaveBeenCalled();
    expect(result.current.uploadingVideo).toBeNull();
  });

  it("times out a stalled metadata probe and releases its object URL", async () => {
    vi.useFakeTimers();
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((
      tagName: string,
    ) => {
      const element = originalCreateElement(tagName);
      if (tagName === "video") {
        Object.defineProperty(element, "src", {
          configurable: true,
          set: () => undefined,
        });
      }
      return element;
    }) as typeof document.createElement);
    const uploadVideo = vi.fn();
    const { result } = renderHook(() =>
      useOwnedMediaDeck([], [], { uploadVideo }),
    );

    let operation!: Promise<void>;
    act(() => {
      operation = result.current.deck.processVideoFiles([
        new File(["video"], "video.mp4", { type: "video/mp4" }),
      ]);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
      await operation;
    });
    vi.useRealTimers();

    expect(uploadVideo).not.toHaveBeenCalled();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:upload-1");
  });

  it("aborts and releases a stalled metadata probe on unmount", async () => {
    const metadataResolvers = mockMetadataDurations([5.4], true);
    const { result, unmount } = renderHook(() => useOwnedMediaDeck());

    let operation!: Promise<void>;
    act(() => {
      operation = result.current.deck.processVideoFiles([
        new File(["video"], "video.mp4", { type: "video/mp4" }),
      ]);
    });
    await waitFor(() => expect(metadataResolvers).toHaveLength(1));
    unmount();
    await act(async () => operation);

    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:upload-1");
  });
});
