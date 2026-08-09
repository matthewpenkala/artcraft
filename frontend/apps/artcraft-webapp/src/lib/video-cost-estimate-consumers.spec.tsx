import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  estimateVideoCost: vi.fn(),
}));

vi.mock("@storyteller/api", () => ({
  OmniGenApi: class {
    estimateVideoCost = apiMocks.estimateVideoCost;
  },
}));
vi.mock("@storyteller/ui-model-selector", () => ({
  ModelPage: { Stage3D: "stage-3d" },
  useSelectedImageModel: vi.fn(),
}));
vi.mock("@storyteller/ui-promptbox", () => ({
  usePrompt3DStore: vi.fn(),
}));
vi.mock("@storyteller/ui-pricing-modal", () => ({
  useCostBreakdownModalStore: vi.fn(),
}));
vi.mock("@storyteller/omni-gen", () => ({
  useAudioCostEstimate: vi.fn(),
}));

import {
  useVideoCostEstimate as useWebappVideoCostEstimate,
  type VideoCostParams,
} from "./cost-estimate-api";

type EstimateHook = (params: VideoCostParams) => number | null;

interface PendingEstimate {
  body: Record<string, unknown>;
  resolve: (response: {
    success: boolean;
    cost_in_credits: number | null;
  }) => void;
}

const workspaceFile = (relativePath: string) => {
  let directory = process.cwd();
  for (;;) {
    const candidate = resolve(directory, relativePath);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`Missing ${relativePath}`);
    directory = parent;
  }
};

const baseParams: VideoCostParams = {
  model: "seedance_2p5",
  hasStartFrame: false,
  hasEndFrame: false,
  isReferenceMode: true,
  referenceImageCount: 0,
};

describe("webapp video estimate consumer", () => {
  const useEstimate: EstimateHook = useWebappVideoCostEstimate;
  let pending: PendingEstimate[];

  beforeEach(() => {
    pending = [];
    apiMocks.estimateVideoCost.mockReset();
    apiMocks.estimateVideoCost.mockImplementation(
      (body: Record<string, unknown>) =>
        new Promise((resolve) => pending.push({ body, resolve })),
    );
  });

  it("pairs create-video tokens with measured durations and probes gallery URLs", () => {
    const source = readFileSync(
      workspaceFile(
        "frontend/apps/artcraft-webapp/src/pages/create-video/create-video.tsx",
      ),
      "utf8",
    );

    expect(source).toContain("mediaToken: video.mediaToken");
    expect(source).toContain("durationSeconds: video.duration");
    expect(source).toContain("mediaToken: audio.mediaToken");
    expect(source).toContain("durationSeconds: audio.duration");
    expect(source).toContain("referenceVideoDurationPairs: isReferenceMode");
    expect(source).toContain("referenceAudioDurationPairs: isReferenceMode");
    expect(source).toContain("buildProbedVideoRefsToAdd(");
    expect(source).toContain("getVideoDurationFromUrl,");
    expect(source).not.toContain("candidate.duration > 0");
    expect(source).toContain("buildProbedTimedRefsToAdd(");
    expect(source).toContain("getAudioDurationFromUrl,");
    expect(source).toContain(
      "const result = await enqueueVideoGeneration(baseParams)",
    );
  });

  it("forwards per-file video millis and removes reference hints on mode switch", async () => {
    const { result, rerender } = renderHook(
      (params: VideoCostParams) => useEstimate(params),
      {
        initialProps: {
          ...baseParams,
          referenceVideoDurationPairs: [
            { mediaToken: "video-a", durationSeconds: 5.4 },
            { mediaToken: "video-b", durationSeconds: 5.4 },
          ],
          referenceAudioDurationPairs: [
            { mediaToken: "audio-a", durationSeconds: 5.6 },
            { mediaToken: "audio-b", durationSeconds: 5.6 },
          ],
        } as VideoCostParams,
      },
    );
    await waitFor(() => expect(pending).toHaveLength(1));
    expect(pending[0]?.body).toMatchObject({
      reference_video_media_tokens: ["video-a", "video-b"],
      reference_audio_media_tokens: ["audio-a", "audio-b"],
      estimate_only: {
        reference_video_durations_millis: [5_400, 5_400],
        total_input_video_duration_millis: 10_800,
        total_input_audio_duration_millis: 11_200,
      },
    });

    await act(async () => {
      pending[0]?.resolve({ success: true, cost_in_credits: 12 });
    });
    await waitFor(() => expect(result.current).toBe(12));

    rerender({
      ...baseParams,
      isReferenceMode: false,
      hasStartFrame: true,
    });
    expect(result.current).toBeNull();
    await waitFor(() => expect(pending).toHaveLength(2));
    expect(pending[1]?.body).toMatchObject({
      start_frame_image_media_token: "placeholder",
    });
    expect(pending[1]?.body).not.toHaveProperty("estimate_only");
    expect(pending[1]?.body).not.toHaveProperty("reference_video_media_tokens");
  });

  it("clears an old quote and ignores a superseded in-flight response", async () => {
    const { result, rerender } = renderHook(
      (params: VideoCostParams) => useEstimate(params),
      { initialProps: { ...baseParams, duration: 5 } as VideoCostParams },
    );
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => {
      pending[0]?.resolve({ success: true, cost_in_credits: 5 });
    });
    await waitFor(() => expect(result.current).toBe(5));

    rerender({ ...baseParams, duration: 6 });
    expect(result.current).toBeNull();
    await waitFor(() => expect(pending).toHaveLength(2));
    rerender({ ...baseParams, duration: 7 });
    await waitFor(() => expect(pending).toHaveLength(3));

    await act(async () => {
      pending[1]?.resolve({ success: true, cost_in_credits: 6 });
    });
    expect(result.current).toBeNull();
    await act(async () => {
      pending[2]?.resolve({ success: true, cost_in_credits: 7 });
    });
    await waitFor(() => expect(result.current).toBe(7));
  });

  it("clears without requesting for invalid durations or an empty model", async () => {
    const { result, rerender } = renderHook(
      (params: VideoCostParams) => useEstimate(params),
      { initialProps: { ...baseParams, duration: 5 } as VideoCostParams },
    );
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => {
      pending[0]?.resolve({ success: true, cost_in_credits: 5 });
    });
    await waitFor(() => expect(result.current).toBe(5));

    rerender({
      ...baseParams,
      referenceVideoDurationPairs: [
        { mediaToken: "video", durationSeconds: 0 },
      ],
    });
    expect(result.current).toBeNull();
    expect(apiMocks.estimateVideoCost).toHaveBeenCalledTimes(1);

    rerender({ ...baseParams, model: "" });
    expect(result.current).toBeNull();
    expect(apiMocks.estimateVideoCost).toHaveBeenCalledTimes(1);
  });
});
