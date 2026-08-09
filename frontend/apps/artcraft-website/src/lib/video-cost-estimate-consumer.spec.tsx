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

import {
  useVideoCostEstimate,
  type VideoCostParams,
} from "./cost-estimate-api";

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

describe("website video estimate consumer", () => {
  let pending: PendingEstimate[];

  beforeEach(() => {
    pending = [];
    apiMocks.estimateVideoCost.mockReset();
    apiMocks.estimateVideoCost.mockImplementation(
      (body: Record<string, unknown>) =>
        new Promise((resolve) => pending.push({ body, resolve })),
    );
  });

  it("pairs each create-video media token with its measured duration", () => {
    const source = readFileSync(
      workspaceFile(
        "frontend/apps/artcraft-website/src/pages/create-video/create-video.tsx",
      ),
      "utf8",
    );

    expect(source).toContain("mediaToken: video.mediaToken");
    expect(source).toContain("durationSeconds: video.duration");
    expect(source).toContain("mediaToken: audio.mediaToken");
    expect(source).toContain("durationSeconds: audio.duration");
    expect(source).toContain("referenceVideoDurationPairs: isReferenceMode");
    expect(source).toContain("referenceAudioDurationPairs: isReferenceMode");
    expect(source).toContain(
      "const result = await enqueueVideoGeneration(baseParams)",
    );
  });

  it("forwards exact per-file millis and raw legacy aggregates", async () => {
    renderHook(() =>
      useVideoCostEstimate({
        ...baseParams,
        referenceVideoDurationPairs: [
          { mediaToken: "video-a", durationSeconds: 5.4 },
          { mediaToken: "video-b", durationSeconds: 5.4 },
        ],
        referenceAudioDurationPairs: [
          { mediaToken: "audio-a", durationSeconds: 5.6 },
          { mediaToken: "audio-b", durationSeconds: 5.6 },
        ],
      }),
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
  });

  it("clears and invalidates an old response for changed or invalid params", async () => {
    const { result, rerender } = renderHook(
      (params: VideoCostParams) => useVideoCostEstimate(params),
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
    rerender({
      ...baseParams,
      referenceVideoDurationPairs: [
        { mediaToken: "video", durationSeconds: 0 },
      ],
    });
    expect(result.current).toBeNull();
    expect(apiMocks.estimateVideoCost).toHaveBeenCalledTimes(2);

    await act(async () => {
      pending[1]?.resolve({ success: true, cost_in_credits: 6 });
    });
    expect(result.current).toBeNull();

    rerender({ ...baseParams, model: "" });
    expect(result.current).toBeNull();
    expect(apiMocks.estimateVideoCost).toHaveBeenCalledTimes(2);
  });
});
