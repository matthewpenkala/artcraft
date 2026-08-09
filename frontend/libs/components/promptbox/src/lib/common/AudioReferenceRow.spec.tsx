import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UploaderStates, type UploaderState } from "@storyteller/common";
import type { UploadMediaFn } from "@storyteller/api";
import type { RefAudio, RefImage } from "../promptStore";
import { AudioReferenceRow } from "./AudioReferenceRow";

const audio = (id: string): RefAudio => ({
  id,
  url: `https://cdn.example/${id}.mp3`,
  file: new File([id], `${id}.mp3`, { type: "audio/mpeg" }),
  mediaToken: id,
  duration: 4,
});

const image = (id: string): RefImage => ({
  id,
  url: `https://cdn.example/${id}.png`,
  file: new File([id], `${id}.png`, { type: "image/png" }),
  mediaToken: id,
});

function mockMetadata(duration: number) {
  const originalCreateElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
    const element = originalCreateElement(tagName);
    if (tagName !== "audio") return element;
    Object.defineProperty(element, "duration", {
      configurable: true,
      value: duration,
    });
    Object.defineProperty(element, "src", {
      configurable: true,
      set: () =>
        queueMicrotask(() =>
          element.onloadedmetadata?.(new Event("loadedmetadata")),
        ),
    });
    return element;
  }) as typeof document.createElement);
}

describe("AudioReferenceRow async settlement", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:audio-reference"),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not resurrect cleared audio state from a deferred upload", async () => {
    mockMetadata(5.4);
    let complete!: (state: UploaderState) => void;
    let settle!: () => void;
    const uploadAudio: UploadMediaFn = vi.fn(
      ({ progressCallback }) =>
        new Promise<void>((resolve) => {
          complete = progressCallback;
          settle = resolve;
        }),
    );
    const onReferenceAudiosChange = vi.fn();
    const props = {
      onReferenceAudiosChange,
      maxAudioCount: 2,
      maxAudioRefDuration: 15,
      uploadAudio,
    };
    const { container, rerender } = render(
      <AudioReferenceRow {...props} referenceAudios={[audio("removed")]} />,
    );
    const input = container.querySelector<HTMLInputElement>(
      'input[accept*="audio"]',
    );
    if (!input) throw new Error("missing audio input");
    fireEvent.change(input, {
      target: {
        files: [new File(["late"], "late.mp3", { type: "audio/mpeg" })],
      },
    });
    await waitFor(() => expect(uploadAudio).toHaveBeenCalledOnce());

    rerender(<AudioReferenceRow {...props} referenceAudios={[]} />);
    complete({ status: UploaderStates.success, data: "late-token" });
    settle();
    await Promise.resolve();

    expect(onReferenceAudiosChange).not.toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledOnce();
  });

  it("rejects deferred image success after support changes or unmount", async () => {
    let complete!: (state: UploaderState) => void;
    let settle!: () => void;
    const uploadImage: UploadMediaFn = vi.fn(
      ({ progressCallback }) =>
        new Promise<void>((resolve) => {
          complete = progressCallback;
          settle = resolve;
        }),
    );
    const onReferenceImagesChange = vi.fn();
    const props = {
      referenceAudios: [] as RefAudio[],
      onReferenceAudiosChange: vi.fn(),
      maxAudioCount: 0,
      maxAudioRefDuration: 0,
      referenceImages: [image("existing")],
      onReferenceImagesChange,
      uploadImage,
    };
    const { container, rerender, unmount } = render(
      <AudioReferenceRow {...props} imageSupported />,
    );
    const input = container.querySelector<HTMLInputElement>(
      'input[accept="image/*"]',
    );
    if (!input) throw new Error("missing image input");
    fireEvent.change(input, {
      target: {
        files: [new File(["late"], "late.png", { type: "image/png" })],
      },
    });
    await waitFor(() => expect(uploadImage).toHaveBeenCalledOnce());

    rerender(<AudioReferenceRow {...props} imageSupported={false} />);
    unmount();
    complete({ status: UploaderStates.success, data: "late-token" });
    settle();
    await Promise.resolve();

    expect(onReferenceImagesChange).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
