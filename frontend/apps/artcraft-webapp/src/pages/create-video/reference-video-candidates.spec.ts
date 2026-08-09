import { describe, expect, it, vi } from "vitest";
import {
  buildProbedTimedRefsToAdd,
  buildProbedVideoRefsToAdd,
} from "./reference-video-candidates";

describe("create-video reference candidates", () => {
  it("uses the current probe instead of stale positive gallery metadata", async () => {
    const probeDuration = vi.fn().mockResolvedValue(6.2);

    const result = await buildProbedVideoRefsToAdd(
      [{ url: "https://cdn.example/video.mp4", duration: 5.4 }],
      [],
      3,
      30,
      probeDuration,
    );

    expect(probeDuration).toHaveBeenCalledWith("https://cdn.example/video.mp4");
    expect(result).toEqual([
      { url: "https://cdn.example/video.mp4", duration: 6.2 },
    ]);
  });

  it("excludes a stale-positive candidate when the current probe fails", async () => {
    const onRejected = vi.fn();

    const result = await buildProbedVideoRefsToAdd(
      [{ url: "https://cdn.example/unreadable.mp4", duration: 5.4 }],
      [],
      3,
      30,
      vi.fn().mockResolvedValue(0),
      onRejected,
    );

    expect(result).toEqual([]);
    expect(onRejected).toHaveBeenCalledWith({ reason: "unreadable" });
  });

  it("accepts a sequential batch that lands exactly on a decimal cap", async () => {
    const probeDuration = vi
      .fn()
      .mockResolvedValueOnce(5.4)
      .mockResolvedValueOnce(3.4);

    const result = await buildProbedVideoRefsToAdd(
      [
        { url: "https://cdn.example/video-b.mp4", duration: 0 },
        { url: "https://cdn.example/video-c.mp4", duration: 0 },
      ],
      [{ url: "https://cdn.example/video-a.mp4", duration: 6.2 }],
      3,
      15,
      probeDuration,
    );

    expect(result.map((video) => video.duration)).toEqual([5.4, 3.4]);
  });

  it("uses the same exact current-total path for audio gallery candidates", async () => {
    const result = await buildProbedTimedRefsToAdd(
      [{ url: "https://cdn.example/audio-c.mp3", duration: 0 }],
      [
        { url: "https://cdn.example/audio-a.mp3", duration: 6.2 },
        { url: "https://cdn.example/audio-b.mp3", duration: 5.4 },
      ],
      3,
      15,
      vi.fn().mockResolvedValue(3.4),
    );

    expect(result).toEqual([
      { url: "https://cdn.example/audio-c.mp3", duration: 3.4 },
    ]);
  });

  it("warns once when several gallery probes are unreadable", async () => {
    const onRejected = vi.fn();

    const result = await buildProbedVideoRefsToAdd(
      [
        { url: "https://cdn.example/unreadable-a.mp4", duration: 5.4 },
        { url: "https://cdn.example/unreadable-b.mp4", duration: 5.4 },
      ],
      [],
      3,
      30,
      vi.fn().mockResolvedValue(0),
      onRejected,
    );

    expect(result).toEqual([]);
    expect(onRejected).toHaveBeenCalledTimes(1);
    expect(onRejected).toHaveBeenCalledWith({ reason: "unreadable" });
  });
});
