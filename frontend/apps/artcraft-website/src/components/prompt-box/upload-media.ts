import { MediaUploadApi } from "@storyteller/api";
import {
  UploaderState,
  UploaderStates,
  probeMediaDurationFromFile,
} from "@storyteller/common";

export type UploadMediaFn = (args: {
  title: string;
  assetFile: File;
  progressCallback: (newState: UploaderState) => void;
}) => Promise<void>;

export const uploadVideo: UploadMediaFn = async ({
  title,
  assetFile,
  progressCallback,
}) => {
  const api = new MediaUploadApi();
  progressCallback({ status: UploaderStates.uploadingImage });

  try {
    const response = await api.UploadNewVideo({
      uuid: crypto.randomUUID(),
      blob: assetFile,
      fileName: assetFile.name || `reference-video-${Date.now()}`,
      maybe_title: `ref_video_${title}`,
    });

    if (!response?.success || !response.data) {
      progressCallback({
        status: UploaderStates.imageCreateError,
        errorMessage: response?.errorMessage ?? "Could not upload video",
      });
      return;
    }

    progressCallback({ status: UploaderStates.success, data: response.data });
  } catch (err) {
    progressCallback({
      status: UploaderStates.imageCreateError,
      errorMessage:
        err instanceof Error ? err.message : "Could not upload video",
    });
  }
};

export const uploadAudio: UploadMediaFn = async ({
  title,
  assetFile,
  progressCallback,
}) => {
  const api = new MediaUploadApi();
  progressCallback({ status: UploaderStates.uploadingImage });

  try {
    const response = await api.UploadAudio({
      uuid: crypto.randomUUID(),
      blob: assetFile,
      fileName: assetFile.name || `reference-audio-${Date.now()}`,
      maybe_title: `ref_audio_${title}`,
    });

    if (!response?.success || !response.data) {
      progressCallback({
        status: UploaderStates.imageCreateError,
        errorMessage: response?.errorMessage ?? "Could not upload audio",
      });
      return;
    }

    progressCallback({ status: UploaderStates.success, data: response.data });
  } catch (err) {
    progressCallback({
      status: UploaderStates.imageCreateError,
      errorMessage:
        err instanceof Error ? err.message : "Could not upload audio",
    });
  }
};

export const getVideoDuration = (file: File): Promise<number | null> =>
  probeMediaDurationFromFile("video", file);

export const getAudioDuration = (file: File): Promise<number | null> =>
  probeMediaDurationFromFile("audio", file);
