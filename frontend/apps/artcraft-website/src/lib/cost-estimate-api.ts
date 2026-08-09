import { useEffect, useRef, useState } from "react";
import { OmniGenApi } from "@storyteller/api";
import type { OmniGenImageRequest, OmniGenVideoRequest } from "@storyteller/api";
import {
  buildVideoCostEstimateRequest,
  type MediaTokenDurationPair,
} from "@storyteller/common";

// ── Image cost estimate hook ─────────────────────────────────────────────

export interface ImageCostParams {
  model: string;
  aspectRatio?: string;
  resolution?: string;
  quality?: string;
  numImages: number;
  hasReferenceImages: boolean;
  imageMediaTokenCount?: number;
}

export function useImageCostEstimate(params: ImageCostParams): number | null {
  const [credits, setCredits] = useState<number | null>(null);
  const abortRef = useRef(0);

  useEffect(() => {
    if (!params.model) {
      setCredits(null);
      return;
    }

    const id = ++abortRef.current;

    const body: OmniGenImageRequest = {
      model: params.model,
      aspect_ratio: params.aspectRatio ?? null,
      resolution: params.resolution ?? null,
      quality: params.quality ?? null,
      image_batch_count: params.numImages,
      image_media_tokens: params.hasReferenceImages
        ? new Array(params.imageMediaTokenCount ?? 1).fill("placeholder")
        : null,
    };

    const api = new OmniGenApi();
    api.estimateImageCost(body).then(
      (response) => {
        if (id !== abortRef.current) return;
        if (response.success && response.cost_in_credits != null) {
          setCredits(response.cost_in_credits);
        } else {
          setCredits(null);
        }
      },
      () => {
        if (id !== abortRef.current) return;
        setCredits(null);
      },
    );
  }, [
    params.model,
    params.aspectRatio,
    params.resolution,
    params.numImages,
    params.hasReferenceImages,
    params.imageMediaTokenCount,
  ]);

  return credits;
}

// ── Video cost estimate hook ─────────────────────────────────────────────

export interface VideoCostParams {
  model: string;
  aspectRatio?: string;
  resolution?: string | null;
  duration?: number | null;
  numVideos?: number;
  hasStartFrame: boolean;
  hasEndFrame: boolean;
  isReferenceMode: boolean;
  referenceImageCount: number;
  referenceVideoDurationPairs?: readonly MediaTokenDurationPair[];
  referenceAudioDurationPairs?: readonly MediaTokenDurationPair[];
  generateAudio?: boolean;
}

export function useVideoCostEstimate(params: VideoCostParams): number | null {
  const [credits, setCredits] = useState<number | null>(null);
  const abortRef = useRef(0);

  useEffect(() => {
    const id = ++abortRef.current;
    setCredits(null);
    if (!params.model) {
      return () => {
        if (id === abortRef.current) abortRef.current++;
      };
    }

    const body: OmniGenVideoRequest | null = buildVideoCostEstimateRequest({
      model: params.model,
      aspectRatio: params.aspectRatio,
      resolution: params.resolution,
      duration: params.duration,
      numVideos: params.numVideos,
      hasStartFrame: params.hasStartFrame,
      hasEndFrame: params.hasEndFrame,
      isReferenceMode: params.isReferenceMode,
      referenceImageCount: params.referenceImageCount,
      referenceVideoDurationPairs: params.referenceVideoDurationPairs,
      referenceAudioDurationPairs: params.referenceAudioDurationPairs,
      generateAudio: params.generateAudio,
    });
    if (!body) {
      return () => {
        if (id === abortRef.current) abortRef.current++;
      };
    }

    const api = new OmniGenApi();
    api.estimateVideoCost(body).then(
      (response) => {
        if (id !== abortRef.current) return;
        if (response.success && response.cost_in_credits != null) {
          setCredits(response.cost_in_credits);
        } else {
          setCredits(null);
        }
      },
      () => {
        if (id !== abortRef.current) return;
        setCredits(null);
      },
    );
    return () => {
      if (id === abortRef.current) abortRef.current++;
    };
  }, [
    params.model,
    params.aspectRatio,
    params.resolution,
    params.duration,
    params.numVideos,
    params.hasStartFrame,
    params.hasEndFrame,
    params.isReferenceMode,
    params.referenceImageCount,
    params.referenceVideoDurationPairs,
    params.referenceAudioDurationPairs,
    params.generateAudio,
  ]);

  return credits;
}
