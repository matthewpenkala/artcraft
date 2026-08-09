import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { FolderOpenIcon, ImageIcon, MusicIcon, PlayIcon, PlusIcon, SquareIcon, XIcon } from "lucide-react";
import { DynamicIcon } from "@storyteller/icons";
import { toast } from "@storyteller/ui-toaster";
import {
  UploaderStates,
  appendMediaReference,
  createOwnedMediaObjectUrl,
  discardOwnedMediaObjectUrl,
  formatMediaDurationSeconds,
  probeMediaDurationFromFile,
} from "@storyteller/common";
import type { UploadMediaFn } from "@storyteller/api";
import type { RefAudio, RefImage } from "../promptStore";
import {
  AUDIO_FILE_ACCEPT,
  AUDIO_FILE_TYPE_ERROR,
  isAudioFile,
} from "./audioFiles";

/** Lets the prompt box push dropped/pasted files through the same upload
 *  path the row's own file inputs use. */
export interface AudioReferenceRowHandle {
  addAudioFiles: (files: File[]) => Promise<void>;
  addImageFile: (file: File) => Promise<void>;
}

export interface AudioReferenceRowProps {
  referenceAudios: RefAudio[];
  onReferenceAudiosChange: (audios: RefAudio[]) => void;
  maxAudioCount: number;
  maxAudioRefDuration: number;
  uploadAudio?: UploadMediaFn;
  // Opens the caller's audio library picker (adds a "From library" button).
  onPickAudioFromLibrary?: () => void;
  // Whether the audio reference is required (remix/sample source).
  audioRequired?: boolean;
  // Optional single-image reference section (Seed Audio).
  imageSupported?: boolean;
  referenceImages?: RefImage[];
  onReferenceImagesChange?: (images: RefImage[]) => void;
  uploadImage?: UploadMediaFn;
  className?: string;
}

// Reference row for the audio promptbox: upload an audio track (the
// remix/sample source or Seed Audio refs), plus an optional image reference
// for models that support one. Rendered inside the glass card, above the
// prompt textarea.
export const AudioReferenceRow = forwardRef<
  AudioReferenceRowHandle,
  AudioReferenceRowProps
>(function AudioReferenceRow(
  {
    referenceAudios,
    onReferenceAudiosChange,
    maxAudioCount,
    maxAudioRefDuration,
    uploadAudio,
    onPickAudioFromLibrary,
    audioRequired = false,
    imageSupported = false,
    referenceImages = [],
    onReferenceImagesChange,
    uploadImage,
    className = "",
  },
  ref,
) {
  const audioInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [isUploadingAudio, setIsUploadingAudio] = useState(false);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const referenceAudiosRef = useRef(referenceAudios);
  const referenceImagesRef = useRef(referenceImages);
  const audioEpochRef = useRef(0);
  const imageEpochRef = useRef(0);
  const mountedRef = useRef(true);
  const lastPublishedAudiosRef = useRef<RefAudio[] | null>(null);
  const lastPublishedImagesRef = useRef<RefImage[] | null>(null);
  const previousAudiosPropRef = useRef(referenceAudios);
  const previousImagesPropRef = useRef(referenceImages);
  const livePolicyRef = useRef({
    maxAudioCount,
    maxAudioRefDuration,
    uploadAudio,
    imageSupported,
    uploadImage,
    onReferenceAudiosChange,
    onReferenceImagesChange,
  });
  livePolicyRef.current = {
    maxAudioCount,
    maxAudioRefDuration,
    uploadAudio,
    imageSupported,
    uploadImage,
    onReferenceAudiosChange,
    onReferenceImagesChange,
  };
  const audioPolicySignature = [
    maxAudioCount,
    maxAudioRefDuration,
    Boolean(uploadAudio),
  ].join("|");
  const imagePolicySignature = [
    imageSupported,
    Boolean(uploadImage),
    Boolean(onReferenceImagesChange),
  ].join("|");
  const renderedPolicyRef = useRef({
    audio: audioPolicySignature,
    image: imagePolicySignature,
  });
  if (renderedPolicyRef.current.audio !== audioPolicySignature) {
    audioEpochRef.current++;
  }
  if (renderedPolicyRef.current.image !== imagePolicySignature) {
    imageEpochRef.current++;
  }
  renderedPolicyRef.current = {
    audio: audioPolicySignature,
    image: imagePolicySignature,
  };

  const audiosExternallyChanged =
    previousAudiosPropRef.current !== referenceAudios &&
    lastPublishedAudiosRef.current !== referenceAudios;
  const imagesExternallyChanged =
    previousImagesPropRef.current !== referenceImages &&
    lastPublishedImagesRef.current !== referenceImages;
  if (previousAudiosPropRef.current !== referenceAudios) {
    if (audiosExternallyChanged) audioEpochRef.current++;
    previousAudiosPropRef.current = referenceAudios;
    lastPublishedAudiosRef.current = null;
  }
  if (previousImagesPropRef.current !== referenceImages) {
    if (imagesExternallyChanged) imageEpochRef.current++;
    previousImagesPropRef.current = referenceImages;
    lastPublishedImagesRef.current = null;
  }
  referenceAudiosRef.current = referenceAudios;
  referenceImagesRef.current = referenceImages;
  const audioOperationsRef = useRef<Promise<void>>(Promise.resolve());

  const publishAudios = (next: RefAudio[]) => {
    referenceAudiosRef.current = next;
    lastPublishedAudiosRef.current = next;
    livePolicyRef.current.onReferenceAudiosChange(next);
  };
  const publishImages = (next: RefImage[]) => {
    referenceImagesRef.current = next;
    lastPublishedImagesRef.current = next;
    livePolicyRef.current.onReferenceImagesChange?.(next);
  };

  useEffect(() => {
    audioOperationsRef.current = Promise.resolve();
    setIsUploadingAudio(false);
  }, [audioPolicySignature]);

  useEffect(() => {
    setIsUploadingImage(false);
  }, [imagePolicySignature]);

  useEffect(() => {
    if (!audiosExternallyChanged) return;
    audioOperationsRef.current = Promise.resolve();
    setIsUploadingAudio(false);
  }, [referenceAudios]);

  useEffect(() => {
    if (imagesExternallyChanged) setIsUploadingImage(false);
  }, [referenceImages]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      audioEpochRef.current++;
      imageEpochRef.current++;
      audioOperationsRef.current = Promise.resolve();
    };
  }, []);

  const processAudioFilesNow = async (
    files: File[],
    operationEpoch: number,
  ) => {
    if (
      files.length === 0 ||
      operationEpoch !== audioEpochRef.current ||
      !mountedRef.current
    ) {
      return;
    }

    const audioFiles = files.filter(isAudioFile);
    if (audioFiles.length < files.length) {
      toast.error(AUDIO_FILE_TYPE_ERROR);
    }

    const baseAudios = referenceAudiosRef.current;
    const availableSlots = Math.max(
      0,
      livePolicyRef.current.maxAudioCount - baseAudios.length,
    );
    const filesToProcess = audioFiles.slice(0, availableSlots);

    for (const file of filesToProcess) {
      const duration = await getAudioFileDuration(file);
      if (operationEpoch !== audioEpochRef.current || !mountedRef.current) {
        return;
      }
      if (duration == null) {
        toast.error("Could not read audio duration");
        continue;
      }
      const currentUploadAudio = livePolicyRef.current.uploadAudio;
      if (currentUploadAudio) {
        setIsUploadingAudio(true);
        let settled = false;
        const commit = (mediaToken: string) => {
          if (settled) return;
          if (
            operationEpoch !== audioEpochRef.current ||
            !mountedRef.current ||
            !livePolicyRef.current.uploadAudio
          ) {
            settled = true;
            return;
          }
          const previewUrl = createOwnedMediaObjectUrl(file);
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
              maxCount: livePolicyRef.current.maxAudioCount,
              maxTotalSeconds: livePolicyRef.current.maxAudioRefDuration,
            },
          );
          settled = true;
          if (result.status === "added") {
            publishAudios(result.next);
          } else {
            // The URL was never committed, so no store owner retained it.
            // The registry ignores borrowed URLs and releases this one once.
            discardOwnedMediaObjectUrl(previewUrl);
            if (result.status !== "duplicate") {
              toast.error(
                result.status === "invalid-duration"
                  ? "Could not verify audio duration"
                  : `Total audio duration cannot exceed ${livePolicyRef.current.maxAudioRefDuration}s`,
              );
            }
          }
        };
        const reject = (showError: boolean) => {
          if (settled) return;
          settled = true;
          if (showError) toast.error("Audio upload failed. Please try again.");
        };
        try {
          await currentUploadAudio({
            title: `reference-audio-${Math.random().toString(36).substring(2, 15)}`,
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
          if (mountedRef.current && operationEpoch === audioEpochRef.current) {
            setIsUploadingAudio(false);
          }
        }
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
    await processAudioFiles(Array.from(event.target.files || []));
    if (audioInputRef.current) audioInputRef.current.value = "";
  };

  const processImageFile = async (file: File) => {
    const operationEpoch = imageEpochRef.current;
    const currentUploadImage = livePolicyRef.current.uploadImage;
    if (
      !currentUploadImage ||
      !livePolicyRef.current.imageSupported ||
      !livePolicyRef.current.onReferenceImagesChange
    ) {
      return;
    }

    setIsUploadingImage(true);
    let settled = false;
    const reject = (showError: boolean) => {
      if (settled) return;
      settled = true;
      if (showError) toast.error("Image upload failed. Please try again.");
    };
    try {
      await currentUploadImage({
        title: `reference-image-${Math.random().toString(36).substring(2, 15)}`,
        assetFile: file,
        progressCallback: (newState) => {
          if (newState.status === UploaderStates.success && newState.data) {
            if (settled) return;
            if (
              operationEpoch !== imageEpochRef.current ||
              !mountedRef.current ||
              !livePolicyRef.current.imageSupported ||
              !livePolicyRef.current.onReferenceImagesChange
            ) {
              settled = true;
              return;
            }
            settled = true;
            const refImage: RefImage = {
              id: Math.random().toString(36).substring(7),
              url: createOwnedMediaObjectUrl(file),
              file,
              mediaToken: newState.data,
            };
            publishImages([refImage]);
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
      if (mountedRef.current && operationEpoch === imageEpochRef.current) {
        setIsUploadingImage(false);
      }
    }
  };

  const handleImageFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = (event.target.files || [])[0];
    if (file) await processImageFile(file);
    if (imageInputRef.current) imageInputRef.current.value = "";
  };

  useImperativeHandle(
    ref,
    () => ({
      addAudioFiles: processAudioFiles,
      addImageFile: processImageFile,
    }),
    // Recreated each render so the handle always closes over fresh props
    // (slot counts, current refs) rather than mount-time values.
  );

  const removeAudio = (id: string) => {
    publishAudios(
      referenceAudiosRef.current.filter((audio) => audio.id !== id),
    );
    if (audioInputRef.current) audioInputRef.current.value = "";
  };

  return (
    <div className={`flex flex-col gap-2 pb-2.5 ${className}`}>
      <input
        ref={audioInputRef}
        type="file"
        accept={AUDIO_FILE_ACCEPT}
        className="hidden"
        multiple={maxAudioCount > 1}
        onChange={handleAudioFileUpload}
      />
      {imageSupported && (
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleImageFileUpload}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 text-base-fg opacity-90">
          <MusicIcon  className="h-3.5 w-3.5" />
          <span className="text-sm font-medium">
            Audio Track{" "}
            <span className="font-semibold text-base-fg/60">
              (
              {maxAudioCount === Number.MAX_SAFE_INTEGER
                ? referenceAudios.length
                : `${referenceAudios.length}/${maxAudioCount}`}
              )
            </span>
            {audioRequired && referenceAudios.length === 0 && (
              <span className="ml-1.5 text-xs font-medium text-red-500">
                required
              </span>
            )}
          </span>
        </div>

        {referenceAudios.map((audio, index) => (
          <AudioRefTile
            key={audio.id}
            audio={audio}
            index={index}
            onRemove={removeAudio}
          />
        ))}

        {referenceAudios.length < maxAudioCount && (
          <>
            <button
              type="button"
              onClick={() => audioInputRef.current?.click()}
              disabled={isUploadingAudio}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-dashed border-ui-controls-border bg-ui-controls/50 px-3 text-sm text-base-fg/70 transition-colors hover:bg-ui-controls hover:text-base-fg disabled:cursor-wait disabled:opacity-60"
            >
              <PlusIcon  className="h-3 w-3" />
              {isUploadingAudio ? "Uploading…" : "Add audio"}
            </button>
            {onPickAudioFromLibrary && (
              <button
                type="button"
                onClick={onPickAudioFromLibrary}
                disabled={isUploadingAudio}
                className="flex h-9 items-center gap-1.5 rounded-lg border border-dashed border-ui-controls-border bg-ui-controls/50 px-3 text-sm text-base-fg/70 transition-colors hover:bg-ui-controls hover:text-base-fg disabled:cursor-wait disabled:opacity-60"
              >
                <FolderOpenIcon  className="h-3 w-3" />
                From library
              </button>
            )}
          </>
        )}

        {imageSupported && (
          <>
            <div className="ms-2 flex items-center gap-2 text-base-fg opacity-90">
              <ImageIcon  className="h-3.5 w-3.5" />
              <span className="text-sm font-medium">Image</span>
            </div>
            {referenceImages.map((image) => (
              <div
                key={image.id}
                className="group relative h-9 w-9 overflow-hidden rounded-lg border border-ui-controls-border"
              >
                <img
                  src={image.url}
                  alt="Reference"
                  className="h-full w-full object-cover"
                />
                <button
                  type="button"
                  aria-label="Remove image"
                  onClick={() => publishImages([])}
                  className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <XIcon
                    
                    className="h-3 w-3 text-white" />
                </button>
              </div>
            ))}
            {referenceImages.length === 0 && (
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                disabled={isUploadingImage}
                className="flex h-9 items-center gap-1.5 rounded-lg border border-dashed border-ui-controls-border bg-ui-controls/50 px-3 text-sm text-base-fg/70 transition-colors hover:bg-ui-controls hover:text-base-fg disabled:cursor-wait disabled:opacity-60"
              >
                <PlusIcon  className="h-3 w-3" />
                {isUploadingImage ? "Uploading…" : "Add image"}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
});

function AudioRefTile({
  audio,
  index,
  onRemove,
}: {
  audio: RefAudio;
  index: number;
  onRemove: (id: string) => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      audioRef.current?.pause();
      audioRef.current = null;
      setIsPlaying(false);
      return;
    }
    const element = new Audio(audio.url);
    element.onended = () => {
      audioRef.current = null;
      setIsPlaying(false);
    };
    audioRef.current = element;
    void element.play().catch(() => setIsPlaying(false));
    setIsPlaying(true);
  }, [audio.url, isPlaying]);

  return (
    <div className="group flex h-9 items-center gap-2 rounded-lg border border-ui-controls-border bg-ui-controls px-2.5">
      <button
        type="button"
        aria-label={isPlaying ? "Stop" : "Play"}
        onClick={togglePlay}
        className="flex h-5 w-5 items-center justify-center rounded-full bg-white/90 text-black transition-transform hover:scale-105"
      >
        <DynamicIcon
          icon={isPlaying ? SquareIcon : PlayIcon}
          className={`h-2 w-2 ${isPlaying ? "" : "ml-px"}`}
        />
      </button>
      <span className="text-xs font-medium text-base-fg/80">
        Audio {index + 1} · {formatMediaDurationSeconds(audio.duration)}s
      </span>
      <button
        type="button"
        aria-label="Remove audio"
        onClick={() => onRemove(audio.id)}
        className="flex h-4 w-4 items-center justify-center rounded text-base-fg/40 transition-colors hover:text-base-fg"
      >
        <XIcon  className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}

function getAudioFileDuration(file: File): Promise<number | null> {
  return probeMediaDurationFromFile("audio", file);
}
