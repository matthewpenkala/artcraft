import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { GalleryItem, GalleryModal } from "@storyteller/ui-gallery-modal";
import { downloadFileFromUrl, type UploadMediaFn } from "@storyteller/api";
import { toast } from "@storyteller/ui-toaster";
import {
  UploaderStates,
  appendMediaReference,
  createOwnedMediaObjectUrl,
  discardOwnedMediaObjectUrl,
  mediaDurationLimitStatus,
  normalizeMediaDurationSeconds,
  MEDIA_DURATION_PROBE_TIMEOUT_MS,
  withTemporaryMediaObjectUrl,
} from "@storyteller/common";
import {
  AUDIO_FILE_ACCEPT,
  AUDIO_FILE_TYPE_ERROR,
  isAudioFile,
} from "../common/audioFiles";

/** Minimal structural shapes so both apps' ref types fit. */
export interface DeckRefLike {
  id: string;
  url: string;
  /** Set once the media file exists server-side (uploads fill it in late). */
  mediaToken?: string;
}
export interface DeckMediaRefLike extends DeckRefLike {
  duration: number;
}

/** An in-flight upload; `previewUrl` is a memoized object URL. */
export interface DeckUploadEntry {
  id: string;
  file: File;
  previewUrl: string;
}

export interface UseDeckMediaOptions<
  TImage extends DeckRefLike,
  TVideo extends DeckMediaRefLike,
  TAudio extends DeckMediaRefLike,
> {
  referenceImages: TImage[];
  setReferenceImages: (images: TImage[]) => void;
  maxImages: number;
  /** Current end keyframe, when the host tracks one — its token is greyed out
   *  in the end-frame picker so it can't be re-picked into the same slot. */
  endFrameImage?: TImage;
  setEndFrameImage?: (image?: TImage) => void;
  /** False while the host is not rendering/accepting an end keyframe. */
  endFrameEnabled?: boolean;
  referenceVideos?: TVideo[];
  setReferenceVideos?: (videos: TVideo[]) => void;
  maxVideos?: number;
  maxVideoTotalSec?: number;
  referenceAudios?: TAudio[];
  setReferenceAudios?: (audios: TAudio[]) => void;
  maxAudios?: number;
  maxAudioTotalSec?: number;
  /** Host model/mode identity; changing it invalidates all in-flight work. */
  operationKey?: unknown;
  uploadImage?: UploadMediaFn;
  uploadVideo?: UploadMediaFn;
  uploadAudio?: UploadMediaFn;
  /**
   * When true the hook owns a target-aware GalleryModal (desktop). When
   * false the caller keeps its own library pickers (webapp) and only the
   * upload paths are used.
   */
  ownGalleryModal?: boolean;
}

const randomId = () => Math.random().toString(36).substring(7);

// A non-finite duration cap means "no limit" — leave it out of the message.
const videoLimitMessage = (maxVideos: number, maxTotalSec: number) =>
  isFinite(maxTotalSec)
    ? `Max ${maxVideos} videos / ${maxTotalSec}s total`
    : `Max ${maxVideos} video${maxVideos === 1 ? "" : "s"}`;

const randomTitle = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).substring(2, 15)}`;

const MEDIA_METADATA_TIMEOUT_MS = MEDIA_DURATION_PROBE_TIMEOUT_MS;

const getMediaDurationFromSrc = (
  kind: "video" | "audio",
  src: string,
  signal?: AbortSignal,
): Promise<number | null> =>
  new Promise((resolve) => {
    const media = document.createElement(kind);
    let settled = false;
    const finish = (duration: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", abort);
      media.onloadedmetadata = null;
      media.onerror = null;
      media.removeAttribute("src");
      resolve(duration);
    };
    const abort = () => finish(null);
    const timeoutId = setTimeout(() => finish(null), MEDIA_METADATA_TIMEOUT_MS);
    media.preload = "metadata";
    media.onloadedmetadata = () =>
      finish(normalizeMediaDurationSeconds(media.duration));
    media.onerror = () => finish(null);
    if (signal?.aborted) {
      finish(null);
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    media.src = src;
  });

const getFileDuration = (
  kind: "video" | "audio",
  file: File,
  signal?: AbortSignal,
): Promise<number | null> =>
  withTemporaryMediaObjectUrl(file, (src) =>
    getMediaDurationFromSrc(kind, src, signal),
  );

/**
 * Headless upload/limits/library state machine for the reference deck.
 * Extracted from the legacy ImagePromptRow band so PromptBoxImage,
 * PromptBoxVideo, and the webapp PromptBox share one implementation.
 */
export function useDeckMedia<
  TImage extends DeckRefLike,
  TVideo extends DeckMediaRefLike,
  TAudio extends DeckMediaRefLike,
>({
  referenceImages,
  setReferenceImages,
  maxImages,
  endFrameImage,
  setEndFrameImage,
  endFrameEnabled = true,
  referenceVideos = [],
  setReferenceVideos,
  maxVideos = 3,
  maxVideoTotalSec = 15,
  referenceAudios = [],
  setReferenceAudios,
  maxAudios = 2,
  maxAudioTotalSec = 15,
  operationKey,
  uploadImage,
  uploadVideo,
  uploadAudio,
  ownGalleryModal,
}: UseDeckMediaOptions<TImage, TVideo, TAudio>) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoFileInputRef = useRef<HTMLInputElement>(null);
  const audioFileInputRef = useRef<HTMLInputElement>(null);
  const anyFileInputRef = useRef<HTMLInputElement>(null);
  const imageTargetRef = useRef<"start" | "end">("start");

  const [uploadingImages, setUploadingImages] = useState<DeckUploadEntry[]>([]);
  const [uploadingEnd, setUploadingEnd] = useState<DeckUploadEntry | null>(
    null,
  );
  const [uploadingVideo, setUploadingVideo] = useState<DeckUploadEntry | null>(
    null,
  );
  const [uploadingAudio, setUploadingAudio] = useState<DeckUploadEntry | null>(
    null,
  );

  const [isGalleryModalOpen, setIsGalleryModalOpen] = useState(false);
  const [galleryTarget, setGalleryTarget] = useState<
    "start" | "end" | "video" | "audio"
  >("start");
  const [selectedGalleryImages, setSelectedGalleryImages] = useState<string[]>(
    [],
  );
  const [isProcessingGallery, setIsProcessingGallery] = useState(false);

  // Update these during render and immediately before publishing local
  // changes. Async completions therefore reconcile against the latest state,
  // including removals that happened while metadata/upload work was pending.
  const referenceImagesRef = useRef(referenceImages);
  const referenceVideosRef = useRef(referenceVideos);
  const referenceAudiosRef = useRef(referenceAudios);
  const imagePolicySignature = `${maxImages}`;
  const videoPolicySignature = `${Boolean(setReferenceVideos)}:${maxVideos}:${maxVideoTotalSec}`;
  const audioPolicySignature = `${Boolean(setReferenceAudios)}:${maxAudios}:${maxAudioTotalSec}`;
  const previousImagePolicyRef = useRef(imagePolicySignature);
  const previousVideoPolicyRef = useRef(videoPolicySignature);
  const previousAudioPolicyRef = useRef(audioPolicySignature);
  const previousImageOperationKeyRef = useRef(operationKey);
  const previousVideoOperationKeyRef = useRef(operationKey);
  const previousAudioOperationKeyRef = useRef(operationKey);
  const limitsRef = useRef({
    maxImages,
    maxVideos,
    maxVideoTotalSec,
    maxAudios,
    maxAudioTotalSec,
  });
  const settersRef = useRef({
    setReferenceImages,
    setEndFrameImage,
    setReferenceVideos,
    setReferenceAudios,
  });
  const endFrameEnabledRef = useRef(endFrameEnabled);
  referenceImagesRef.current = referenceImages;
  referenceVideosRef.current = referenceVideos;
  referenceAudiosRef.current = referenceAudios;
  limitsRef.current = {
    maxImages,
    maxVideos,
    maxVideoTotalSec,
    maxAudios,
    maxAudioTotalSec,
  };
  settersRef.current = {
    setReferenceImages,
    setEndFrameImage,
    setReferenceVideos,
    setReferenceAudios,
  };
  endFrameEnabledRef.current = endFrameEnabled;

  const publishImages = (next: TImage[]) => {
    referenceImagesRef.current = next;
    settersRef.current.setReferenceImages(next);
  };
  const publishVideos = (next: TVideo[]): boolean => {
    const setter = settersRef.current.setReferenceVideos;
    if (!setter) return false;
    referenceVideosRef.current = next;
    setter(next);
    return true;
  };
  const publishAudios = (next: TAudio[]): boolean => {
    const setter = settersRef.current.setReferenceAudios;
    if (!setter) return false;
    referenceAudiosRef.current = next;
    setter(next);
    return true;
  };

  const replaceImages = (next: TImage[]) => publishImages(next);
  const replaceVideos = (next: TVideo[]) => publishVideos(next);
  const replaceAudios = (next: TAudio[]) => publishAudios(next);

  const removeReference = (id: string) => {
    const images = referenceImagesRef.current;
    if (images.some((image) => image.id === id)) {
      publishImages(images.filter((image) => image.id !== id));
      return;
    }
    const videos = referenceVideosRef.current;
    if (videos.some((video) => video.id === id)) {
      publishVideos(videos.filter((video) => video.id !== id));
      return;
    }
    const audios = referenceAudiosRef.current;
    if (audios.some((audio) => audio.id === id)) {
      publishAudios(audios.filter((audio) => audio.id !== id));
    }
  };

  const reorderImages = (from: number, to: number) => {
    const current = referenceImagesRef.current;
    if (
      from === to ||
      from < 0 ||
      to < 0 ||
      from >= current.length ||
      to >= current.length
    ) {
      return;
    }
    const next = [...current];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    publishImages(next);
  };

  // Clear is an explicit cancellation boundary. Uploaders cannot be aborted,
  // but their late callbacks must not repopulate a deck the user cleared.
  const imageEpochRef = useRef(0);
  const endFrameEpochRef = useRef(0);
  const endGalleryEpochRef = useRef(0);
  const videoGalleryEpochRef = useRef(0);
  const audioGalleryEpochRef = useRef(0);
  const videoEpochRef = useRef(0);
  const audioEpochRef = useRef(0);
  const pendingObjectUrlsRef = useRef(new Set<string>());
  const pendingImageUrlsRef = useRef(new Set<string>());
  const pendingImageReadersRef = useRef(new Map<FileReader, "start" | "end">());
  const pendingEndEntryRef = useRef<DeckUploadEntry | null>(null);
  const pendingVideoEntryRef = useRef<DeckUploadEntry | null>(null);
  const pendingAudioEntryRef = useRef<DeckUploadEntry | null>(null);
  const pendingProbeControllersRef = useRef(
    new Map<
      AbortController,
      { kind: "video" | "audio"; source: "file" | "gallery" }
    >(),
  );
  const videoOperationsRef = useRef<Promise<void>>(Promise.resolve());
  const audioOperationsRef = useRef<Promise<void>>(Promise.resolve());
  const mountedRef = useRef(true);

  const abortPendingProbes = (
    kind?: "video" | "audio",
    source?: "file" | "gallery",
  ) => {
    for (const [controller, probe] of pendingProbeControllersRef.current) {
      if (kind && probe.kind !== kind) continue;
      if (source && probe.source !== source) continue;
      controller.abort();
      pendingProbeControllersRef.current.delete(controller);
    }
  };

  const probeDuration = async (
    kind: "video" | "audio",
    src: string,
  ): Promise<number | null> => {
    const controller = new AbortController();
    pendingProbeControllersRef.current.set(controller, {
      kind,
      source: "gallery",
    });
    try {
      return await getMediaDurationFromSrc(kind, src, controller.signal);
    } finally {
      pendingProbeControllersRef.current.delete(controller);
    }
  };

  const probeFileDuration = async (
    kind: "video" | "audio",
    file: File,
  ): Promise<number | null> => {
    const controller = new AbortController();
    pendingProbeControllersRef.current.set(controller, {
      kind,
      source: "file",
    });
    try {
      return await getFileDuration(kind, file, controller.signal);
    } finally {
      pendingProbeControllersRef.current.delete(controller);
    }
  };

  const cancelEndFrameUpload = () => {
    endFrameEpochRef.current++;
    for (const [reader, target] of pendingImageReadersRef.current) {
      if (target === "end") reader.abort();
    }
    for (const [reader, target] of pendingImageReadersRef.current) {
      if (target === "end") pendingImageReadersRef.current.delete(reader);
    }
    const pending = pendingEndEntryRef.current;
    pendingEndEntryRef.current = null;
    if (pending) {
      pendingObjectUrlsRef.current.delete(pending.previewUrl);
      discardOwnedMediaObjectUrl(pending.previewUrl);
    }
    setUploadingEnd((current) =>
      current && current.id === pending?.id ? null : current,
    );
  };

  const clearReferences = (commit?: () => void) => {
    imageEpochRef.current++;
    endFrameEpochRef.current++;
    videoEpochRef.current++;
    audioEpochRef.current++;
    videoOperationsRef.current = Promise.resolve();
    audioOperationsRef.current = Promise.resolve();
    abortPendingProbes();
    for (const reader of pendingImageReadersRef.current.keys()) {
      reader.abort();
    }
    pendingImageReadersRef.current.clear();
    pendingEndEntryRef.current = null;
    pendingVideoEntryRef.current = null;
    pendingAudioEntryRef.current = null;
    referenceImagesRef.current = [];
    referenceVideosRef.current = [];
    referenceAudiosRef.current = [];
    for (const url of pendingObjectUrlsRef.current) {
      discardOwnedMediaObjectUrl(url);
    }
    pendingObjectUrlsRef.current.clear();
    setUploadingImages([]);
    setUploadingEnd(null);
    setUploadingVideo(null);
    setUploadingAudio(null);
    if (commit) {
      commit();
    } else {
      setReferenceImages([]);
      setEndFrameImage?.(undefined);
      setReferenceVideos?.([]);
      setReferenceAudios?.([]);
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      imageEpochRef.current++;
      endFrameEpochRef.current++;
      videoEpochRef.current++;
      audioEpochRef.current++;
      videoOperationsRef.current = Promise.resolve();
      audioOperationsRef.current = Promise.resolve();
      abortPendingProbes();
      for (const reader of pendingImageReadersRef.current.keys()) {
        reader.abort();
      }
      pendingImageReadersRef.current.clear();
      pendingEndEntryRef.current = null;
      pendingVideoEntryRef.current = null;
      pendingAudioEntryRef.current = null;
      for (const url of pendingObjectUrlsRef.current) {
        discardOwnedMediaObjectUrl(url);
      }
      pendingObjectUrlsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!endFrameEnabled) cancelEndFrameUpload();
    // The cancellation boundary is the enabled-state transition itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endFrameEnabled]);

  // The hook only ever commits `{ id, url, file, mediaToken, duration? }`,
  // which is structurally assignable to both apps' ref types (desktop
  // promptStore refs match exactly; the webapp's extra fields are optional).
  const asImage = (img: {
    id: string;
    url: string;
    file?: File;
    mediaToken: string;
  }) => img as unknown as TImage;
  const asVideo = (video: {
    id: string;
    url: string;
    file?: File;
    mediaToken: string;
    duration: number;
  }) => video as unknown as TVideo;
  const asAudio = (audio: {
    id: string;
    url: string;
    file?: File;
    mediaToken: string;
    duration: number;
  }) => audio as unknown as TAudio;

  const makeEntry = (file: File): DeckUploadEntry => {
    const previewUrl = createOwnedMediaObjectUrl(file);
    pendingObjectUrlsRef.current.add(previewUrl);
    return { id: randomId(), file, previewUrl };
  };

  const discardPendingUrl = (url: string) => {
    pendingObjectUrlsRef.current.delete(url);
    pendingImageUrlsRef.current.delete(url);
    discardOwnedMediaObjectUrl(url);
  };

  const transferPendingUrl = (url: string) => {
    pendingObjectUrlsRef.current.delete(url);
    pendingImageUrlsRef.current.delete(url);
  };

  const cancelPendingImageOperations = () => {
    imageEpochRef.current++;
    for (const [reader, target] of pendingImageReadersRef.current) {
      if (target === "start") reader.abort();
    }
    for (const [reader, target] of pendingImageReadersRef.current) {
      if (target === "start") pendingImageReadersRef.current.delete(reader);
    }
    for (const url of pendingImageUrlsRef.current) {
      discardPendingUrl(url);
    }
    pendingImageUrlsRef.current.clear();
    setUploadingImages([]);
  };

  const cancelPendingVideoOperations = () => {
    videoEpochRef.current++;
    videoOperationsRef.current = Promise.resolve();
    abortPendingProbes("video");
    const pending = pendingVideoEntryRef.current;
    pendingVideoEntryRef.current = null;
    if (pending) discardPendingUrl(pending.previewUrl);
    setUploadingVideo(null);
  };

  const cancelPendingAudioOperations = () => {
    audioEpochRef.current++;
    audioOperationsRef.current = Promise.resolve();
    abortPendingProbes("audio");
    const pending = pendingAudioEntryRef.current;
    pendingAudioEntryRef.current = null;
    if (pending) discardPendingUrl(pending.previewUrl);
    setUploadingAudio(null);
  };

  useLayoutEffect(() => {
    const policyChanged =
      imagePolicySignature !== previousImagePolicyRef.current;
    const operationChanged =
      operationKey !== previousImageOperationKeyRef.current;
    previousImagePolicyRef.current = imagePolicySignature;
    previousImageOperationKeyRef.current = operationKey;
    if (policyChanged || operationChanged) {
      cancelPendingImageOperations();
    }
    if (operationChanged) {
      cancelEndFrameUpload();
    }
    // The host's semantic model/mode identity and capability policy are
    // cancellation boundaries. Ordinary reference-array edits intentionally
    // remain fresh-state reconciliation inputs for pending uploads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imagePolicySignature, operationKey]);

  useLayoutEffect(() => {
    const policyChanged =
      videoPolicySignature !== previousVideoPolicyRef.current;
    const operationChanged =
      operationKey !== previousVideoOperationKeyRef.current;
    previousVideoPolicyRef.current = videoPolicySignature;
    previousVideoOperationKeyRef.current = operationKey;
    if (policyChanged || operationChanged) {
      cancelPendingVideoOperations();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoPolicySignature, operationKey]);

  useLayoutEffect(() => {
    const policyChanged =
      audioPolicySignature !== previousAudioPolicyRef.current;
    const operationChanged =
      operationKey !== previousAudioOperationKeyRef.current;
    previousAudioPolicyRef.current = audioPolicySignature;
    previousAudioOperationKeyRef.current = operationKey;
    if (policyChanged || operationChanged) {
      cancelPendingAudioOperations();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioPolicySignature, operationKey]);

  const openImageUpload = () => {
    imageTargetRef.current = "start";
    fileInputRef.current?.click();
  };

  const openEndUpload = () => {
    imageTargetRef.current = "end";
    fileInputRef.current?.click();
  };

  const openVideoUpload = () => videoFileInputRef.current?.click();
  const openAudioUpload = () => audioFileInputRef.current?.click();
  const openAnyUpload = () => anyFileInputRef.current?.click();

  const openGallery = (target: "start" | "end" | "video" | "audio") => {
    if (target === "end") {
      if (!endFrameEnabledRef.current) return;
      endGalleryEpochRef.current = endFrameEpochRef.current;
    }
    setGalleryTarget(target);
    setIsGalleryModalOpen(true);
  };

  const processImageFiles = (files: File[], uploadTarget: "start" | "end") => {
    if (uploadTarget === "end") {
      cancelEndFrameUpload();
      if (!endFrameEnabledRef.current) return;
    }
    const operationEpoch = imageEpochRef.current;
    const endOperationEpoch = endFrameEpochRef.current;
    const currentCount =
      referenceImagesRef.current.length + uploadingImages.length;
    const availableSlots = Math.max(
      0,
      limitsRef.current.maxImages - currentCount,
    );
    if (availableSlots <= 0 && uploadTarget !== "end") {
      return;
    }

    const filesToProcess =
      uploadTarget === "end"
        ? files.slice(0, 1)
        : files.slice(0, availableSlots);

    filesToProcess.forEach((file) => {
      const entry = makeEntry(file);
      if (uploadTarget === "end") {
        pendingEndEntryRef.current = entry;
        setUploadingEnd(entry);
      } else {
        pendingImageUrlsRef.current.add(entry.previewUrl);
        setUploadingImages((prev) => [...prev, entry]);
      }

      let settled = false;
      const finishEntry = () => {
        discardPendingUrl(entry.previewUrl);
        if (!mountedRef.current) return;
        if (uploadTarget === "end") {
          if (pendingEndEntryRef.current?.id === entry.id) {
            pendingEndEntryRef.current = null;
          }
          setUploadingEnd((current) =>
            current?.id === entry.id ? null : current,
          );
        } else {
          setUploadingImages((prev) => prev.filter((e) => e.id !== entry.id));
        }
      };

      const commit = (url: string, mediaToken: string) => {
        if (settled) return;
        if (operationEpoch !== imageEpochRef.current) {
          reject();
          return;
        }
        if (
          uploadTarget === "end" &&
          (endOperationEpoch !== endFrameEpochRef.current ||
            !endFrameEnabledRef.current ||
            !settersRef.current.setEndFrameImage)
        ) {
          reject();
          return;
        }
        settled = true;
        const referenceImage = asImage({
          id: randomId(),
          url,
          file,
          mediaToken,
        });
        finishEntry();
        if (uploadTarget === "end") {
          settersRef.current.setEndFrameImage?.(referenceImage);
        } else {
          const current = referenceImagesRef.current;
          if (current.length >= limitsRef.current.maxImages) return;
          publishImages([...current, referenceImage]);
        }
      };

      const reject = () => {
        if (settled) return;
        settled = true;
        finishEntry();
      };

      const reader = new FileReader();
      pendingImageReadersRef.current.set(reader, uploadTarget);
      reader.onloadend = async () => {
        pendingImageReadersRef.current.delete(reader);
        if (
          operationEpoch !== imageEpochRef.current ||
          (uploadTarget === "end" &&
            (endOperationEpoch !== endFrameEpochRef.current ||
              !endFrameEnabledRef.current))
        ) {
          reject();
          return;
        }
        if (typeof reader.result !== "string") {
          reject();
          return;
        }
        if (uploadImage) {
          try {
            await uploadImage({
              title: randomTitle("reference-image"),
              assetFile: file,
              progressCallback: (newState) => {
                if (
                  newState.status === UploaderStates.success &&
                  newState.data
                ) {
                  commit(reader.result as string, newState.data);
                } else if (
                  newState.status === UploaderStates.assetError ||
                  newState.status === UploaderStates.imageCreateError
                ) {
                  reject();
                }
              },
            });
          } catch {
            if (mountedRef.current) {
              toast.error("Failed to upload image. Please try again.");
            }
          } finally {
            // A rejected upload, or one that resolves without a terminal
            // callback, must not leave a spinner or preview URL behind.
            reject();
          }
        } else {
          commit(reader.result as string, "");
        }
      };
      reader.onerror = () => {
        pendingImageReadersRef.current.delete(reader);
        reject();
      };
      reader.onabort = () => {
        pendingImageReadersRef.current.delete(reader);
        reject();
      };
      reader.readAsDataURL(file);
    });
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (files.length === 0) return;
    processImageFiles(files, imageTargetRef.current);
  };

  const processVideoFilesNow = async (
    files: File[],
    operationEpoch: number,
  ) => {
    if (
      operationEpoch !== videoEpochRef.current ||
      !settersRef.current.setReferenceVideos
    ) {
      return;
    }
    const baseVideos = referenceVideosRef.current;
    const initialLimits = limitsRef.current;
    const availableSlots = Math.max(
      0,
      initialLimits.maxVideos - baseVideos.length,
    );
    if (availableSlots <= 0) {
      toast.error(
        videoLimitMessage(
          initialLimits.maxVideos,
          initialLimits.maxVideoTotalSec,
        ),
        { id: "video-ref-limit" },
      );
      return;
    }

    const filesToProcess = files.slice(0, availableSlots);
    for (const file of filesToProcess) {
      const duration = await probeFileDuration("video", file);
      if (operationEpoch !== videoEpochRef.current) return;
      if (duration == null) {
        toast.error("Could not read video duration", {
          id: "video-ref-duration",
        });
        continue;
      }
      const currentLimits = limitsRef.current;
      if (referenceVideosRef.current.length >= currentLimits.maxVideos) {
        toast.error(
          videoLimitMessage(
            currentLimits.maxVideos,
            currentLimits.maxVideoTotalSec,
          ),
          { id: "video-ref-limit" },
        );
        break;
      }
      const limitStatus = mediaDurationLimitStatus(
        [
          ...referenceVideosRef.current.map((video) => video.duration),
          duration,
        ],
        currentLimits.maxVideoTotalSec,
      );

      if (limitStatus === "invalid") {
        toast.error("Could not verify video duration", {
          id: "video-ref-duration",
        });
        break;
      }
      if (limitStatus === "over-limit") {
        toast.error(
          `Total video duration cannot exceed ${currentLimits.maxVideoTotalSec}s`,
          { id: "video-ref-limit" },
        );
        break;
      }

      const entry = makeEntry(file);
      pendingVideoEntryRef.current = entry;
      setUploadingVideo(entry);
      let previewCommitted = false;
      let settled = false;

      const commit = (mediaToken: string) => {
        if (settled) return;
        if (operationEpoch !== videoEpochRef.current) {
          reject(false);
          return;
        }
        // Reuse the entry's object URL as the committed thumbnail so it
        // stays alive exactly as long as the ref does.
        const refVideo = asVideo({
          id: randomId(),
          url: entry.previewUrl,
          file,
          mediaToken,
          duration,
        });
        const latestLimits = limitsRef.current;
        const result = appendMediaReference(
          referenceVideosRef.current,
          refVideo,
          {
            maxCount: latestLimits.maxVideos,
            maxTotalSeconds: latestLimits.maxVideoTotalSec,
          },
        );
        settled = true;
        if (pendingVideoEntryRef.current?.id === entry.id) {
          pendingVideoEntryRef.current = null;
        }
        if (mountedRef.current) {
          setUploadingVideo((current) =>
            current?.id === entry.id ? null : current,
          );
        }
        if (result.status === "added") {
          if (publishVideos(result.next)) {
            previewCommitted = true;
            transferPendingUrl(entry.previewUrl);
          } else {
            discardPendingUrl(entry.previewUrl);
          }
        } else if (
          result.status === "over-count" ||
          result.status === "over-duration"
        ) {
          toast.error(
            videoLimitMessage(
              latestLimits.maxVideos,
              latestLimits.maxVideoTotalSec,
            ),
            { id: "video-ref-limit" },
          );
        } else if (result.status === "invalid-duration") {
          toast.error("Could not verify video duration", {
            id: "video-ref-duration",
          });
        }
        if (result.status !== "added") {
          discardPendingUrl(entry.previewUrl);
        }
      };

      const reject = (showError: boolean) => {
        if (settled) return;
        settled = true;
        if (pendingVideoEntryRef.current?.id === entry.id) {
          pendingVideoEntryRef.current = null;
        }
        if (mountedRef.current) {
          setUploadingVideo((current) =>
            current?.id === entry.id ? null : current,
          );
        }
        if (showError && mountedRef.current) {
          toast.error("Failed to upload video. Please upload an MP4 file.");
        }
      };

      if (uploadVideo) {
        try {
          await uploadVideo({
            title: randomTitle("reference-video"),
            assetFile: file,
            progressCallback: (newState) => {
              if (newState.status === UploaderStates.success && newState.data) {
                commit(newState.data);
              } else if (
                newState.status === UploaderStates.assetError ||
                newState.status === UploaderStates.imageCreateError
              ) {
                reject(true);
              }
            },
          });
        } catch {
          reject(true);
        } finally {
          if (!previewCommitted) {
            reject(false);
            discardPendingUrl(entry.previewUrl);
            if (mountedRef.current) {
              setUploadingVideo((current) =>
                current?.id === entry.id ? null : current,
              );
            }
          }
        }
      } else {
        commit("");
      }
    }
  };

  const processVideoFiles = (files: File[]): Promise<void> => {
    const operationEpoch = videoEpochRef.current;
    const operation = videoOperationsRef.current.then(() =>
      processVideoFilesNow(files, operationEpoch),
    );
    videoOperationsRef.current = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  };

  const handleVideoFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(event.target.files || []);
    if (videoFileInputRef.current) videoFileInputRef.current.value = "";
    if (files.length === 0) return;
    await processVideoFiles(files);
  };

  const processAudioFilesNow = async (
    files: File[],
    operationEpoch: number,
  ) => {
    if (
      operationEpoch !== audioEpochRef.current ||
      !settersRef.current.setReferenceAudios
    ) {
      return;
    }
    const audioFiles = files.filter(isAudioFile);
    if (audioFiles.length < files.length) {
      toast.error(AUDIO_FILE_TYPE_ERROR, { id: "audio-ref-type" });
    }
    if (audioFiles.length === 0) return;

    const baseAudios = referenceAudiosRef.current;
    const initialLimits = limitsRef.current;
    const availableSlots = Math.max(
      0,
      initialLimits.maxAudios - baseAudios.length,
    );
    if (availableSlots <= 0) {
      return;
    }

    const filesToProcess = audioFiles.slice(0, availableSlots);
    for (const file of filesToProcess) {
      const duration = await probeFileDuration("audio", file);
      if (operationEpoch !== audioEpochRef.current) return;
      if (duration == null) {
        toast.error("Could not read audio duration", {
          id: "audio-ref-duration",
        });
        continue;
      }
      const currentLimits = limitsRef.current;
      if (referenceAudiosRef.current.length >= currentLimits.maxAudios) {
        break;
      }
      const limitStatus = mediaDurationLimitStatus(
        [
          ...referenceAudiosRef.current.map((audio) => audio.duration),
          duration,
        ],
        currentLimits.maxAudioTotalSec,
      );

      if (limitStatus === "invalid") {
        toast.error("Could not verify audio duration", {
          id: "audio-ref-duration",
        });
        break;
      }
      if (limitStatus === "over-limit") {
        toast.error(
          `Total audio duration cannot exceed ${currentLimits.maxAudioTotalSec}s`,
        );
        break;
      }

      const entry = makeEntry(file);
      pendingAudioEntryRef.current = entry;
      setUploadingAudio(entry);
      let previewCommitted = false;
      let settled = false;

      const commit = (mediaToken: string) => {
        if (settled) return;
        if (operationEpoch !== audioEpochRef.current) {
          reject();
          return;
        }
        const refAudio = asAudio({
          id: randomId(),
          url: entry.previewUrl,
          file,
          mediaToken,
          duration,
        });
        const latestLimits = limitsRef.current;
        const result = appendMediaReference(
          referenceAudiosRef.current,
          refAudio,
          {
            maxCount: latestLimits.maxAudios,
            maxTotalSeconds: latestLimits.maxAudioTotalSec,
          },
        );
        settled = true;
        if (pendingAudioEntryRef.current?.id === entry.id) {
          pendingAudioEntryRef.current = null;
        }
        if (mountedRef.current) {
          setUploadingAudio((current) =>
            current?.id === entry.id ? null : current,
          );
        }
        if (result.status === "added") {
          if (publishAudios(result.next)) {
            previewCommitted = true;
            transferPendingUrl(entry.previewUrl);
          } else {
            discardPendingUrl(entry.previewUrl);
          }
        } else if (
          result.status === "over-count" ||
          result.status === "over-duration"
        ) {
          toast.error(
            `Total audio duration cannot exceed ${latestLimits.maxAudioTotalSec}s`,
          );
        } else if (result.status === "invalid-duration") {
          toast.error("Could not verify audio duration", {
            id: "audio-ref-duration",
          });
        }
        if (result.status !== "added") {
          discardPendingUrl(entry.previewUrl);
        }
      };

      const reject = () => {
        if (settled) return;
        settled = true;
        if (pendingAudioEntryRef.current?.id === entry.id) {
          pendingAudioEntryRef.current = null;
        }
        if (mountedRef.current) {
          setUploadingAudio((current) =>
            current?.id === entry.id ? null : current,
          );
        }
      };

      if (uploadAudio) {
        try {
          await uploadAudio({
            title: randomTitle("reference-audio"),
            assetFile: file,
            progressCallback: (newState) => {
              if (newState.status === UploaderStates.success && newState.data) {
                commit(newState.data);
              } else if (
                newState.status === UploaderStates.assetError ||
                newState.status === UploaderStates.imageCreateError
              ) {
                reject();
              }
            },
          });
        } catch {
          reject();
          if (mountedRef.current) {
            toast.error("Failed to upload audio. Please try again.");
          }
        } finally {
          if (!previewCommitted) {
            reject();
            discardPendingUrl(entry.previewUrl);
            if (mountedRef.current) {
              setUploadingAudio((current) =>
                current?.id === entry.id ? null : current,
              );
            }
          }
        }
      } else {
        commit("");
      }
    }
  };

  const processAudioFiles = (files: File[]): Promise<void> => {
    const operationEpoch = audioEpochRef.current;
    const operation = audioOperationsRef.current.then(() =>
      processAudioFilesNow(files, operationEpoch),
    );
    audioOperationsRef.current = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  };

  const handleAudioFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(event.target.files || []);
    if (audioFileInputRef.current) audioFileInputRef.current.value = "";
    if (files.length === 0) return;
    await processAudioFiles(files);
  };

  // Combined picker for direct clicks on the reference card / circular "+":
  // accepts every supported media kind and routes each file by MIME type.
  const handleAnyFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (anyFileInputRef.current) anyFileInputRef.current.value = "";
    if (files.length === 0) return;

    const images = files.filter((f) => f.type.startsWith("image/"));
    // isAudioFile also claims .m4a files that platforms report as video/mp4,
    // so exclude them from the video bucket.
    const audios = files.filter(isAudioFile);
    const videos = files.filter(
      (f) => f.type.startsWith("video/") && !isAudioFile(f),
    );

    if (images.length > 0) processImageFiles(images, "start");
    if (videos.length > 0 && setReferenceVideos) processVideoFiles(videos);
    if (audios.length > 0 && setReferenceAudios) processAudioFiles(audios);
  };

  // maxImages of 0 means the page's model takes no image refs at all.
  const anyUploadAccept = [
    ...(maxImages > 0 ? ["image/*"] : []),
    ...(setReferenceVideos ? ["video/mp4", ".mp4"] : []),
    ...(setReferenceAudios ? [AUDIO_FILE_ACCEPT] : []),
  ].join(",");

  const handleGalleryClose = () => {
    if (!mountedRef.current) return;
    if (galleryTarget === "video") {
      videoGalleryEpochRef.current++;
      abortPendingProbes("video", "gallery");
    } else if (galleryTarget === "audio") {
      audioGalleryEpochRef.current++;
      abortPendingProbes("audio", "gallery");
    } else if (galleryTarget === "end") {
      endGalleryEpochRef.current++;
    }
    setIsProcessingGallery(false);
    setIsGalleryModalOpen(false);
    setSelectedGalleryImages([]);
  };

  const handleImageSelect = (id: string) => {
    setSelectedGalleryImages((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      const maxSelections =
        galleryTarget === "video"
          ? Math.max(1, maxVideos - referenceVideos.length)
          : galleryTarget === "audio"
            ? Math.max(1, maxAudios - referenceAudios.length)
            : galleryTarget === "end"
              ? 1
              : Math.max(1, maxImages);
      if (prev.length >= maxSelections) {
        return maxSelections === 1 ? [id] : prev;
      }
      return [...prev, id];
    });
  };

  const handleGalleryImages = async (selectedItems: GalleryItem[]) => {
    if (galleryTarget === "video") {
      const operationEpoch = videoEpochRef.current;
      const galleryEpoch = videoGalleryEpochRef.current;
      const baseVideos = referenceVideosRef.current;
      const availableSlots = Math.max(0, maxVideos - baseVideos.length);
      if (availableSlots <= 0) {
        toast.error(videoLimitMessage(maxVideos, maxVideoTotalSec), {
          id: "video-ref-limit",
        });
        handleGalleryClose();
        return;
      }
      const itemsToProcess = selectedItems
        .slice(0, availableSlots)
        .filter((item): item is GalleryItem & { fullImage: string } =>
          Boolean(item.fullImage),
        );

      setIsProcessingGallery(true);
      try {
        // Generation measures the current file, so the quote and cap checks
        // always probe that same URL rather than trusting stale list metadata.
        const durations = await Promise.all(
          itemsToProcess.map((item) => probeDuration("video", item.fullImage)),
        );
        if (
          operationEpoch !== videoEpochRef.current ||
          galleryEpoch !== videoGalleryEpochRef.current
        ) {
          handleGalleryClose();
          return;
        }

        const unreadableCount = durations.filter(
          (duration) => duration == null,
        ).length;
        if (unreadableCount > 0) {
          toast.error(
            `Could not read ${unreadableCount} selected video${unreadableCount === 1 ? "" : "s"}`,
            { id: "video-ref-duration" },
          );
        }

        let nextVideos = referenceVideosRef.current;
        let exceeded = false;
        for (let i = 0; i < itemsToProcess.length; i++) {
          if (
            operationEpoch !== videoEpochRef.current ||
            galleryEpoch !== videoGalleryEpochRef.current
          ) {
            handleGalleryClose();
            return;
          }
          const item = itemsToProcess[i]!;
          const duration = durations[i]!;
          if (duration == null) continue;
          const candidate = asVideo({
            id: randomId(),
            url: item.fullImage,
            mediaToken: item.id,
            duration,
          });
          const currentLimits = limitsRef.current;
          const result = appendMediaReference(nextVideos, candidate, {
            maxCount: currentLimits.maxVideos,
            maxTotalSeconds: currentLimits.maxVideoTotalSec,
          });
          if (result.status === "invalid-duration") {
            toast.error("Could not verify video duration", {
              id: "video-ref-duration",
            });
            break;
          }
          if (
            result.status === "over-count" ||
            result.status === "over-duration"
          ) {
            exceeded = true;
            break;
          }
          if (result.status === "added") nextVideos = result.next;
        }
        if (exceeded) {
          const currentLimits = limitsRef.current;
          toast.error(
            `Total video duration cannot exceed ${currentLimits.maxVideoTotalSec}s`,
            { id: "video-ref-limit" },
          );
        }
        if (nextVideos !== referenceVideosRef.current) {
          publishVideos(nextVideos);
        }
      } finally {
        if (mountedRef.current) setIsProcessingGallery(false);
      }
      handleGalleryClose();
      return;
    }
    if (galleryTarget === "audio") {
      const operationEpoch = audioEpochRef.current;
      const galleryEpoch = audioGalleryEpochRef.current;
      const baseAudios = referenceAudiosRef.current;
      const availableSlots = Math.max(0, maxAudios - baseAudios.length);
      if (availableSlots <= 0) {
        toast.error(
          `Max ${maxAudios} audio tracks / ${maxAudioTotalSec}s total`,
          {
            id: "audio-ref-limit",
          },
        );
        handleGalleryClose();
        return;
      }
      const itemsToProcess = selectedItems
        .slice(0, availableSlots)
        .filter((item): item is GalleryItem & { fullImage: string } =>
          Boolean(item.fullImage),
        );

      setIsProcessingGallery(true);
      try {
        // Keep audio state aligned with the actual selected media too.
        const durations = await Promise.all(
          itemsToProcess.map((item) => probeDuration("audio", item.fullImage)),
        );
        if (
          operationEpoch !== audioEpochRef.current ||
          galleryEpoch !== audioGalleryEpochRef.current
        ) {
          handleGalleryClose();
          return;
        }

        const unreadableCount = durations.filter(
          (duration) => duration == null,
        ).length;
        if (unreadableCount > 0) {
          toast.error(
            `Could not read ${unreadableCount} selected audio file${unreadableCount === 1 ? "" : "s"}`,
            { id: "audio-ref-duration" },
          );
        }

        let nextAudios = referenceAudiosRef.current;
        let exceeded = false;
        for (let i = 0; i < itemsToProcess.length; i++) {
          if (
            operationEpoch !== audioEpochRef.current ||
            galleryEpoch !== audioGalleryEpochRef.current
          ) {
            handleGalleryClose();
            return;
          }
          const item = itemsToProcess[i]!;
          const duration = durations[i]!;
          if (duration == null) continue;
          const candidate = asAudio({
            id: randomId(),
            url: item.fullImage,
            mediaToken: item.id,
            duration,
          });
          const currentLimits = limitsRef.current;
          const result = appendMediaReference(nextAudios, candidate, {
            maxCount: currentLimits.maxAudios,
            maxTotalSeconds: currentLimits.maxAudioTotalSec,
          });
          if (result.status === "invalid-duration") {
            toast.error("Could not verify audio duration", {
              id: "audio-ref-duration",
            });
            break;
          }
          if (
            result.status === "over-count" ||
            result.status === "over-duration"
          ) {
            exceeded = true;
            break;
          }
          if (result.status === "added") nextAudios = result.next;
        }
        if (exceeded) {
          const currentLimits = limitsRef.current;
          toast.error(
            `Total audio duration cannot exceed ${currentLimits.maxAudioTotalSec}s`,
            { id: "audio-ref-limit" },
          );
        }
        if (nextAudios !== referenceAudiosRef.current) {
          publishAudios(nextAudios);
        }
      } finally {
        if (mountedRef.current) setIsProcessingGallery(false);
      }
      handleGalleryClose();
      return;
    }
    if (galleryTarget === "end") {
      if (
        !endFrameEnabledRef.current ||
        endGalleryEpochRef.current !== endFrameEpochRef.current
      ) {
        handleGalleryClose();
        return;
      }
      const item = selectedItems[0];
      if (item && item.fullImage) {
        settersRef.current.setEndFrameImage?.(
          asImage({
            id: randomId(),
            url: item.fullImage,
            mediaToken: item.id,
          }),
        );
      }
      handleGalleryClose();
      return;
    }
    const currentImages = referenceImagesRef.current;
    const availableSlots = Math.max(0, maxImages - currentImages.length);
    if (availableSlots <= 0) {
      handleGalleryClose();
      return;
    }

    const newRefs = [...currentImages];
    selectedItems.slice(0, availableSlots).forEach((item) => {
      if (!item.fullImage) return;
      newRefs.push(
        asImage({
          id: randomId(),
          url: item.fullImage,
          mediaToken: item.id,
        }),
      );
    });
    publishImages(newRefs);
    handleGalleryClose();
  };

  const availableImageSlots = Math.max(
    0,
    maxImages - referenceImages.length - uploadingImages.length,
  );

  const fileInputs: ReactNode = (
    <>
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept="image/*"
        onChange={handleFileUpload}
        multiple={maxImages > 1}
      />
      <input
        type="file"
        ref={anyFileInputRef}
        className="hidden"
        accept={anyUploadAccept}
        onChange={handleAnyFileUpload}
        multiple
      />
      {(uploadVideo || setReferenceVideos) && (
        <input
          type="file"
          ref={videoFileInputRef}
          className="hidden"
          accept="video/mp4,.mp4"
          onChange={handleVideoFileUpload}
          multiple={maxVideos > 1}
        />
      )}
      {(uploadAudio || setReferenceAudios) && (
        <input
          type="file"
          ref={audioFileInputRef}
          className="hidden"
          accept={AUDIO_FILE_ACCEPT}
          onChange={handleAudioFileUpload}
          multiple={maxAudios > 1}
        />
      )}
    </>
  );

  // Tokens already in the deck slot the picker targets, greyed out in the
  // gallery so one media file can't be added twice to the same field. Reusing
  // an image across slots (e.g. start AND end frame) stays allowed.
  const disabledGalleryIds = useMemo(() => {
    if (galleryTarget === "video") {
      return referenceVideos
        .map((video) => video.mediaToken)
        .filter((t): t is string => !!t);
    }
    if (galleryTarget === "audio") {
      return referenceAudios
        .map((audio) => audio.mediaToken)
        .filter((t): t is string => !!t);
    }
    if (galleryTarget === "end") {
      return endFrameImage?.mediaToken ? [endFrameImage.mediaToken] : [];
    }
    return referenceImages
      .map((img) => img.mediaToken)
      .filter((t): t is string => !!t);
  }, [
    galleryTarget,
    referenceImages,
    referenceVideos,
    referenceAudios,
    endFrameImage,
  ]);

  const galleryModal: ReactNode = ownGalleryModal ? (
    <GalleryModal
      key={
        galleryTarget === "video"
          ? "video"
          : galleryTarget === "audio"
            ? "audio"
            : "image"
      }
      isOpen={!!isGalleryModalOpen}
      onClose={handleGalleryClose}
      mode="select"
      selectedItemIds={selectedGalleryImages}
      disabledItemIds={disabledGalleryIds}
      onSelectItem={handleImageSelect}
      maxSelections={
        galleryTarget === "end"
          ? 1
          : galleryTarget === "video"
            ? Math.max(1, maxVideos - referenceVideos.length)
            : galleryTarget === "audio"
              ? Math.max(1, maxAudios - referenceAudios.length)
              : Math.max(1, availableImageSlots)
      }
      onUseSelected={handleGalleryImages}
      onDownloadClicked={downloadFileFromUrl}
      useSelectedLoading={isProcessingGallery}
      forceFilter={
        galleryTarget === "video"
          ? "video"
          : galleryTarget === "audio"
            ? "audio"
            : "image"
      }
    />
  ) : null;

  return {
    uploadingImages,
    uploadingEnd,
    uploadingVideo,
    uploadingAudio,
    availableImageSlots,
    replaceImages,
    replaceVideos,
    replaceAudios,
    removeReference,
    reorderImages,
    clearReferences,
    processImageFiles,
    processVideoFiles,
    processAudioFiles,
    openImageUpload,
    openEndUpload,
    openVideoUpload,
    openAudioUpload,
    openAnyUpload,
    openGallery,
    fileInputs,
    galleryModal,
  };
}
