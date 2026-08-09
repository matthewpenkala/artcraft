import {
  projectVideoReferenceMedia,
  type EffectiveVideoReferenceCapabilities,
  type VideoReferenceCapabilities,
} from "@storyteller/model-list";
import type {
  RefAudio,
  RefImage,
  RefVideo,
  VideoInputMode,
} from "./promptStore";

export interface PromptVideoReferenceState {
  inputMode: VideoInputMode;
  referenceImages: RefImage[];
  endFrameImage?: RefImage;
  referenceVideos: RefVideo[];
  referenceAudios: RefAudio[];
}

export interface VideoReferenceRequestMedia {
  start_frame_image_media_token?: string;
  end_frame_image_media_token?: string;
  reference_image_media_tokens?: string[];
  reference_video_media_tokens?: string[];
  reference_audio_media_tokens?: string[];
}

export interface PromptVideoReferenceProjection
  extends PromptVideoReferenceState {
  capabilities: EffectiveVideoReferenceCapabilities;
  maxImageCount: number;
  maxVideoCount: number;
  maxAudioCount: number;
  acceptsReferenceImages: boolean;
  acceptsStartFrame: boolean;
  acceptsEndFrame: boolean;
  acceptsImages: boolean;
  acceptsVideos: boolean;
  acceptsAudio: boolean;
  requestMedia: VideoReferenceRequestMedia;
}

/**
 * Consumer boundary for the desktop prompt. The controls and generated
 * request are deliberately projected together so unsupported or over-limit
 * store media cannot be visible in one path but sent by another.
 */
export const projectPromptVideoReferences = (
  model: VideoReferenceCapabilities,
  state: PromptVideoReferenceState,
): PromptVideoReferenceProjection => {
  const projected = projectVideoReferenceMedia(model, state);
  const { capabilities } = projected;
  const isReferenceMode = projected.inputMode === "reference";
  const concreteCount = (limit: number | null) =>
    limit ?? Number.MAX_SAFE_INTEGER;
  const maxImageCount = isReferenceMode
    ? concreteCount(capabilities.maxReferenceImages)
    : capabilities.supportsStartFrame
      ? 1
      : 0;
  const maxVideoCount = concreteCount(capabilities.maxReferenceVideos);
  const maxAudioCount = concreteCount(capabilities.maxReferenceAudios);
  const acceptsReferenceImages =
    isReferenceMode && capabilities.canUseImageReferences;
  const acceptsStartFrame = !isReferenceMode && capabilities.supportsStartFrame;
  const acceptsEndFrame = !isReferenceMode && capabilities.supportsEndFrame;

  const requestMedia: VideoReferenceRequestMedia = isReferenceMode
    ? {
        reference_image_media_tokens:
          projected.referenceImages.length > 0
            ? projected.referenceImages.map((image) => image.mediaToken)
            : undefined,
        reference_video_media_tokens:
          projected.referenceVideos.length > 0
            ? projected.referenceVideos.map((video) => video.mediaToken)
            : undefined,
        reference_audio_media_tokens:
          projected.referenceAudios.length > 0
            ? projected.referenceAudios.map((audio) => audio.mediaToken)
            : undefined,
      }
    : {
        start_frame_image_media_token: projected.referenceImages[0]?.mediaToken,
        end_frame_image_media_token: projected.endFrameImage?.mediaToken,
      };

  return {
    ...projected,
    maxImageCount,
    maxVideoCount,
    maxAudioCount,
    acceptsReferenceImages,
    acceptsStartFrame,
    acceptsEndFrame,
    acceptsImages:
      acceptsReferenceImages || acceptsStartFrame || acceptsEndFrame,
    acceptsVideos: isReferenceMode && capabilities.canUseVideoReferences,
    acceptsAudio: isReferenceMode && capabilities.canUseAudioReferences,
    requestMedia,
  };
};

export interface PromptVideoReferenceSetters {
  setInputMode: (mode: VideoInputMode) => void;
  setReferenceImages: (images: RefImage[]) => void;
  setEndFrameImage: (image?: RefImage) => void;
  setReferenceVideos: (videos: RefVideo[]) => void;
  setReferenceAudios: (audios: RefAudio[]) => void;
}

/** Persist a projection only where it differs from the current store. */
export const synchronizePromptVideoReferences = (
  current: PromptVideoReferenceState,
  projected: PromptVideoReferenceProjection,
  setters: PromptVideoReferenceSetters,
): void => {
  if (current.inputMode !== projected.inputMode) {
    setters.setInputMode(projected.inputMode);
  }
  if (current.referenceImages !== projected.referenceImages) {
    setters.setReferenceImages(projected.referenceImages);
  }
  if (current.endFrameImage !== projected.endFrameImage) {
    setters.setEndFrameImage(projected.endFrameImage);
  }
  if (current.referenceVideos !== projected.referenceVideos) {
    setters.setReferenceVideos(projected.referenceVideos);
  }
  if (current.referenceAudios !== projected.referenceAudios) {
    setters.setReferenceAudios(projected.referenceAudios);
  }
};
