import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Button } from "@storyteller/ui-button";
import { Tooltip } from "@storyteller/ui-tooltip";
import { GalleryItem, GalleryModal } from "@storyteller/ui-gallery-modal";
import { downloadFileFromUrl } from "@storyteller/api";
import { ImageIcon, ImagesIcon, LoaderCircleIcon, MusicIcon, PlayIcon, PlusIcon, SquareIcon, Trash2Icon, VideoIcon, XIcon } from "lucide-react";
import { DynamicIcon } from "@storyteller/icons";
import { RefImage, RefVideo, RefAudio } from "./promptStore";
import { toast } from "@storyteller/ui-toaster";
import { twMerge } from "tailwind-merge";
import {
  UploaderStates,
  appendMediaReference,
  createOwnedMediaObjectUrl,
  discardOwnedMediaObjectUrl,
  formatMediaDurationMillis,
  formatMediaDurationSeconds,
  normalizeMediaDurationSeconds,
  MEDIA_DURATION_PROBE_TIMEOUT_MS,
  sumMediaDurationMillis,
} from "@storyteller/common";
import {
  AUDIO_FILE_ACCEPT,
  AUDIO_FILE_TYPE_ERROR,
  isAudioFile,
} from "./common/audioFiles";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import type { UploadMediaFn } from "@storyteller/api";
export type { UploadMediaFn as UploadImageFn } from "@storyteller/api";
type UploadImageFn = UploadMediaFn;

type PendingCancellation = () => void;

const cancelPending = (pending: Set<PendingCancellation>) => {
  const cancellations = [...pending];
  pending.clear();
  cancellations.forEach((cancel) => cancel());
};

interface ImagePromptRowProps {
  visible: boolean;
  className?: string;
  maxImagePromptCount: number;
  allowUpload: boolean;
  referenceImages: RefImage[];
  setReferenceImages: (images: RefImage[]) => void;
  onVisibilityChange?: (visible: boolean) => void;
  uploadImage?: UploadImageFn;
  onImageClick?: (image: RefImage) => void;
  isVideo?: boolean;
  isReferenceMode?: boolean;
  endFrameImage?: RefImage;
  setEndFrameImage?: (image?: RefImage) => void;
  allowUploadEnd?: boolean;
  showEndFrameSection?: boolean;
  referenceVideos?: RefVideo[];
  setReferenceVideos?: (videos: RefVideo[]) => void;
  maxVideoCount?: number;
  maxVideoRefDuration?: number;
  showVideoReferenceSection?: boolean;
  uploadVideo?: UploadImageFn;
  referenceAudios?: RefAudio[];
  setReferenceAudios?: (audios: RefAudio[]) => void;
  maxAudioCount?: number;
  maxAudioRefDuration?: number;
  uploadAudio?: UploadImageFn;
}

const AudioRefTile = ({
  audio,
  index,
  onRemove,
}: {
  audio: RefAudio;
  index: number;
  onRemove: (id: string) => void;
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const handleTogglePlay = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isPlaying) {
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current.currentTime = 0;
        }
        setIsPlaying(false);
      } else {
        const el = new Audio(audio.url);
        el.volume = 0.2;
        audioRef.current = el;
        el.onended = () => setIsPlaying(false);
        el.play();
        setIsPlaying(true);
      }
    },
    [isPlaying, audio.url],
  );

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  return (
    <div className="glass relative aspect-square overflow-hidden rounded-lg w-14 border-2 border-white/30 hover:border-white/80 transition-all group cursor-pointer flex items-center justify-center">
      <button
        onClick={handleTogglePlay}
        className="flex items-center justify-center w-full h-full"
      >
        <DynamicIcon
          icon={isPlaying ? SquareIcon : PlayIcon}
          className={twMerge(
            "h-5 w-5 transition-colors",
            isPlaying
              ? "text-red-400"
              : "text-base-fg/60 group-hover:text-base-fg",
          )}
        />
      </button>
      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-center bg-black/70 py-0.5 text-[10px] font-bold text-white pointer-events-none">
        #{index + 1} · {formatMediaDurationSeconds(audio.duration)}s
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current = null;
          }
          onRemove(audio.id);
        }}
        className="opacity-0 group-hover:opacity-100 absolute right-[2px] top-[2px] flex h-5 w-5 items-center justify-center rounded-full bg-black/50 hover:bg-red/70 text-white backdrop-blur-md transition-colors hover:bg-black cursor-pointer"
      >
        <XIcon  className="h-2.5 w-2.5" />
      </button>
    </div>
  );
};

export const ImagePromptRow = ({
  visible,
  className,
  maxImagePromptCount,
  allowUpload,
  referenceImages,
  setReferenceImages,
  onVisibilityChange,
  uploadImage,
  onImageClick,
  isVideo,
  isReferenceMode,
  endFrameImage,
  setEndFrameImage,
  allowUploadEnd,
  showEndFrameSection = true,
  referenceVideos = [],
  setReferenceVideos,
  maxVideoCount = 3,
  maxVideoRefDuration = 15,
  showVideoReferenceSection,
  uploadVideo,
  referenceAudios = [],
  setReferenceAudios,
  maxAudioCount = 2,
  maxAudioRefDuration = 15,
  uploadAudio,
}: ImagePromptRowProps) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoFileInputRef = useRef<HTMLInputElement>(null);
  const audioFileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingImages, setUploadingImages] = useState<
    { id: string; file: File; previewUrl: string }[]
  >([]);
  const [isGalleryModalOpen, setIsGalleryModalOpen] = useState(false);
  const [galleryTarget, setGalleryTarget] = useState<"start" | "end" | "video">(
    "start",
  );
  const [uploadTarget, setUploadTarget] = useState<"start" | "end" | "video">(
    "start",
  );
  const [selectedGalleryImages, setSelectedGalleryImages] = useState<string[]>(
    [],
  );
  const [uploadingEnd, setUploadingEnd] = useState<{
    id: string;
    file: File;
    previewUrl: string;
  } | null>(null);
  const [uploadingVideo, setUploadingVideo] = useState<{
    id: string;
    file: File;
    previewUrl: string;
  } | null>(null);
  const [uploadingAudio, setUploadingAudio] = useState<{
    id: string;
    file: File;
    previewUrl: string;
  } | null>(null);
  const [isProcessingGallery, setIsProcessingGallery] = useState(false);

  const mountedRef = useRef(true);
  const imageEpochRef = useRef(0);
  const endEpochRef = useRef(0);
  const videoEpochRef = useRef(0);
  const videoGalleryEpochRef = useRef(0);
  const audioEpochRef = useRef(0);
  const pendingImageOperationsRef = useRef(new Set<PendingCancellation>());
  const pendingEndOperationsRef = useRef(new Set<PendingCancellation>());
  const pendingVideoOperationsRef = useRef(new Set<PendingCancellation>());
  const pendingVideoGalleryProbesRef = useRef(new Set<PendingCancellation>());
  const pendingAudioOperationsRef = useRef(new Set<PendingCancellation>());

  const livePolicyRef = useRef({
    visible,
    allowUpload,
    allowUploadEnd,
    isVideo,
    isReferenceMode,
    showEndFrameSection,
    showVideoReferenceSection,
    maxImagePromptCount,
    maxVideoCount,
    maxVideoRefDuration,
    maxAudioCount,
    maxAudioRefDuration,
    setEndFrameImage,
    setReferenceVideos,
    setReferenceAudios,
  });
  livePolicyRef.current = {
    visible,
    allowUpload,
    allowUploadEnd,
    isVideo,
    isReferenceMode,
    showEndFrameSection,
    showVideoReferenceSection,
    maxImagePromptCount,
    maxVideoCount,
    maxVideoRefDuration,
    maxAudioCount,
    maxAudioRefDuration,
    setEndFrameImage,
    setReferenceVideos,
    setReferenceAudios,
  };

  const imagePolicySignature = [
    visible,
    allowUpload,
    isVideo,
    isReferenceMode,
    maxImagePromptCount,
  ].join("|");
  const endPolicySignature = [
    visible,
    allowUploadEnd,
    isVideo,
    isReferenceMode,
    showEndFrameSection,
    maxImagePromptCount,
  ].join("|");
  const videoPolicySignature = [
    visible,
    isVideo,
    isReferenceMode,
    showVideoReferenceSection,
    maxVideoCount,
    maxVideoRefDuration,
    Boolean(setReferenceVideos),
  ].join("|");
  const audioPolicySignature = [
    visible,
    isVideo,
    isReferenceMode,
    showVideoReferenceSection,
    maxAudioCount,
    maxAudioRefDuration,
    Boolean(setReferenceAudios),
  ].join("|");

  const renderedPolicySignaturesRef = useRef({
    image: imagePolicySignature,
    end: endPolicySignature,
    video: videoPolicySignature,
    audio: audioPolicySignature,
  });
  if (renderedPolicySignaturesRef.current.image !== imagePolicySignature) {
    imageEpochRef.current += 1;
  }
  if (renderedPolicySignaturesRef.current.end !== endPolicySignature) {
    endEpochRef.current += 1;
  }
  if (renderedPolicySignaturesRef.current.video !== videoPolicySignature) {
    videoEpochRef.current += 1;
  }
  if (renderedPolicySignaturesRef.current.audio !== audioPolicySignature) {
    audioEpochRef.current += 1;
  }
  renderedPolicySignaturesRef.current = {
    image: imagePolicySignature,
    end: endPolicySignature,
    video: videoPolicySignature,
    audio: audioPolicySignature,
  };

  const referenceImagesRef = useRef(referenceImages);
  const referenceVideosRef = useRef(referenceVideos);
  const referenceAudiosRef = useRef(referenceAudios);
  const lastPublishedImagesRef = useRef<RefImage[] | null>(null);
  const lastPublishedVideosRef = useRef<RefVideo[] | null>(null);
  const lastPublishedAudiosRef = useRef<RefAudio[] | null>(null);
  const previousImagesPropRef = useRef(referenceImages);
  const previousVideosPropRef = useRef(referenceVideos);
  const previousAudiosPropRef = useRef(referenceAudios);

  const imagesExternallyCleared =
    previousImagesPropRef.current !== referenceImages &&
    lastPublishedImagesRef.current !== referenceImages &&
    referenceImages.length === 0;
  const videosExternallyCleared =
    Boolean(setReferenceVideos) &&
    previousVideosPropRef.current !== referenceVideos &&
    lastPublishedVideosRef.current !== referenceVideos &&
    referenceVideos.length === 0;
  const audiosExternallyCleared =
    Boolean(setReferenceAudios) &&
    previousAudiosPropRef.current !== referenceAudios &&
    lastPublishedAudiosRef.current !== referenceAudios &&
    referenceAudios.length === 0;
  if (imagesExternallyCleared) imageEpochRef.current += 1;
  if (videosExternallyCleared) videoEpochRef.current += 1;
  if (audiosExternallyCleared) audioEpochRef.current += 1;

  if (previousImagesPropRef.current !== referenceImages) {
    previousImagesPropRef.current = referenceImages;
    lastPublishedImagesRef.current = null;
  }
  if (previousVideosPropRef.current !== referenceVideos) {
    previousVideosPropRef.current = referenceVideos;
    lastPublishedVideosRef.current = null;
  }
  if (previousAudiosPropRef.current !== referenceAudios) {
    previousAudiosPropRef.current = referenceAudios;
    lastPublishedAudiosRef.current = null;
  }
  referenceImagesRef.current = referenceImages;
  referenceVideosRef.current = referenceVideos;
  referenceAudiosRef.current = referenceAudios;

  const publishImages = (next: RefImage[]) => {
    referenceImagesRef.current = next;
    lastPublishedImagesRef.current = next;
    setReferenceImages(next);
  };
  const publishVideos = (next: RefVideo[]) => {
    const setter = livePolicyRef.current.setReferenceVideos;
    if (!setter) return false;
    referenceVideosRef.current = next;
    lastPublishedVideosRef.current = next;
    setter(next);
    return true;
  };
  const publishAudios = (next: RefAudio[]) => {
    const setter = livePolicyRef.current.setReferenceAudios;
    if (!setter) return false;
    referenceAudiosRef.current = next;
    lastPublishedAudiosRef.current = next;
    setter(next);
    return true;
  };

  const videoOperationsRef = useRef<Promise<void>>(Promise.resolve());
  const audioOperationsRef = useRef<Promise<void>>(Promise.resolve());

  const imageUploadSupported = () => {
    const policy = livePolicyRef.current;
    return (
      mountedRef.current &&
      policy.visible &&
      policy.allowUpload &&
      policy.maxImagePromptCount > 0
    );
  };
  const imageGallerySupported = () => {
    const policy = livePolicyRef.current;
    return (
      mountedRef.current && policy.visible && policy.maxImagePromptCount > 0
    );
  };
  const endUploadSupported = () => {
    const policy = livePolicyRef.current;
    return (
      mountedRef.current &&
      policy.visible &&
      policy.allowUploadEnd &&
      policy.isVideo === true &&
      policy.isReferenceMode !== true &&
      policy.showEndFrameSection === true &&
      Boolean(policy.setEndFrameImage)
    );
  };
  const endGallerySupported = () => {
    const policy = livePolicyRef.current;
    return (
      mountedRef.current &&
      policy.visible &&
      policy.isVideo === true &&
      policy.isReferenceMode !== true &&
      policy.showEndFrameSection === true &&
      Boolean(policy.setEndFrameImage)
    );
  };
  const videoReferencesSupported = () => {
    const policy = livePolicyRef.current;
    return (
      mountedRef.current &&
      policy.visible &&
      policy.isVideo === true &&
      policy.isReferenceMode !== false &&
      policy.showVideoReferenceSection === true &&
      policy.maxVideoCount > 0 &&
      Boolean(policy.setReferenceVideos)
    );
  };
  const audioReferencesSupported = () => {
    const policy = livePolicyRef.current;
    return (
      mountedRef.current &&
      policy.visible &&
      policy.isVideo === true &&
      policy.isReferenceMode !== false &&
      policy.showVideoReferenceSection === true &&
      policy.maxAudioCount > 0 &&
      Boolean(policy.setReferenceAudios)
    );
  };

  const cancelImageOperations = (advanceEpoch = true) => {
    if (advanceEpoch) imageEpochRef.current += 1;
    cancelPending(pendingImageOperationsRef.current);
    if (mountedRef.current) setUploadingImages([]);
  };
  const cancelEndOperations = (advanceEpoch = true) => {
    if (advanceEpoch) endEpochRef.current += 1;
    cancelPending(pendingEndOperationsRef.current);
    if (mountedRef.current) setUploadingEnd(null);
  };
  const cancelVideoOperations = (advanceEpoch = true) => {
    if (advanceEpoch) videoEpochRef.current += 1;
    cancelPending(pendingVideoOperationsRef.current);
    cancelPending(pendingVideoGalleryProbesRef.current);
    videoOperationsRef.current = Promise.resolve();
    if (mountedRef.current) {
      setUploadingVideo(null);
      setIsProcessingGallery(false);
    }
  };
  const cancelAudioOperations = (advanceEpoch = true) => {
    if (advanceEpoch) audioEpochRef.current += 1;
    cancelPending(pendingAudioOperationsRef.current);
    audioOperationsRef.current = Promise.resolve();
    if (mountedRef.current) setUploadingAudio(null);
  };

  const appliedPolicySignaturesRef = useRef(
    renderedPolicySignaturesRef.current,
  );
  useEffect(() => {
    const previous = appliedPolicySignaturesRef.current;
    if (previous.image !== imagePolicySignature) {
      cancelImageOperations(false);
    }
    if (previous.end !== endPolicySignature) {
      cancelEndOperations(false);
    }
    if (previous.video !== videoPolicySignature) {
      cancelVideoOperations(false);
    }
    if (previous.audio !== audioPolicySignature) {
      cancelAudioOperations(false);
    }
    if (
      previous.image !== imagePolicySignature ||
      previous.end !== endPolicySignature ||
      previous.video !== videoPolicySignature ||
      previous.audio !== audioPolicySignature
    ) {
      setIsGalleryModalOpen(false);
      setSelectedGalleryImages([]);
    }
    appliedPolicySignaturesRef.current = {
      image: imagePolicySignature,
      end: endPolicySignature,
      video: videoPolicySignature,
      audio: audioPolicySignature,
    };
  }, [
    imagePolicySignature,
    endPolicySignature,
    videoPolicySignature,
    audioPolicySignature,
  ]);

  useEffect(() => {
    if (imagesExternallyCleared) cancelImageOperations(false);
    if (videosExternallyCleared) cancelVideoOperations(false);
    if (audiosExternallyCleared) cancelAudioOperations(false);
  }, [referenceImages, referenceVideos, referenceAudios]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      imageEpochRef.current += 1;
      endEpochRef.current += 1;
      videoEpochRef.current += 1;
      audioEpochRef.current += 1;
      cancelPending(pendingImageOperationsRef.current);
      cancelPending(pendingEndOperationsRef.current);
      cancelPending(pendingVideoOperationsRef.current);
      cancelPending(pendingVideoGalleryProbesRef.current);
      cancelPending(pendingAudioOperationsRef.current);
      videoOperationsRef.current = Promise.resolve();
      audioOperationsRef.current = Promise.resolve();
    };
  }, []);

  const allowReorder = useMemo(
    () => maxImagePromptCount > 1 && referenceImages.length > 1,
    [maxImagePromptCount, referenceImages.length],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const SortableImage = ({
    image,
    index,
  }: {
    image: RefImage;
    index: number;
  }) => {
    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
      isDragging,
    } = useSortable({ id: image.id });

    const style: CSSProperties = {
      transform: CSS.Transform.toString(transform),
      transition,
      zIndex: isDragging ? 9999 : undefined,
    };

    return (
      <div
        ref={setNodeRef}
        style={style}
        {...(allowReorder ? { ...attributes, ...listeners } : {})}
        className={twMerge(
          "glass relative aspect-square overflow-hidden rounded-lg w-14 border-2 border-white/30 transition-opacity group",
          allowReorder
            ? "cursor-move hover:border-white/80"
            : "cursor-pointer hover:border-white/80",
          isDragging ? "opacity-50 shadow-lg" : "",
        )}
        onClick={() => onImageClick?.(image)}
      >
        <img
          src={image.url}
          alt="Reference"
          className="h-full w-full object-cover"
        />
        {isReferenceMode && (
          <div className="absolute bottom-0 left-0 right-0 flex items-center justify-center bg-black/60 py-0.5 text-[11px] font-bold text-white">
            {index + 1}
          </div>
        )}
        <button
          aria-label={`Remove reference image ${index + 1}`}
          onClick={(e) => {
            e.stopPropagation();
            handleRemoveReference(image.id);
          }}
          onMouseDown={(e) => {
            e.stopPropagation();
          }}
          onPointerDown={(e) => {
            e.stopPropagation();
          }}
          className="opacity-0 group-hover:opacity-100 absolute right-[2px] top-[2px] flex h-5 w-5 items-center justify-center rounded-full bg-black/50 hover:bg-red/70 text-white backdrop-blur-md transition-colors hover:bg-black cursor-pointer"
        >
          <XIcon  className="h-2.5 w-2.5" />
        </button>
      </div>
    );
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const current = referenceImagesRef.current;
    const oldIndex = current.findIndex((img) => img.id === active.id);
    const newIndex = current.findIndex((img) => img.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    publishImages(arrayMove(current, oldIndex, newIndex));
  };

  const usedSlotsRender = useMemo(
    () =>
      Math.min(
        maxImagePromptCount,
        referenceImages.length + uploadingImages.length,
      ),
    [maxImagePromptCount, referenceImages.length, uploadingImages.length],
  );
  const availableSlotsRender = useMemo(
    () =>
      Math.max(
        0,
        maxImagePromptCount - referenceImages.length - uploadingImages.length,
      ),
    [maxImagePromptCount, referenceImages.length, uploadingImages.length],
  );

  useEffect(() => {
    const anyVisible =
      visible &&
      (referenceImages.length > 0 || uploadingImages.length > 0 || allowUpload);
    onVisibilityChange?.(!!anyVisible);
  }, [
    visible,
    referenceImages.length,
    uploadingImages.length,
    allowUpload,
    onVisibilityChange,
  ]);

  const handleRemoveReference = (id: string) => {
    publishImages(
      referenceImagesRef.current.filter((image) => image.id !== id),
    );
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleUploadClick = () => fileInputRef.current?.click();
  const handleUploadClickStart = () => {
    setUploadTarget("start");
    handleUploadClick();
  };
  const handleUploadClickEnd = () => {
    setUploadTarget("end");
    handleUploadClick();
  };
  const handleUploadClickVideo = () => {
    setUploadTarget("video");
    videoFileInputRef.current?.click();
  };

  const probeMediaDuration = (
    kind: "video" | "audio",
    src: string,
    pending: Set<PendingCancellation>,
    releaseOwnedUrl?: () => void,
  ): Promise<number | null> =>
    new Promise((resolve) => {
      const media = document.createElement(kind);
      let settled = false;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const finish = (duration: number | null) => {
        if (settled) return;
        settled = true;
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        pending.delete(cancel);
        media.onloadedmetadata = null;
        media.onerror = null;
        media.removeAttribute("src");
        releaseOwnedUrl?.();
        resolve(duration);
      };
      const cancel = () => finish(null);
      pending.add(cancel);
      media.preload = "metadata";
      media.onloadedmetadata = () =>
        finish(normalizeMediaDurationSeconds(media.duration));
      media.onerror = () => finish(null);
      timeoutId = setTimeout(
        () => finish(null),
        MEDIA_DURATION_PROBE_TIMEOUT_MS,
      );
      try {
        media.src = src;
      } catch {
        finish(null);
      }
    });

  const getVideoDurationFromSrc = (src: string): Promise<number | null> =>
    probeMediaDuration("video", src, pendingVideoGalleryProbesRef.current);

  const getVideoDuration = (file: File): Promise<number | null> => {
    const src = createOwnedMediaObjectUrl(file);
    return probeMediaDuration(
      "video",
      src,
      pendingVideoOperationsRef.current,
      () => discardOwnedMediaObjectUrl(src),
    );
  };

  const totalVideoDurationMillis = useMemo(
    () => sumMediaDurationMillis(referenceVideos.map((v) => v.duration)),
    [referenceVideos],
  );
  const totalVideoDurationDisplay =
    referenceVideos.length === 0
      ? "0"
      : formatMediaDurationMillis(totalVideoDurationMillis ?? Number.NaN);

  // Tokens already in the slot the picker targets, greyed out in the gallery
  // so one media file can't be added twice to the same field. Reusing an image
  // across slots (e.g. start AND end frame) stays allowed.
  const disabledGalleryIds = useMemo(() => {
    if (galleryTarget === "video") {
      return referenceVideos
        .map((video) => video.mediaToken)
        .filter((t): t is string => !!t);
    }
    if (galleryTarget === "end") {
      return endFrameImage?.mediaToken ? [endFrameImage.mediaToken] : [];
    }
    return referenceImages
      .map((img) => img.mediaToken)
      .filter((t): t is string => !!t);
  }, [galleryTarget, referenceImages, referenceVideos, endFrameImage]);

  const processVideoFiles = async (files: File[], operationEpoch: number) => {
    if (
      operationEpoch !== videoEpochRef.current ||
      !videoReferencesSupported()
    ) {
      return;
    }

    const policy = livePolicyRef.current;
    const availableSlots = Math.max(
      0,
      policy.maxVideoCount - referenceVideosRef.current.length,
    );
    if (availableSlots <= 0) {
      toast.error(
        `Max ${policy.maxVideoCount} videos / ${policy.maxVideoRefDuration}s total`,
        { id: "video-ref-limit" },
      );
      return;
    }

    const filesToProcess = files.slice(0, availableSlots);
    for (const file of filesToProcess) {
      if (
        operationEpoch !== videoEpochRef.current ||
        !videoReferencesSupported()
      ) {
        return;
      }
      const duration = await getVideoDuration(file);
      if (
        operationEpoch !== videoEpochRef.current ||
        !videoReferencesSupported()
      ) {
        return;
      }
      if (duration == null) {
        toast.error("Could not read video duration", {
          id: "video-ref-duration",
        });
        continue;
      }

      const uploadId = Math.random().toString(36).substring(7);
      const previewUrl = createOwnedMediaObjectUrl(file);
      setUploadingVideo({ id: uploadId, file, previewUrl });
      let settled = false;

      const finish = (keepPreview: boolean) => {
        if (settled) return;
        settled = true;
        pendingVideoOperationsRef.current.delete(cancel);
        if (!keepPreview) discardOwnedMediaObjectUrl(previewUrl);
        if (mountedRef.current) setUploadingVideo(null);
      };
      const cancel = () => finish(false);
      pendingVideoOperationsRef.current.add(cancel);

      const commit = (mediaToken: string) => {
        if (settled) return;
        if (
          operationEpoch !== videoEpochRef.current ||
          !videoReferencesSupported()
        ) {
          cancel();
          return;
        }
        const currentPolicy = livePolicyRef.current;
        const candidate: RefVideo = {
          id: Math.random().toString(36).substring(7),
          url: previewUrl,
          file,
          mediaToken,
          duration,
        };
        const result = appendMediaReference(
          referenceVideosRef.current,
          candidate,
          {
            maxCount: currentPolicy.maxVideoCount,
            maxTotalSeconds: currentPolicy.maxVideoRefDuration,
          },
        );
        if (result.status === "added" && publishVideos(result.next)) {
          finish(true);
        } else if (result.status !== "duplicate") {
          finish(false);
          toast.error(
            result.status === "invalid-duration"
              ? "Could not verify video duration"
              : `Total video duration cannot exceed ${currentPolicy.maxVideoRefDuration}s`,
            { id: "video-ref-limit" },
          );
        } else {
          finish(false);
        }
      };

      const reject = (showError: boolean) => {
        if (settled) return;
        cancel();
        if (showError && videoReferencesSupported()) {
          toast.error("Failed to upload video. Please upload an MP4 file.");
        }
      };

      if (uploadVideo) {
        try {
          await uploadVideo({
            title: `reference-video-${Math.random()
              .toString(36)
              .substring(2, 15)}`,
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
          reject(false);
        }
      } else {
        commit("");
      }
    }
  };

  const handleVideoFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;
    const operationEpoch = videoEpochRef.current;
    const operation = videoOperationsRef.current.then(() =>
      processVideoFiles(files, operationEpoch),
    );
    videoOperationsRef.current = operation.then(
      () => undefined,
      () => undefined,
    );
    await operation;
    if (videoFileInputRef.current) videoFileInputRef.current.value = "";
  };

  const handleRemoveVideo = (id: string) => {
    publishVideos(
      referenceVideosRef.current.filter((video) => video.id !== id),
    );
    if (videoFileInputRef.current) videoFileInputRef.current.value = "";
  };

  const handleUploadClickAudio = () => {
    audioFileInputRef.current?.click();
  };

  const getAudioDuration = (file: File): Promise<number | null> => {
    const src = createOwnedMediaObjectUrl(file);
    return probeMediaDuration(
      "audio",
      src,
      pendingAudioOperationsRef.current,
      () => discardOwnedMediaObjectUrl(src),
    );
  };

  const totalAudioDurationMillis = useMemo(
    () => sumMediaDurationMillis(referenceAudios.map((a) => a.duration)),
    [referenceAudios],
  );
  const totalAudioDurationDisplay =
    referenceAudios.length === 0
      ? "0"
      : formatMediaDurationMillis(totalAudioDurationMillis ?? Number.NaN);

  const processAudioFiles = async (files: File[], operationEpoch: number) => {
    if (
      operationEpoch !== audioEpochRef.current ||
      !audioReferencesSupported()
    ) {
      return;
    }

    const audioFiles = files.filter(isAudioFile);
    if (audioFiles.length < files.length) {
      toast.error(AUDIO_FILE_TYPE_ERROR);
    }

    const policy = livePolicyRef.current;
    const availableSlots = Math.max(
      0,
      policy.maxAudioCount - referenceAudiosRef.current.length,
    );
    if (audioFiles.length === 0 || availableSlots <= 0) {
      return;
    }

    const filesToProcess = audioFiles.slice(0, availableSlots);
    for (const file of filesToProcess) {
      if (
        operationEpoch !== audioEpochRef.current ||
        !audioReferencesSupported()
      ) {
        return;
      }
      const duration = await getAudioDuration(file);
      if (
        operationEpoch !== audioEpochRef.current ||
        !audioReferencesSupported()
      ) {
        return;
      }
      if (duration == null) {
        toast.error("Could not read audio duration", {
          id: "audio-ref-duration",
        });
        continue;
      }
      const uploadId = Math.random().toString(36).substring(7);
      const previewUrl = createOwnedMediaObjectUrl(file);
      setUploadingAudio({ id: uploadId, file, previewUrl });
      let settled = false;

      const finish = (keepPreview: boolean) => {
        if (settled) return;
        settled = true;
        pendingAudioOperationsRef.current.delete(cancel);
        if (!keepPreview) discardOwnedMediaObjectUrl(previewUrl);
        if (mountedRef.current) setUploadingAudio(null);
      };
      const cancel = () => finish(false);
      pendingAudioOperationsRef.current.add(cancel);

      const commit = (mediaToken: string) => {
        if (settled) return;
        if (
          operationEpoch !== audioEpochRef.current ||
          !audioReferencesSupported()
        ) {
          cancel();
          return;
        }
        const currentPolicy = livePolicyRef.current;
        const candidate: RefAudio = {
          id: Math.random().toString(36).substring(7),
          url: previewUrl,
          file,
          mediaToken,
          duration,
        };
        const result = appendMediaReference(
          referenceAudiosRef.current,
          candidate,
          {
            maxCount: currentPolicy.maxAudioCount,
            maxTotalSeconds: currentPolicy.maxAudioRefDuration,
          },
        );
        if (result.status === "added" && publishAudios(result.next)) {
          finish(true);
        } else if (result.status !== "duplicate") {
          finish(false);
          toast.error(
            result.status === "invalid-duration"
              ? "Could not verify audio duration"
              : `Total audio duration cannot exceed ${currentPolicy.maxAudioRefDuration}s`,
          );
        } else {
          finish(false);
        }
      };

      const reject = () => {
        if (settled) return;
        cancel();
      };

      if (uploadAudio) {
        try {
          await uploadAudio({
            title: `reference-audio-${Math.random()
              .toString(36)
              .substring(2, 15)}`,
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
          if (audioReferencesSupported()) {
            toast.error("Failed to upload audio. Please try again.");
          }
        } finally {
          reject();
        }
      } else {
        commit("");
      }
    }
  };

  const handleAudioFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;
    const operationEpoch = audioEpochRef.current;
    const operation = audioOperationsRef.current.then(() =>
      processAudioFiles(files, operationEpoch),
    );
    audioOperationsRef.current = operation.then(
      () => undefined,
      () => undefined,
    );
    await operation;
    if (audioFileInputRef.current) audioFileInputRef.current.value = "";
  };

  const handleRemoveAudio = (id: string) => {
    publishAudios(
      referenceAudiosRef.current.filter((audio) => audio.id !== id),
    );
    if (audioFileInputRef.current) audioFileInputRef.current.value = "";
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    const target = uploadTarget;
    if (target === "end" ? !endUploadSupported() : !imageUploadSupported()) {
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const policy = livePolicyRef.current;
    const currentCount =
      referenceImagesRef.current.length +
      pendingImageOperationsRef.current.size;
    const availableSlots = Math.max(
      0,
      policy.maxImagePromptCount - currentCount,
    );
    if (availableSlots <= 0 && target !== "end") {
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const filesToProcess =
      target === "end" ? files.slice(0, 1) : files.slice(0, availableSlots);

    filesToProcess.forEach((file) => {
      const operationEpoch =
        target === "end" ? endEpochRef.current : imageEpochRef.current;
      const uploadId = Math.random().toString(36).substring(7);
      const previewUrl = createOwnedMediaObjectUrl(file);
      if (target === "end") {
        setUploadingEnd({ id: uploadId, file, previewUrl });
      } else {
        setUploadingImages((prev) => [
          ...prev,
          { id: uploadId, file, previewUrl },
        ]);
      }

      let settled = false;
      const pending =
        target === "end"
          ? pendingEndOperationsRef.current
          : pendingImageOperationsRef.current;
      const reader = new FileReader();
      const finish = () => {
        if (settled) return;
        settled = true;
        pending.delete(cancel);
        discardOwnedMediaObjectUrl(previewUrl);
        if (mountedRef.current) {
          if (target === "end") {
            setUploadingEnd(null);
          } else {
            setUploadingImages((prev) =>
              prev.filter((image) => image.id !== uploadId),
            );
          }
        }
      };
      const cancel = () => {
        reader.onloadend = null;
        reader.onerror = null;
        if (reader.readyState === FileReader.LOADING) reader.abort();
        finish();
      };
      const reject = cancel;
      pending.add(cancel);
      const commit = (url: string, mediaToken: string) => {
        if (settled) return;
        const stillCurrent =
          target === "end"
            ? operationEpoch === endEpochRef.current && endUploadSupported()
            : operationEpoch === imageEpochRef.current &&
              imageUploadSupported();
        if (!stillCurrent) {
          cancel();
          return;
        }
        const referenceImage: RefImage = {
          id: Math.random().toString(36).substring(7),
          url,
          file,
          mediaToken,
        };
        finish();
        if (target === "end") {
          livePolicyRef.current.setEndFrameImage?.(referenceImage);
          return;
        }
        const current = referenceImagesRef.current;
        if (current.length < livePolicyRef.current.maxImagePromptCount) {
          publishImages([...current, referenceImage]);
        }
      };

      reader.onloadend = async () => {
        if (typeof reader.result !== "string") {
          reject();
          return;
        }
        if (uploadImage) {
          try {
            await uploadImage({
              title: `reference-image-${Math.random()
                .toString(36)
                .substring(2, 15)}`,
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
            if (
              target === "end" ? endUploadSupported() : imageUploadSupported()
            ) {
              toast.error("Failed to upload image. Please try again.");
            }
          } finally {
            reject();
          }
        } else {
          commit(reader.result, "");
        }

        if (fileInputRef.current) fileInputRef.current.value = "";
      };
      reader.onerror = () => reject();
      reader.readAsDataURL(file);
    });
  };

  const handleGalleryClose = () => {
    if (galleryTarget === "video") {
      videoGalleryEpochRef.current += 1;
      cancelPending(pendingVideoGalleryProbesRef.current);
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
          ? Math.max(1, maxVideoCount - referenceVideos.length)
          : galleryTarget === "end"
            ? 1
            : Math.max(1, maxImagePromptCount);
      if (prev.length >= maxSelections) {
        return maxSelections === 1 ? [id] : prev;
      }
      return [...prev, id];
    });
  };

  const handleGalleryImages = async (selectedItems: GalleryItem[]) => {
    const target = galleryTarget;
    if (target === "video") {
      const operationEpoch = videoEpochRef.current;
      const galleryEpoch = videoGalleryEpochRef.current;
      if (!videoReferencesSupported()) return;
      const policy = livePolicyRef.current;
      const availableSlots = Math.max(
        0,
        policy.maxVideoCount - referenceVideosRef.current.length,
      );
      if (availableSlots <= 0) {
        toast.error(
          `Max ${policy.maxVideoCount} videos / ${policy.maxVideoRefDuration}s total`,
          { id: "video-ref-limit" },
        );
        setIsGalleryModalOpen(false);
        setSelectedGalleryImages([]);
        return;
      }
      const itemsToProcess = selectedItems
        .slice(0, availableSlots)
        .filter((item): item is GalleryItem & { fullImage: string } =>
          Boolean(item.fullImage),
        );

      setIsProcessingGallery(true);
      try {
        // Probe the actual selected URL so duration/cap state cannot inherit
        // stale list metadata.
        const durations = await Promise.all(
          itemsToProcess.map((item) => getVideoDurationFromSrc(item.fullImage)),
        );

        if (
          operationEpoch !== videoEpochRef.current ||
          galleryEpoch !== videoGalleryEpochRef.current ||
          !videoReferencesSupported()
        ) {
          return;
        }

        let nextVideos = referenceVideosRef.current;
        let exceeded = false;
        for (let i = 0; i < itemsToProcess.length; i++) {
          const item = itemsToProcess[i]!;
          const duration = durations[i]!;
          if (duration == null) {
            toast.error("Could not read video duration", {
              id: "video-ref-duration",
            });
            continue;
          }
          const candidate: RefVideo = {
            id: Math.random().toString(36).substring(7),
            url: item.fullImage,
            mediaToken: item.id,
            duration,
          };
          const result = appendMediaReference(nextVideos, candidate, {
            maxCount: livePolicyRef.current.maxVideoCount,
            maxTotalSeconds: livePolicyRef.current.maxVideoRefDuration,
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
          toast.error(
            `Total video duration cannot exceed ${livePolicyRef.current.maxVideoRefDuration}s`,
            { id: "video-ref-limit" },
          );
        }
        if (nextVideos !== referenceVideosRef.current) {
          publishVideos(nextVideos);
        }
      } finally {
        if (mountedRef.current) setIsProcessingGallery(false);
      }
      if (
        operationEpoch !== videoEpochRef.current ||
        galleryEpoch !== videoGalleryEpochRef.current ||
        !videoReferencesSupported()
      ) {
        return;
      }
      setIsGalleryModalOpen(false);
      setSelectedGalleryImages([]);
      return;
    }
    if (target === "end") {
      if (!endGallerySupported()) return;
      const item = selectedItems[0];
      if (item && item.fullImage) {
        livePolicyRef.current.setEndFrameImage?.({
          id: Math.random().toString(36).substring(7),
          url: item.fullImage,
          mediaToken: item.id,
        });
      }
      setIsGalleryModalOpen(false);
      setSelectedGalleryImages([]);
      return;
    }
    if (!imageGallerySupported()) return;
    const availableSlots = Math.max(
      0,
      livePolicyRef.current.maxImagePromptCount -
        referenceImagesRef.current.length,
    );
    if (availableSlots <= 0) {
      setIsGalleryModalOpen(false);
      setSelectedGalleryImages([]);
      return;
    }

    const newRefs = [...referenceImagesRef.current];
    selectedItems.slice(0, availableSlots).forEach((item) => {
      if (!imageGallerySupported()) return;
      if (!item.fullImage) return;
      newRefs.push({
        id: Math.random().toString(36).substring(7),
        url: item.fullImage,
        mediaToken: item.id,
      });
    });
    publishImages(newRefs);
    setIsGalleryModalOpen(false);
    setSelectedGalleryImages([]);
  };

  if (!visible) {
    return null;
  }

  return (
    <>
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept="image/*"
        onChange={handleFileUpload}
        multiple={maxImagePromptCount > 1}
      />
      {showVideoReferenceSection && (
        <>
          <input
            type="file"
            ref={videoFileInputRef}
            className="hidden"
            accept="video/mp4,.mp4"
            onChange={handleVideoFileUpload}
            multiple={maxVideoCount > 1}
          />
          <input
            type="file"
            ref={audioFileInputRef}
            className="hidden"
            accept={AUDIO_FILE_ACCEPT}
            onChange={handleAudioFileUpload}
            multiple={maxAudioCount > 1}
          />
        </>
      )}
      <div
        className={twMerge(
          "absolute left-0 glass w-full rounded-t-2xl flex",
          showVideoReferenceSection ? "-top-[144px]" : "-top-[72px]",
          className,
        )}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onMouseUp={(e) => e.stopPropagation()}
      >
        <div className="grow flex flex-col">
          <div
            className={twMerge(
              "grid grid-cols-1",
              isVideo && showEndFrameSection && "grid-cols-2",
            )}
          >
            <div className="flex gap-2 py-2 px-3">
              <div className="flex flex-col grow gap-1">
                <div className="flex items-center gap-2 opacity-90 text-base-fg">
                  <ImageIcon  className="h-3.5 w-3.5" />
                  <span className="text-sm font-medium flex items-center gap-1.5">
                    {isVideo
                      ? isReferenceMode
                        ? "Image Ref"
                        : "Start Frame"
                      : "Image Prompts"}
                    {(!isVideo || isReferenceMode) && (
                      <span className="text-base-fg/60 font-semibold">
                        ({usedSlotsRender}/{maxImagePromptCount})
                      </span>
                    )}
                  </span>
                </div>
                <span className="text-[13px] text-base-fg/60">
                  {isVideo
                    ? isReferenceMode
                      ? "Upload images"
                      : "Animate an image"
                    : "Use the elements of an image"}
                </span>
              </div>

              <div className="flex gap-2">
                {allowReorder ? (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                  >
                    <SortableContext
                      items={referenceImages
                        .slice(0, Math.max(0, maxImagePromptCount))
                        .map((img) => img.id)}
                      strategy={horizontalListSortingStrategy}
                    >
                      {referenceImages
                        .slice(0, Math.max(0, maxImagePromptCount))
                        .map((image, index) => (
                          <SortableImage
                            key={image.id}
                            image={image}
                            index={index}
                          />
                        ))}
                    </SortableContext>
                  </DndContext>
                ) : (
                  referenceImages
                    .slice(0, Math.max(0, maxImagePromptCount))
                    .map((image, index) => (
                      <div
                        key={image.id}
                        className="glass relative aspect-square overflow-hidden rounded-lg w-14 border-2 border-white/30 hover:border-white/80 transition-all group cursor-pointer hover:cursor-zoom-in"
                        onClick={() => onImageClick?.(image)}
                      >
                        <img
                          src={image.url}
                          alt="Reference"
                          className="h-full w-full object-cover"
                        />
                        {isReferenceMode && (
                          <div className="absolute bottom-0 left-0 right-0 flex items-center justify-center bg-black/60 py-0.5 text-[11px] font-bold text-white">
                            {index + 1}
                          </div>
                        )}
                        <button
                          aria-label={`Remove reference image ${index + 1}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveReference(image.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 absolute right-[2px] top-[2px] flex h-5 w-5 items-center justify-center rounded-full bg-black/50 hover:bg-red/70 text-white backdrop-blur-md transition-colors hover:bg-black cursor-pointer"
                        >
                          <XIcon
                            
                            className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    ))
                )}
                {uploadingImages
                  .slice(
                    0,
                    Math.max(0, maxImagePromptCount - referenceImages.length),
                  )
                  .map(({ id, previewUrl }) => {
                    return (
                      <div
                        key={id}
                        className="glass relative aspect-square overflow-hidden rounded-lg w-14 border-2 border-white/30"
                      >
                        <div className="absolute inset-0">
                          <img
                            src={previewUrl}
                            alt="Uploading preview"
                            className="h-full w-full object-cover blur-sm"
                          />
                        </div>
                        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                          <LoaderCircleIcon
                            
                            className="h-6 w-6 animate-spin text-white" />
                        </div>
                      </div>
                    );
                  })}
                {referenceImages.length + uploadingImages.length <
                  maxImagePromptCount && (
                  <Tooltip
                    interactive={true}
                    position="top"
                    delay={100}
                    className="bg-ui-controls text-base-fg border border-ui-controls-border p-2 -mb-0.5"
                    closeOnClick={true}
                    content={
                      <div className="flex flex-col gap-1.5">
                        {allowUpload && (
                          <Button
                            variant="primary"
                            onClick={handleUploadClickStart}
                            icon={PlusIcon}
                            className="w-full"
                          >
                            Upload
                          </Button>
                        )}
                        <Button
                          variant="action"
                          onClick={() => {
                            setGalleryTarget("start");
                            setIsGalleryModalOpen(true);
                          }}
                          icon={ImagesIcon}
                          className="w-full bg-base-fg/10 hover:bg-base-fg/20"
                        >
                          Pick from library
                        </Button>
                      </div>
                    }
                  >
                    <Button
                      variant="action"
                      className="bg-ui-controls/40 hover:bg-ui-controls/60 aspect-square w-full overflow-hidden rounded-lg w-14 border-dashed border-2 border-black/5 dark:border-white/25 transition-all"
                      onClick={() => {
                        if (allowUpload) handleUploadClickStart();
                        else {
                          setGalleryTarget("start");
                          setIsGalleryModalOpen(true);
                        }
                      }}
                    >
                      <PlusIcon
                        
                        className="text-2xl opacity-80 text-base-fg" />
                    </Button>
                  </Tooltip>
                )}
              </div>
            </div>
            {isVideo && showEndFrameSection && (
              <div className="flex gap-3 pe-3">
                <div className="flex grow gap-1">
                  <div className="w-[1px] h-full bg-white/10" />
                  <div className="flex flex-col grow gap-1 p-2">
                    <div className="flex items-center gap-2 opacity-90 text-base-fg">
                      <ImageIcon  className="h-3.5 w-3.5" />
                      <span className="text-sm font-medium flex items-center gap-1.5">
                        End Frame{" "}
                        <span className="text-base-fg/60 text-xs">
                          (optional)
                        </span>
                      </span>
                    </div>
                    <span className="text-[13px] text-base-fg/60">
                      How video ends
                    </span>
                  </div>
                </div>
                <div className="flex gap-2 items-center">
                  {endFrameImage ? (
                    <div
                      className="glass relative aspect-square overflow-hidden rounded-lg w-14 border-2 border-white/30 hover:border-white/80 transition-all group cursor-pointer hover:cursor-zoom-in"
                      onClick={() => onImageClick?.(endFrameImage)}
                    >
                      <img
                        src={endFrameImage.url}
                        alt="Ending Frame"
                        className="h-full w-full object-cover"
                      />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEndFrameImage?.(undefined);
                        }}
                        className="opacity-0 group-hover:opacity-100 absolute right-[2px] top-[2px] flex h-5 w-5 items-center justify-center rounded-full bg-black/50 hover:bg-red/70 text-white backdrop-blur-md transition-colors hover:bg-black cursor-pointer"
                      >
                        <XIcon
                          
                          className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  ) : uploadingEnd ? (
                    <div className="glass relative aspect-square overflow-hidden rounded-lg w-14 border-2 border-white/30">
                      <div className="absolute inset-0">
                        <img
                          src={uploadingEnd.previewUrl}
                          alt="Uploading preview"
                          className="h-full w-full object-cover blur-sm"
                        />
                      </div>
                      <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                        <LoaderCircleIcon
                          
                          className="h-6 w-6 animate-spin text-white" />
                      </div>
                    </div>
                  ) : (
                    <Tooltip
                      interactive={true}
                      position="top"
                      delay={100}
                      className="bg-ui-controls text-base-fg border border-ui-controls-border p-2 -mb-0.5"
                      closeOnClick={true}
                      content={
                        <div className="flex flex-col gap-1.5">
                          {allowUploadEnd && (
                            <Button
                              variant="primary"
                              onClick={handleUploadClickEnd}
                              icon={PlusIcon}
                              className="w-full"
                            >
                              Upload
                            </Button>
                          )}
                          <Button
                            variant="action"
                            onClick={() => {
                              setGalleryTarget("end");
                              setIsGalleryModalOpen(true);
                            }}
                            icon={ImagesIcon}
                            className="w-full bg-base-fg/10 hover:bg-base-fg/20"
                          >
                            Pick from library
                          </Button>
                        </div>
                      }
                    >
                      <Button
                        variant="action"
                        className="bg-ui-controls/40 hover:bg-ui-controls/60 aspect-square w-full overflow-hidden rounded-lg w-14 border-dashed border-2 border-black/5 dark:border-white/25 transition-all"
                        onClick={() => {
                          if (allowUploadEnd) handleUploadClickEnd();
                          else {
                            setGalleryTarget("end");
                            setIsGalleryModalOpen(true);
                          }
                        }}
                      >
                        <PlusIcon
                          
                          className="text-2xl opacity-80 text-base-fg" />
                      </Button>
                    </Tooltip>
                  )}
                </div>
              </div>
            )}
          </div>
          {isVideo && showVideoReferenceSection && (
            <div className="grid grid-cols-2 border-t border-white/10">
              {/* Video References - Left */}
              <div className="flex gap-2 py-2 px-3">
                <div className="flex flex-col grow gap-1">
                  <div className="flex items-center gap-2 opacity-90 text-base-fg">
                    <VideoIcon  className="h-3.5 w-3.5" />
                    <span className="text-sm font-medium flex items-center gap-1.5">
                      Video Ref{" "}
                      <span className="text-base-fg/60 font-semibold">
                        ({referenceVideos.length}/{maxVideoCount})
                      </span>
                    </span>
                  </div>
                  <span className="text-[13px] text-base-fg/60">
                    {totalVideoDurationDisplay}s / {maxVideoRefDuration}s max
                  </span>
                </div>
                <div className="flex gap-2 items-center">
                  {referenceVideos.map((video) => (
                    <div
                      key={video.id}
                      className="glass relative aspect-square overflow-hidden rounded-lg w-14 border-2 border-white/30 hover:border-white/80 transition-all group cursor-pointer"
                    >
                      <video
                        src={video.url}
                        muted
                        preload="metadata"
                        className="h-full w-full object-cover"
                      />
                      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-center bg-black/70 py-0.5 text-[10px] font-bold text-white">
                        {formatMediaDurationSeconds(video.duration)}s
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveVideo(video.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 absolute right-[2px] top-[2px] flex h-5 w-5 items-center justify-center rounded-full bg-black/50 hover:bg-red/70 text-white backdrop-blur-md transition-colors hover:bg-black cursor-pointer"
                      >
                        <XIcon
                          
                          className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  ))}
                  {uploadingVideo && (
                    <div className="glass relative aspect-square overflow-hidden rounded-lg w-14 border-2 border-white/30">
                      <div className="absolute inset-0">
                        <video
                          src={uploadingVideo.previewUrl}
                          muted
                          preload="metadata"
                          className="h-full w-full object-cover blur-sm"
                        />
                      </div>
                      <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                        <LoaderCircleIcon
                          
                          className="h-6 w-6 animate-spin text-white" />
                      </div>
                    </div>
                  )}
                  {referenceVideos.length < maxVideoCount &&
                    !uploadingVideo && (
                      <Tooltip
                        interactive={true}
                        position="top"
                        delay={100}
                        className="bg-ui-controls text-base-fg border border-ui-controls-border p-2 -mb-0.5"
                        closeOnClick={true}
                        content={
                          <div className="flex flex-col gap-1.5">
                            <Button
                              variant="primary"
                              onClick={handleUploadClickVideo}
                              icon={PlusIcon}
                              className="w-full"
                            >
                              Upload
                            </Button>
                            <Button
                              variant="action"
                              onClick={() => {
                                setGalleryTarget("video");
                                setIsGalleryModalOpen(true);
                              }}
                              icon={ImagesIcon}
                              className="w-full bg-base-fg/10 hover:bg-base-fg/20"
                            >
                              Pick from library
                            </Button>
                          </div>
                        }
                      >
                        <Button
                          variant="action"
                          className="bg-ui-controls/40 hover:bg-ui-controls/60 aspect-square w-full overflow-hidden rounded-lg w-14 border-dashed border-2 border-black/5 dark:border-white/25 transition-all"
                          onClick={handleUploadClickVideo}
                        >
                          <PlusIcon
                            
                            className="text-2xl opacity-80 text-base-fg" />
                        </Button>
                      </Tooltip>
                    )}
                </div>
              </div>
              {/* Audio References - Right */}
              <div className="flex gap-2 pe-3">
                <div className="flex grow gap-1">
                  <div className="w-[1px] h-full bg-white/10" />
                  <div className="flex flex-col grow gap-1 p-2">
                    <div className="flex items-center gap-2 opacity-90 text-base-fg">
                      <MusicIcon  className="h-3.5 w-3.5" />
                      <span className="text-sm font-medium flex items-center gap-1.5">
                        Audio Ref{" "}
                        <span className="text-base-fg/60 font-semibold">
                          ({referenceAudios.length}/{maxAudioCount})
                        </span>
                      </span>
                    </div>
                    <span className="text-[13px] text-base-fg/60">
                      {totalAudioDurationDisplay}s / {maxAudioRefDuration}s max
                    </span>
                  </div>
                </div>
                <div className="flex gap-2 items-center">
                  {referenceAudios.map((audio, index) => (
                    <AudioRefTile
                      key={audio.id}
                      audio={audio}
                      index={index}
                      onRemove={handleRemoveAudio}
                    />
                  ))}
                  {uploadingAudio && (
                    <div className="glass relative aspect-square overflow-hidden rounded-lg w-14 border-2 border-white/30 flex items-center justify-center">
                      <LoaderCircleIcon
                        
                        className="h-6 w-6 animate-spin text-white" />
                    </div>
                  )}
                  {referenceAudios.length < maxAudioCount &&
                    !uploadingAudio && (
                      <Button
                        variant="action"
                        className="bg-ui-controls/40 hover:bg-ui-controls/60 aspect-square w-full overflow-hidden rounded-lg w-14 border-dashed border-2 border-black/5 dark:border-white/25 transition-all"
                        onClick={handleUploadClickAudio}
                      >
                        <PlusIcon
                          
                          className="text-2xl opacity-80 text-base-fg" />
                      </Button>
                    )}
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center">
          <div className="w-[1px] h-full bg-white/10" />
          <div className="flex items-center gap-2 w-[1px] h-full bg-base-fg/20 dark:bg-base-fg/10 rounded-lg" />
          <div className="p-2">
            <Button
              variant="action"
              icon={Trash2Icon}
              aria-label="Clear all references"
              className="h-8 w-3"
              onClick={() => {
                cancelImageOperations();
                cancelEndOperations();
                cancelVideoOperations();
                cancelAudioOperations();
                setIsGalleryModalOpen(false);
                setSelectedGalleryImages([]);
                publishImages([]);
                livePolicyRef.current.setEndFrameImage?.(undefined);
                publishVideos([]);
                publishAudios([]);
              }}
            />
          </div>
        </div>
      </div>
      <GalleryModal
        key={galleryTarget === "video" ? "video" : "image"}
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
              ? Math.max(1, maxVideoCount - referenceVideos.length)
              : Math.max(1, availableSlotsRender)
        }
        onUseSelected={handleGalleryImages}
        onDownloadClicked={downloadFileFromUrl}
        useSelectedLoading={isProcessingGallery}
        forceFilter={galleryTarget === "video" ? "video" : "image"}
      />
    </>
  );
};
