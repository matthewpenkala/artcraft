import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { RotateCwIcon } from "lucide-react";
import { Button } from "@storyteller/ui-button";
import { GalleryItem, GalleryModal } from "@storyteller/ui-gallery-modal";
import { MediaFilesApi } from "@storyteller/api";
import {
  addCorsParam,
  createOwnedMediaObjectUrl,
  discardOwnedMediaObjectUrl,
  reconcileOwnedMediaObjectUrls,
} from "@storyteller/common";
import Seo from "../../components/seo";
import { toast } from "../../components/toast/toast";
import { useSignupCta } from "../../components/signup-cta-modal";
import { isVideoUrl } from "../../components/lightbox/shared";
import { VideoDropZone } from "./video-drop-zone";
import { VideoScrubber } from "./video-scrubber";
import { ExtractionPanel } from "./extraction-panel";
import { FramesGrid, FrameActionState } from "./frames-grid";
import {
  captureFrameAt,
  extractFrames,
  FrameExtractionError,
  type ExtractedFrame,
} from "./lib/extract-frames";
import {
  downloadFrame,
  sendFrameToCreate,
  uploadFrame,
} from "./lib/frame-actions";

type VideoSource =
  | { kind: "local"; url: string }
  | { kind: "library"; url: string; mediaToken: string };

// Tokens minted per frame: a visible library save and a hidden reference
// upload are different files server-side, but a library save also works as a
// reference, so `library` is preferred when both could apply.
interface FrameTokens {
  library?: string;
  intermediate?: string;
}

export default function FrameExtractor() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { loggedIn, openSignupCta } = useSignupCta();

  const [source, setSource] = useState<VideoSource | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [resolution, setResolution] = useState<{ w: number; h: number } | null>(
    null,
  );
  const [numFrames, setNumFrames] = useState(10);
  const [spacingMs, setSpacingMs] = useState(100);
  const [frames, setFrames] = useState<ExtractedFrame[]>([]);
  const [actionState, setActionState] = useState<
    Record<string, FrameActionState>
  >({});
  const [isExtracting, setIsExtracting] = useState(false);
  const [isSavingAll, setIsSavingAll] = useState(false);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [gallerySelection, setGallerySelection] = useState<string[]>([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const frameTokensRef = useRef<Map<string, FrameTokens>>(new Map());
  const framesRef = useRef<ExtractedFrame[]>([]);
  const sourceRef = useRef<VideoSource | null>(null);
  const framesOwnerRef = useRef(Symbol("frame-extractor-frames"));
  const sourceOwnerRef = useRef(Symbol("frame-extractor-source"));
  const mountedRef = useRef(true);
  const sourceEpochRef = useRef(0);

  const commitFrames = useCallback(
    (update: (previous: ExtractedFrame[]) => ExtractedFrame[]) => {
      const previous = framesRef.current;
      const next = update(previous);
      reconcileOwnedMediaObjectUrls(
        framesOwnerRef.current,
        previous.map((frame) => frame.objectUrl),
        next.map((frame) => frame.objectUrl),
      );
      framesRef.current = next;
      setFrames(next);
    },
    [],
  );

  const commitSource = useCallback((next: VideoSource | null) => {
    const previous = sourceRef.current;
    reconcileOwnedMediaObjectUrls(
      sourceOwnerRef.current,
      previous?.kind === "local" ? [previous.url] : [],
      next?.kind === "local" ? [next.url] : [],
    );
    sourceRef.current = next;
    setSource(next);
  }, []);

  // ── Source loading ─────────────────────────────────────────────────────────

  const resetForNewSource = useCallback(() => {
    sourceEpochRef.current++;
    abortRef.current?.abort();
    abortRef.current = null;
    commitFrames(() => []);
    setActionState({});
    frameTokensRef.current.clear();
    setCurrentTime(0);
    setDuration(0);
    setResolution(null);
    setProgress(null);
    setIsExtracting(false);
  }, [commitFrames]);

  const setLocalSource = useCallback(
    (files: FileList) => {
      const file = files[0];
      if (!file || !file.type.startsWith("video/")) {
        toast.error("Please choose a video file");
        return;
      }
      resetForNewSource();
      commitSource({ kind: "local", url: createOwnedMediaObjectUrl(file) });
    },
    [commitSource, resetForNewSource],
  );

  const setLibrarySource = useCallback(
    (url: string, mediaToken: string) => {
      resetForNewSource();
      commitSource({
        kind: "library",
        url: addCorsParam(url) || url,
        mediaToken,
      });
    },
    [commitSource, resetForNewSource],
  );

  const clearSource = useCallback(() => {
    resetForNewSource();
    commitSource(null);
  }, [commitSource, resetForNewSource]);

  // Deep link from the library: /frame-extractor?media=<token>. Consumed once
  // so switching videos later doesn't resurrect the param's source.
  useEffect(() => {
    const token = searchParams.get("media");
    if (!token) return;
    setSearchParams({}, { replace: true });

    (async () => {
      try {
        const response = await new MediaFilesApi().GetMediaFileByToken({
          mediaFileToken: token,
        });
        const file = response.success ? response.data : null;
        const url = file?.media_links?.cdn_url;
        // MediaFileClass isn't exported from the @storyteller/api barrel;
        // compare the string value (same approach as the video editor's
        // media-source-adapter). isVideoUrl covers legacy "unknown" rows.
        const isVideo =
          (file?.media_class as string | null) === "video" ||
          (!!url && isVideoUrl(url));
        if (!url || !isVideo) {
          toast.error("That media item isn't a video");
          return;
        }
        setLibrarySource(url, token);
      } catch {
        toast.error("Failed to load media");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Final cleanup: abort any in-flight burst and release blob URLs that no
  // other page is displaying.
  useEffect(() => {
    // React StrictMode intentionally runs setup -> cleanup -> setup in
    // development. Restore the live flag on every setup so the probe/capture
    // completion guards do not discard valid results after that cycle.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sourceEpochRef.current++;
      abortRef.current?.abort();
      reconcileOwnedMediaObjectUrls(
        framesOwnerRef.current,
        framesRef.current.map((frame) => frame.objectUrl),
        [],
      );
      reconcileOwnedMediaObjectUrls(
        sourceOwnerRef.current,
        sourceRef.current?.kind === "local" ? [sourceRef.current.url] : [],
        [],
      );
      framesRef.current = [];
      sourceRef.current = null;
    };
  }, []);

  // ── Extraction ─────────────────────────────────────────────────────────────

  const reportExtractionError = useCallback((error: unknown) => {
    if (!(error instanceof FrameExtractionError)) {
      toast.error("Failed to capture frame");
      return;
    }
    switch (error.kind) {
      case "aborted":
        break;
      case "cors":
        toast.error(
          "This video can't be captured due to cross-origin protection. Download it and upload the file directly.",
        );
        break;
      case "timeout":
        toast.error("The video didn't finish loading — try again.");
        break;
      default:
        toast.error("Couldn't read this video. Try an MP4 (H.264) file.");
    }
  }, []);

  const handleCaptureCurrent = useCallback(async () => {
    const video = videoRef.current;
    if (!video || isExtracting) return;
    const sourceEpoch = sourceEpochRef.current;
    setIsExtracting(true);
    try {
      const frame = await captureFrameAt(video, video.currentTime);
      if (!mountedRef.current || sourceEpoch !== sourceEpochRef.current) {
        discardOwnedMediaObjectUrl(frame.objectUrl);
        return;
      }
      commitFrames((previous) => [frame, ...previous]);
    } catch (error) {
      if (mountedRef.current && sourceEpoch === sourceEpochRef.current) {
        reportExtractionError(error);
      }
    } finally {
      if (mountedRef.current && sourceEpoch === sourceEpochRef.current) {
        setIsExtracting(false);
      }
    }
  }, [commitFrames, isExtracting, reportExtractionError]);

  const handleExtractBurst = useCallback(async () => {
    const video = videoRef.current;
    if (!video || isExtracting) return;

    const abort = new AbortController();
    const sourceEpoch = sourceEpochRef.current;
    abortRef.current = abort;
    setIsExtracting(true);
    setProgress({ done: 0, total: numFrames });

    try {
      const extracted = await extractFrames(video, {
        startSec: video.currentTime,
        count: numFrames,
        spacingMs,
        signal: abort.signal,
        onProgress: (done, total) => {
          if (mountedRef.current && sourceEpoch === sourceEpochRef.current) {
            setProgress({ done, total });
          }
        },
      });
      if (
        !mountedRef.current ||
        sourceEpoch !== sourceEpochRef.current ||
        abort.signal.aborted
      ) {
        extracted.forEach((frame) =>
          discardOwnedMediaObjectUrl(frame.objectUrl),
        );
      } else if (extracted.length === 0) {
        toast.error("No frames could be captured before the video ended");
      } else {
        commitFrames((previous) => [...extracted.reverse(), ...previous]);
      }
    } catch (error) {
      if (mountedRef.current && sourceEpoch === sourceEpochRef.current) {
        reportExtractionError(error);
      }
    } finally {
      if (mountedRef.current && sourceEpoch === sourceEpochRef.current) {
        setIsExtracting(false);
        setProgress(null);
      }
      if (abortRef.current === abort) abortRef.current = null;
    }
  }, [commitFrames, isExtracting, numFrames, spacingMs, reportExtractionError]);

  const handleCancelBurst = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // ── Frame actions ──────────────────────────────────────────────────────────

  const patchFrameState = useCallback(
    (frameId: string, patch: FrameActionState) => {
      setActionState((prev) => ({
        ...prev,
        [frameId]: { ...prev[frameId], ...patch },
      }));
    },
    [],
  );

  // A frame saved to the library is also a valid reference; a hidden
  // reference upload never doubles as a library save.
  const tokenForReference = useCallback(
    async (frame: ExtractedFrame): Promise<string | null> => {
      const cached = frameTokensRef.current.get(frame.id);
      if (cached?.library || cached?.intermediate) {
        return cached.library ?? cached.intermediate ?? null;
      }
      const result = await uploadFrame(frame, { intermediate: true });
      if (!result.success) {
        toast.error(result.error);
        return null;
      }
      frameTokensRef.current.set(frame.id, {
        ...cached,
        intermediate: result.mediaToken,
      });
      return result.mediaToken;
    },
    [],
  );

  const handleSendToCreate = useCallback(
    async (frame: ExtractedFrame, destination: "image" | "video") => {
      if (!loggedIn) {
        openSignupCta();
        return;
      }
      patchFrameState(frame.id, { sending: true });
      const token = await tokenForReference(frame);
      const frameIsLive =
        mountedRef.current &&
        framesRef.current.some(
          (current) =>
            current.id === frame.id && current.objectUrl === frame.objectUrl,
        );
      if (!frameIsLive) return;
      patchFrameState(frame.id, { sending: false });
      if (!token) return;
      sendFrameToCreate(frame, token, destination, navigate);
    },
    [loggedIn, openSignupCta, patchFrameState, tokenForReference, navigate],
  );

  const saveFrameToLibrary = useCallback(
    async (frame: ExtractedFrame): Promise<boolean> => {
      const cached = frameTokensRef.current.get(frame.id);
      if (cached?.library) return true;
      const result = await uploadFrame(frame, { intermediate: false });
      if (!result.success) return false;
      frameTokensRef.current.set(frame.id, {
        ...cached,
        library: result.mediaToken,
      });
      return true;
    },
    [],
  );

  const handleSave = useCallback(
    async (frame: ExtractedFrame) => {
      if (!loggedIn) {
        openSignupCta();
        return;
      }
      const state = actionState[frame.id];
      if (state?.saved || state?.saving) return;
      patchFrameState(frame.id, { saving: true });
      const saved = await saveFrameToLibrary(frame);
      patchFrameState(frame.id, { saving: false, saved });
      if (saved) {
        toast.success("Frame saved to library");
      } else {
        toast.error("Failed to save frame");
      }
    },
    [loggedIn, openSignupCta, actionState, patchFrameState, saveFrameToLibrary],
  );

  const handleSaveAll = useCallback(async () => {
    if (!loggedIn) {
      openSignupCta();
      return;
    }
    if (isSavingAll) return;
    setIsSavingAll(true);
    let failures = 0;
    // Sequential on purpose — parallel uploads of dozens of PNGs invite rate
    // limiting, and per-frame progress reads better anyway.
    for (const frame of frames) {
      if (actionState[frame.id]?.saved) continue;
      patchFrameState(frame.id, { saving: true });
      const saved = await saveFrameToLibrary(frame);
      patchFrameState(frame.id, { saving: false, saved });
      if (!saved) failures++;
    }
    setIsSavingAll(false);
    if (failures === 0) {
      toast.success("All frames saved to library");
    } else {
      toast.error(
        `Failed to save ${failures} ${failures === 1 ? "frame" : "frames"}`,
      );
    }
  }, [
    loggedIn,
    openSignupCta,
    isSavingAll,
    frames,
    actionState,
    patchFrameState,
    saveFrameToLibrary,
  ]);

  const handleRemove = useCallback(
    (frame: ExtractedFrame) => {
      commitFrames((previous) =>
        previous.filter((item) => item.id !== frame.id),
      );
      frameTokensRef.current.delete(frame.id);
      setActionState((prev) => {
        const next = { ...prev };
        delete next[frame.id];
        return next;
      });
    },
    [commitFrames],
  );

  const handleClear = useCallback(() => {
    commitFrames(() => []);
    frameTokensRef.current.clear();
    setActionState({});
  }, [commitFrames]);

  // ── Library picker ─────────────────────────────────────────────────────────

  const handleOpenGallery = useCallback(() => {
    if (!loggedIn) {
      openSignupCta();
      return;
    }
    setIsGalleryOpen(true);
  }, [loggedIn, openSignupCta]);

  const handleGallerySelect = useCallback((id: string) => {
    setGallerySelection((prev) => (prev.includes(id) ? [] : [id]));
  }, []);

  const handleGalleryUse = useCallback(
    (selectedItems: GalleryItem[]) => {
      const item = selectedItems[0];
      if (!item?.fullImage) {
        toast.error("No video selected");
        return;
      }
      setLibrarySource(item.fullImage, item.id);
      setIsGalleryOpen(false);
      setGallerySelection([]);
    },
    [setLibrarySource],
  );

  const handleVideoError = useCallback(() => {
    toast.error("Your browser can't play this video. Try an MP4 (H.264) file.");
    clearSource();
  }, [clearSource]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="relative min-h-full w-full shrink-0 bg-[#101014] px-3 pb-8 sm:px-4 md:px-8 lg:px-12">
      <Seo
        title="Video Frame Extractor - ArtCraft"
        description="Grab a still frame from any video — capture, save to your library, or use it as an image prompt reference."
      />
      <div className="mx-auto max-w-[1200px] pt-6">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold text-base-fg">
              Frame Extractor
            </h1>
            {source && (
              <Button
                variant="action"
                icon={RotateCwIcon}
                onClick={clearSource}
                className="px-3 py-1.5 text-sm"
              >
                Switch Video
              </Button>
            )}
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
            {source ? (
              <VideoScrubber
                src={source.url}
                useCrossOrigin={source.kind === "library"}
                videoRef={videoRef}
                onTimeChange={setCurrentTime}
                onDurationChange={setDuration}
                onResolutionChange={setResolution}
                onCaptureRequest={handleCaptureCurrent}
                onVideoError={handleVideoError}
                disabled={isExtracting}
              />
            ) : (
              <VideoDropZone
                onFilesSelected={setLocalSource}
                onPickFromLibrary={handleOpenGallery}
              />
            )}
            <ExtractionPanel
              currentTime={currentTime}
              duration={duration}
              resolution={resolution}
              numFrames={numFrames}
              spacingMs={spacingMs}
              onNumFramesChange={setNumFrames}
              onSpacingChange={setSpacingMs}
              isExtracting={isExtracting}
              progress={progress}
              onCaptureCurrent={handleCaptureCurrent}
              onExtractBurst={handleExtractBurst}
              onCancel={handleCancelBurst}
              disabled={!source}
            />
          </div>

          <FramesGrid
            frames={frames}
            actionState={actionState}
            onUseAsImageRef={(frame) => handleSendToCreate(frame, "image")}
            onUseForVideo={(frame) => handleSendToCreate(frame, "video")}
            onSave={handleSave}
            onDownload={downloadFrame}
            onRemove={handleRemove}
            onSaveAll={handleSaveAll}
            isSavingAll={isSavingAll}
            onClear={handleClear}
          />
        </div>
      </div>

      <GalleryModal
        mode="select"
        isOpen={isGalleryOpen}
        onClose={() => {
          setIsGalleryOpen(false);
          setGallerySelection([]);
        }}
        selectedItemIds={gallerySelection}
        onSelectItem={handleGallerySelect}
        maxSelections={1}
        onUseSelected={handleGalleryUse}
        forceFilter="video"
        hideFilter
      />
    </div>
  );
}
