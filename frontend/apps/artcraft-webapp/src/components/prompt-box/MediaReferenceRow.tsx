import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircleIcon, MusicIcon, PlayIcon, SquareIcon, VideoIcon, XIcon } from "lucide-react";
import { DynamicIcon } from "@storyteller/icons";
import { twMerge } from "tailwind-merge";
import {
  durationSecondsToMillis,
  appendMediaReference,
  createOwnedMediaObjectUrl,
  discardOwnedMediaObjectUrl,
  formatMediaDurationMillis,
  formatMediaDurationSeconds,
  mediaDurationLimitStatus,
  remainingMediaDurationSeconds,
  sumMediaDurationMillis,
  UploaderStates,
} from "@storyteller/common";
import {
  AUDIO_FILE_ACCEPT,
  AUDIO_FILE_TYPE_ERROR,
  isAudioFile,
} from "@storyteller/ui-promptbox";
import { toast } from "../toast/toast";
import { AddButton } from "./ImagePromptRow";
import type { RefVideo, RefAudio } from "./types";
import {
  uploadVideo,
  uploadAudio,
  getVideoDuration,
  getAudioDuration,
} from "./upload-media";

interface MediaReferenceRowProps {
  videoSupported: boolean;
  audioSupported: boolean;
  referenceVideos: RefVideo[];
  onReferenceVideosChange: (videos: RefVideo[]) => void;
  maxVideoCount: number;
  maxVideoRefDuration: number;
  onPickVideoFromLibrary?: () => void;
  referenceAudios: RefAudio[];
  onReferenceAudiosChange: (audios: RefAudio[]) => void;
  maxAudioCount: number;
  maxAudioRefDuration: number;
  onPickAudioFromLibrary?: () => void;
  /** Host-owned state whose replacement invalidates mutually exclusive uploads. */
  externalOperationKey?: unknown;
  className?: string;
}

export const MediaReferenceRow = ({
  videoSupported,
  audioSupported,
  referenceVideos,
  onReferenceVideosChange,
  maxVideoCount,
  maxVideoRefDuration,
  onPickVideoFromLibrary,
  referenceAudios,
  onReferenceAudiosChange,
  maxAudioCount,
  maxAudioRefDuration,
  onPickAudioFromLibrary,
  externalOperationKey,
  className,
}: MediaReferenceRowProps) => {
  const videoInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const referenceVideosRef = useRef(referenceVideos);
  const referenceAudiosRef = useRef(referenceAudios);
  const videoEpochRef = useRef(0);
  const audioEpochRef = useRef(0);
  const mountedRef = useRef(true);
  const lastPublishedVideosRef = useRef<RefVideo[] | null>(null);
  const lastPublishedAudiosRef = useRef<RefAudio[] | null>(null);
  const previousVideosPropRef = useRef(referenceVideos);
  const previousAudiosPropRef = useRef(referenceAudios);
  const previousExternalOperationKeyRef = useRef(externalOperationKey);
  const livePolicyRef = useRef({
    videoSupported,
    audioSupported,
    maxVideoCount,
    maxVideoRefDuration,
    maxAudioCount,
    maxAudioRefDuration,
    onReferenceVideosChange,
    onReferenceAudiosChange,
  });
  livePolicyRef.current = {
    videoSupported,
    audioSupported,
    maxVideoCount,
    maxVideoRefDuration,
    maxAudioCount,
    maxAudioRefDuration,
    onReferenceVideosChange,
    onReferenceAudiosChange,
  };

  const videoPolicySignature = [
    videoSupported,
    maxVideoCount,
    maxVideoRefDuration,
  ].join("|");
  const audioPolicySignature = [
    audioSupported,
    maxAudioCount,
    maxAudioRefDuration,
  ].join("|");
  const renderedPolicyRef = useRef({
    video: videoPolicySignature,
    audio: audioPolicySignature,
  });
  if (renderedPolicyRef.current.video !== videoPolicySignature) {
    videoEpochRef.current++;
  }
  if (renderedPolicyRef.current.audio !== audioPolicySignature) {
    audioEpochRef.current++;
  }
  renderedPolicyRef.current = {
    video: videoPolicySignature,
    audio: audioPolicySignature,
  };

  if (previousVideosPropRef.current !== referenceVideos) {
    if (lastPublishedVideosRef.current !== referenceVideos) {
      videoEpochRef.current++;
    }
    previousVideosPropRef.current = referenceVideos;
    lastPublishedVideosRef.current = null;
  }
  if (previousAudiosPropRef.current !== referenceAudios) {
    if (lastPublishedAudiosRef.current !== referenceAudios) {
      audioEpochRef.current++;
    }
    previousAudiosPropRef.current = referenceAudios;
    lastPublishedAudiosRef.current = null;
  }
  if (previousExternalOperationKeyRef.current !== externalOperationKey) {
    videoEpochRef.current++;
    audioEpochRef.current++;
    previousExternalOperationKeyRef.current = externalOperationKey;
  }
  referenceVideosRef.current = referenceVideos;
  referenceAudiosRef.current = referenceAudios;

  const publishVideos = (next: RefVideo[]) => {
    referenceVideosRef.current = next;
    lastPublishedVideosRef.current = next;
    livePolicyRef.current.onReferenceVideosChange(next);
  };
  const publishAudios = (next: RefAudio[]) => {
    referenceAudiosRef.current = next;
    lastPublishedAudiosRef.current = next;
    livePolicyRef.current.onReferenceAudiosChange(next);
  };

  useEffect(() => {
    setUploadingVideo(false);
  }, [videoPolicySignature, referenceVideos, externalOperationKey]);

  useEffect(() => {
    setUploadingAudio(false);
  }, [audioPolicySignature, referenceAudios, externalOperationKey]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      videoEpochRef.current++;
      audioEpochRef.current++;
    };
  }, []);

  const totalVideoDurationMillis = sumMediaDurationMillis(
    referenceVideos.map((video) => video.duration),
  );
  const totalAudioDurationMillis = sumMediaDurationMillis(
    referenceAudios.map((audio) => audio.duration),
  );
  const maxVideoRefDurationMillis =
    durationSecondsToMillis(maxVideoRefDuration);
  const maxAudioRefDurationMillis =
    durationSecondsToMillis(maxAudioRefDuration);
  const videoDurationCeilingMillis =
    maxVideoRefDuration === Number.POSITIVE_INFINITY
      ? Number.POSITIVE_INFINITY
      : maxVideoRefDurationMillis;
  const audioDurationCeilingMillis =
    maxAudioRefDuration === Number.POSITIVE_INFINITY
      ? Number.POSITIVE_INFINITY
      : maxAudioRefDurationMillis;
  const totalVideoDurationDisplay =
    referenceVideos.length === 0
      ? "0"
      : formatMediaDurationMillis(totalVideoDurationMillis ?? Number.NaN);
  const totalAudioDurationDisplay =
    referenceAudios.length === 0
      ? "0"
      : formatMediaDurationMillis(totalAudioDurationMillis ?? Number.NaN);

  const canAddVideo =
    referenceVideos.length < maxVideoCount &&
    totalVideoDurationMillis != null &&
    videoDurationCeilingMillis != null &&
    totalVideoDurationMillis < videoDurationCeilingMillis &&
    !uploadingVideo;
  const canAddAudio =
    referenceAudios.length < maxAudioCount &&
    totalAudioDurationMillis != null &&
    audioDurationCeilingMillis != null &&
    totalAudioDurationMillis < audioDurationCeilingMillis &&
    !uploadingAudio;

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (videoInputRef.current) videoInputRef.current.value = "";
    if (files.length === 0 || !livePolicyRef.current.videoSupported) return;

    const operationEpoch = videoEpochRef.current;
    const file = files[0];
    const duration = await getVideoDuration(file);

    if (
      operationEpoch !== videoEpochRef.current ||
      !mountedRef.current ||
      !livePolicyRef.current.videoSupported
    ) {
      return;
    }
    if (duration == null) {
      toast.error("Could not read video file");
      return;
    }
    const baseVideos = referenceVideosRef.current;
    const currentDurations = baseVideos.map((video) => video.duration);
    const currentTotalMillis = sumMediaDurationMillis(currentDurations);
    const limitStatus = mediaDurationLimitStatus(
      [...currentDurations, duration],
      livePolicyRef.current.maxVideoRefDuration,
    );
    if (currentTotalMillis == null || limitStatus === "invalid") {
      toast.error("Could not verify video duration");
      return;
    }
    if (limitStatus === "over-limit") {
      const remainingDisplay = formatMediaDurationSeconds(
        remainingMediaDurationSeconds(
          currentDurations,
          livePolicyRef.current.maxVideoRefDuration,
        ) ?? 0,
      );
      toast.error(
        `Video too long — max ${livePolicyRef.current.maxVideoRefDuration}s total (${remainingDisplay}s remaining)`,
      );
      return;
    }

    setUploadingVideo(true);
    let settled = false;
    try {
      await uploadVideo({
        title: `reference-video-${Math.random().toString(36).substring(2, 15)}`,
        assetFile: file,
        progressCallback: (newState) => {
          if (newState.status === UploaderStates.success && newState.data) {
            if (settled) return;
            if (
              operationEpoch !== videoEpochRef.current ||
              !mountedRef.current ||
              !livePolicyRef.current.videoSupported
            ) {
              settled = true;
              return;
            }
            const previewUrl = createOwnedMediaObjectUrl(file);
            const refVideo: RefVideo = {
              id: Math.random().toString(36).substring(7),
              url: previewUrl,
              file,
              mediaToken: newState.data,
              duration,
            };
            const result = appendMediaReference(
              referenceVideosRef.current,
              refVideo,
              {
                maxCount: livePolicyRef.current.maxVideoCount,
                maxTotalSeconds: livePolicyRef.current.maxVideoRefDuration,
              },
            );
            settled = true;
            if (result.status === "added") {
              publishVideos(result.next);
            } else {
              discardOwnedMediaObjectUrl(previewUrl);
              if (result.status !== "duplicate") {
                toast.error("Video reference limit reached");
              }
            }
          } else if (
            newState.status === UploaderStates.assetError ||
            newState.status === UploaderStates.imageCreateError
          ) {
            if (settled) return;
            settled = true;
            toast.error(newState.errorMessage || "Could not upload video");
          }
        },
      });
    } catch (err) {
      if (!settled) {
        settled = true;
        toast.error(
          err instanceof Error ? err.message : "Could not upload video",
        );
      }
    } finally {
      settled = true;
      if (mountedRef.current && operationEpoch === videoEpochRef.current) {
        setUploadingVideo(false);
      }
    }
  };

  const handleAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (audioInputRef.current) audioInputRef.current.value = "";
    if (files.length === 0 || !livePolicyRef.current.audioSupported) return;

    const operationEpoch = audioEpochRef.current;
    const file = files[0];
    if (!isAudioFile(file)) {
      toast.error(AUDIO_FILE_TYPE_ERROR);
      return;
    }
    const duration = await getAudioDuration(file);

    if (
      operationEpoch !== audioEpochRef.current ||
      !mountedRef.current ||
      !livePolicyRef.current.audioSupported
    ) {
      return;
    }
    if (duration == null) {
      toast.error("Could not read audio file");
      return;
    }
    const baseAudios = referenceAudiosRef.current;
    const currentDurations = baseAudios.map((audio) => audio.duration);
    const currentTotalMillis = sumMediaDurationMillis(currentDurations);
    const limitStatus = mediaDurationLimitStatus(
      [...currentDurations, duration],
      livePolicyRef.current.maxAudioRefDuration,
    );
    if (currentTotalMillis == null || limitStatus === "invalid") {
      toast.error("Could not verify audio duration");
      return;
    }
    if (limitStatus === "over-limit") {
      const remainingDisplay = formatMediaDurationSeconds(
        remainingMediaDurationSeconds(
          currentDurations,
          livePolicyRef.current.maxAudioRefDuration,
        ) ?? 0,
      );
      toast.error(
        `Audio too long — max ${livePolicyRef.current.maxAudioRefDuration}s total (${remainingDisplay}s remaining)`,
      );
      return;
    }

    setUploadingAudio(true);
    let settled = false;
    try {
      await uploadAudio({
        title: `reference-audio-${Math.random().toString(36).substring(2, 15)}`,
        assetFile: file,
        progressCallback: (newState) => {
          if (newState.status === UploaderStates.success && newState.data) {
            if (settled) return;
            if (
              operationEpoch !== audioEpochRef.current ||
              !mountedRef.current ||
              !livePolicyRef.current.audioSupported
            ) {
              settled = true;
              return;
            }
            const previewUrl = createOwnedMediaObjectUrl(file);
            const refAudio: RefAudio = {
              id: Math.random().toString(36).substring(7),
              url: previewUrl,
              file,
              mediaToken: newState.data,
              duration,
            };
            const result = appendMediaReference(
              referenceAudiosRef.current,
              refAudio,
              {
                maxCount: livePolicyRef.current.maxAudioCount,
                maxTotalSeconds: livePolicyRef.current.maxAudioRefDuration,
              },
            );
            settled = true;
            if (result.status === "added") {
              publishAudios(result.next);
            } else {
              discardOwnedMediaObjectUrl(previewUrl);
              if (result.status !== "duplicate") {
                toast.error("Audio reference limit reached");
              }
            }
          } else if (
            newState.status === UploaderStates.assetError ||
            newState.status === UploaderStates.imageCreateError
          ) {
            if (settled) return;
            settled = true;
            toast.error(newState.errorMessage || "Could not upload audio");
          }
        },
      });
    } catch (err) {
      if (!settled) {
        settled = true;
        toast.error(
          err instanceof Error ? err.message : "Could not upload audio",
        );
      }
    } finally {
      settled = true;
      if (mountedRef.current && operationEpoch === audioEpochRef.current) {
        setUploadingAudio(false);
      }
    }
  };

  const removeVideo = (id: string) => {
    publishVideos(
      referenceVideosRef.current.filter((video) => video.id !== id),
    );
  };

  const removeAudio = (id: string) => {
    publishAudios(
      referenceAudiosRef.current.filter((audio) => audio.id !== id),
    );
  };

  return (
    <>
      <input
        type="file"
        ref={videoInputRef}
        className="hidden"
        accept="video/*"
        onChange={handleVideoUpload}
      />
      <input
        type="file"
        ref={audioInputRef}
        className="hidden"
        accept={AUDIO_FILE_ACCEPT}
        onChange={handleAudioUpload}
      />
      <div
        className={twMerge(
          "glass flex flex-col sm:flex-row rounded-2xl",
          className,
        )}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* Video section */}
        {videoSupported && (
          <div className="flex grow gap-2 px-3 py-2">
            <div className="flex grow flex-col gap-1">
              <div className="flex items-center gap-2 text-white/90">
                <VideoIcon  className="h-3.5 w-3.5" />
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  Video Ref
                  <span className="font-semibold text-white/60">
                    (
                    {maxVideoCount === Number.MAX_SAFE_INTEGER
                      ? referenceVideos.length
                      : `${referenceVideos.length}/${maxVideoCount}`}
                    )
                  </span>
                </span>
              </div>
              <span className="text-[13px] text-white/60">
                {totalVideoDurationDisplay}
                {isFinite(maxVideoRefDuration)
                  ? `/${maxVideoRefDuration}s`
                  : "s"}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {referenceVideos.map((video) => (
                <VideoRefTile
                  key={video.id}
                  video={video}
                  onRemove={removeVideo}
                />
              ))}
              {uploadingVideo && (
                <div className="flex aspect-square w-10 sm:w-14 items-center justify-center overflow-hidden rounded-lg border-2 border-white/30 bg-white/5">
                  <LoaderCircleIcon
                    
                    spin
                    className="h-5 w-5 text-white/60" />
                </div>
              )}
              {canAddVideo && (
                <AddButton
                  onUpload={() => videoInputRef.current?.click()}
                  onPickFromLibrary={onPickVideoFromLibrary}
                  title="Add video"
                />
              )}
            </div>
          </div>
        )}

        {videoSupported && audioSupported && (
          <div className="h-[1px] sm:h-auto sm:w-[1px] self-stretch bg-white/10 mx-3 sm:mx-0" />
        )}

        {/* Audio section */}
        {audioSupported && (
          <div className="flex grow gap-2 px-3 py-2">
            <div className="flex grow flex-col gap-1">
              <div className="flex items-center gap-2 text-white/90">
                <MusicIcon  className="h-3.5 w-3.5" />
                <span className="flex items-center gap-1.5 text-sm font-medium">
                  Audio Ref
                  <span className="font-semibold text-white/60">
                    (
                    {maxAudioCount === Number.MAX_SAFE_INTEGER
                      ? referenceAudios.length
                      : `${referenceAudios.length}/${maxAudioCount}`}
                    )
                  </span>
                </span>
              </div>
              <span className="text-[13px] text-white/60">
                {totalAudioDurationDisplay}
                {isFinite(maxAudioRefDuration)
                  ? `/${maxAudioRefDuration}s`
                  : "s"}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {referenceAudios.map((audio, i) => (
                <AudioRefTile
                  key={audio.id}
                  audio={audio}
                  index={i}
                  onRemove={removeAudio}
                />
              ))}
              {uploadingAudio && (
                <div className="flex aspect-square w-10 sm:w-14 items-center justify-center overflow-hidden rounded-lg border-2 border-white/30 bg-white/5">
                  <LoaderCircleIcon
                    
                    spin
                    className="h-5 w-5 text-white/60" />
                </div>
              )}
              {canAddAudio && (
                <AddButton
                  onUpload={() => audioInputRef.current?.click()}
                  onPickFromLibrary={onPickAudioFromLibrary}
                  title="Add audio"
                />
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
};

// ── Sub-components ───────────────────────────────────────────────────────

const VideoRefTile = ({
  video,
  onRemove,
}: {
  video: RefVideo;
  onRemove: (id: string) => void;
}) => (
  <div className="group relative aspect-square w-10 sm:w-14 overflow-hidden rounded-lg border-2 border-white/30 transition-all hover:border-white/80">
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
        onRemove(video.id);
      }}
      className="absolute right-[2px] top-[2px] flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-black/50 text-white sm:opacity-0 backdrop-blur-md transition-colors hover:bg-black sm:group-hover:opacity-100"
    >
      <XIcon  className="h-2.5 w-2.5" />
    </button>
  </div>
);

const AudioRefTile = ({
  audio,
  index,
  onRemove,
}: {
  audio: RefAudio;
  index: number;
  onRemove: (id: string) => void;
}) => {
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const handleTogglePlay = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isPlaying) {
        audioElRef.current?.pause();
        if (audioElRef.current) audioElRef.current.currentTime = 0;
        setIsPlaying(false);
      } else {
        const el = new Audio(audio.url);
        el.volume = 0.2;
        audioElRef.current = el;
        el.onended = () => setIsPlaying(false);
        el.play();
        setIsPlaying(true);
      }
    },
    [isPlaying, audio.url],
  );

  return (
    <div className="group relative flex aspect-square w-10 sm:w-14 cursor-pointer items-center justify-center overflow-hidden rounded-lg border-2 border-white/30 transition-all hover:border-white/80">
      <button
        onClick={handleTogglePlay}
        className="flex h-full w-full items-center justify-center"
      >
        <DynamicIcon
          icon={isPlaying ? SquareIcon : PlayIcon}
          className={twMerge(
            "h-5 w-5 transition-colors",
            isPlaying ? "text-red-400" : "text-white/60 group-hover:text-white",
          )}
        />
      </button>
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 flex items-center justify-center bg-black/70 py-0.5 text-[10px] font-bold text-white">
        #{index + 1} · {formatMediaDurationSeconds(audio.duration)}s
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onRemove(audio.id);
        }}
        className="absolute right-[2px] top-[2px] flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-black/50 text-white sm:opacity-0 backdrop-blur-md transition-colors hover:bg-black sm:group-hover:opacity-100"
      >
        <XIcon  className="h-2.5 w-2.5" />
      </button>
    </div>
  );
};
