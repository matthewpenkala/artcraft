import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UploadMediaFn } from "@storyteller/api";
import {
  resetOwnedMediaObjectUrlsForTests,
  UploaderStates,
} from "@storyteller/common";
import type { RefAudio, RefImage, RefVideo } from "./promptStore";
import { ImagePromptRow } from "./ImagePromptRow";

const dnd = vi.hoisted(() => ({
  onDragEnd: undefined as
    | ((event: { active: { id: string }; over: { id: string } | null }) => void)
    | undefined,
}));

const gallery = vi.hoisted(() => ({
  forceFilter: undefined as string | undefined,
  onClose: undefined as (() => void) | undefined,
  onUseSelected: undefined as
    | ((items: { id: string; fullImage?: string }[]) => Promise<void>)
    | undefined,
}));

vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    DndContext: ({
      children,
      onDragEnd,
    }: {
      children: ReactNode;
      onDragEnd?: typeof dnd.onDragEnd;
    }) => {
      dnd.onDragEnd = onDragEnd;
      return children;
    },
    useSensor: () => ({}),
    useSensors: () => [],
  };
});

vi.mock("@dnd-kit/sortable", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/sortable")>();
  return {
    ...actual,
    SortableContext: ({ children }: { children: ReactNode }) => children,
    useSortable: () => ({
      attributes: {},
      listeners: {},
      setNodeRef: () => undefined,
      transform: null,
      transition: undefined,
      isDragging: false,
    }),
  };
});

vi.mock("@storyteller/ui-button", () => ({
  Button: ({
    children,
    icon: _icon,
    variant: _variant,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    icon?: unknown;
    variant?: string;
  }) => <button {...props}>{children}</button>,
}));

vi.mock("@storyteller/ui-tooltip", () => ({
  Tooltip: ({
    children,
    content,
  }: {
    children: ReactNode;
    content?: ReactNode;
  }) => (
    <>
      {children}
      {content}
    </>
  ),
}));

vi.mock("@storyteller/ui-gallery-modal", () => ({
  GalleryModal: ({
    forceFilter,
    onClose,
    onUseSelected,
  }: {
    forceFilter?: string;
    onClose: () => void;
    onUseSelected: (
      items: { id: string; fullImage?: string }[],
    ) => Promise<void>;
  }) => {
    gallery.forceFilter = forceFilter;
    gallery.onClose = onClose;
    gallery.onUseSelected = onUseSelected;
    return null;
  },
}));

vi.mock("@storyteller/ui-toaster", () => ({
  toast: { error: vi.fn() },
}));

const image = (id: string): RefImage => ({
  id,
  url: `https://example.test/${id}.png`,
  file: new File([id], `${id}.png`, { type: "image/png" }),
  mediaToken: id,
});

const video = (id: string): RefVideo => ({
  id,
  url: `https://example.test/${id}.mp4`,
  file: new File([id], `${id}.mp4`, { type: "video/mp4" }),
  mediaToken: id,
  duration: 1,
});

const audio = (id: string): RefAudio => ({
  id,
  url: `https://example.test/${id}.mp3`,
  file: new File([id], `${id}.mp3`, { type: "audio/mpeg" }),
  mediaToken: id,
  duration: 1,
});

const ControlledRow = ({ initial }: { initial: RefImage[] }) => {
  const [images, setImages] = useState(initial);
  return (
    <>
      <output data-testid="tokens">
        {images.map((reference) => reference.mediaToken).join(",")}
      </output>
      <ImagePromptRow
        visible
        allowUpload
        maxImagePromptCount={4}
        referenceImages={images}
        setReferenceImages={setImages}
        uploadImage={deferredUpload}
      />
    </>
  );
};

let completeUpload: ((mediaToken: string) => void) | undefined;
let completeVideoUpload: ((mediaToken: string) => void) | undefined;
let completeAudioUpload: ((mediaToken: string) => void) | undefined;
const deferredUpload: UploadMediaFn = vi.fn(
  ({ progressCallback }) =>
    new Promise<void>(() => {
      completeUpload = (mediaToken) =>
        progressCallback({ status: UploaderStates.success, data: mediaToken });
    }),
);
const deferredVideoUpload: UploadMediaFn = vi.fn(
  ({ progressCallback }) =>
    new Promise<void>(() => {
      completeVideoUpload = (mediaToken) =>
        progressCallback({ status: UploaderStates.success, data: mediaToken });
    }),
);
const deferredAudioUpload: UploadMediaFn = vi.fn(
  ({ progressCallback }) =>
    new Promise<void>(() => {
      completeAudioUpload = (mediaToken) =>
        progressCallback({ status: UploaderStates.success, data: mediaToken });
    }),
);

const beginUpload = async (container: HTMLElement) => {
  const input = container.querySelector('input[accept="image/*"]');
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("image upload input not found");
  }
  fireEvent.change(input, {
    target: {
      files: [new File(["new"], "new.png", { type: "image/png" })],
    },
  });
  await waitFor(() => expect(completeUpload).toBeTypeOf("function"));
};

const completeLatestDurationProbe = async (
  createElementSpy: {
    mock: {
      calls: readonly (readonly unknown[])[];
      results: readonly { value: unknown }[];
    };
  },
  kind: "video" | "audio",
  duration: number,
) => {
  await waitFor(() =>
    expect(
      createElementSpy.mock.calls.some(([tagName]) => tagName === kind),
    ).toBe(true),
  );
  let probeIndex = -1;
  createElementSpy.mock.calls.forEach(([tagName], index) => {
    if (tagName === kind) probeIndex = index;
  });
  const media = createElementSpy.mock.results[probeIndex]
    ?.value as HTMLMediaElement;
  Object.defineProperty(media, "duration", {
    configurable: true,
    value: duration,
  });
  await act(async () => {
    media.onloadedmetadata?.(new Event("loadedmetadata"));
    await Promise.resolve();
  });
};

describe("ImagePromptRow live reference reconciliation", () => {
  beforeEach(() => {
    completeUpload = undefined;
    completeVideoUpload = undefined;
    completeAudioUpload = undefined;
    dnd.onDragEnd = undefined;
    gallery.forceFilter = undefined;
    gallery.onClose = undefined;
    gallery.onUseSelected = undefined;
    let objectUrlSequence = 0;
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => `blob:pending-media-${++objectUrlSequence}`),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    resetOwnedMediaObjectUrlsForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not restore a removed image when a pending upload completes in the same batch", async () => {
    const { container } = render(
      <ControlledRow initial={[image("removed")]} />,
    );
    await beginUpload(container);

    const remove = screen.getByRole("button", {
      name: "Remove reference image 1",
    });
    act(() => {
      remove.click();
      completeUpload?.("uploaded");
    });

    expect(screen.getByTestId("tokens").textContent).toBe("uploaded");
  });

  it("does not roll back a reorder when a pending upload completes in the same batch", async () => {
    const { container } = render(
      <ControlledRow initial={[image("first"), image("second")]} />,
    );
    await beginUpload(container);
    expect(dnd.onDragEnd).toBeTypeOf("function");

    act(() => {
      dnd.onDragEnd?.({
        active: { id: "first" },
        over: { id: "second" },
      });
      completeUpload?.("uploaded");
    });

    expect(screen.getByTestId("tokens").textContent).toBe(
      "second,first,uploaded",
    );
  });

  it("does not restore cleared images when a pending upload completes in the same batch", async () => {
    const { container } = render(
      <ControlledRow initial={[image("cleared")]} />,
    );
    await beginUpload(container);

    const clear = screen.getByRole("button", { name: "Clear all references" });
    act(() => {
      clear.click();
      completeUpload?.("uploaded");
    });

    expect(screen.getByTestId("tokens").textContent).toBe("");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:pending-media-1");
  });

  it("rejects a pending image when the current model lowers its cap", async () => {
    const setReferenceImages = vi.fn();
    const { container, rerender } = render(
      <ImagePromptRow
        visible
        allowUpload
        maxImagePromptCount={4}
        referenceImages={[]}
        setReferenceImages={setReferenceImages}
        uploadImage={deferredUpload}
      />,
    );
    await beginUpload(container);

    rerender(
      <ImagePromptRow
        visible
        allowUpload
        maxImagePromptCount={0}
        referenceImages={[]}
        setReferenceImages={setReferenceImages}
        uploadImage={deferredUpload}
      />,
    );
    act(() => completeUpload?.("too-late"));

    expect(setReferenceImages).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:pending-media-1");
  });

  it("releases and rejects a pending image after unmount", async () => {
    const setReferenceImages = vi.fn();
    const { container, unmount } = render(
      <ImagePromptRow
        visible
        allowUpload
        maxImagePromptCount={4}
        referenceImages={[]}
        setReferenceImages={setReferenceImages}
        uploadImage={deferredUpload}
      />,
    );
    await beginUpload(container);

    unmount();
    act(() => completeUpload?.("too-late"));

    expect(setReferenceImages).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:pending-media-1");
  });

  it("cancels pending video and audio uploads when references are cleared", async () => {
    const createElementSpy = vi.spyOn(document, "createElement");
    const setReferenceImages = vi.fn();
    const setEndFrameImage = vi.fn();
    const setReferenceVideos = vi.fn();
    const setReferenceAudios = vi.fn();
    const { container } = render(
      <ImagePromptRow
        visible
        allowUpload
        isVideo
        isReferenceMode
        showVideoReferenceSection
        showEndFrameSection={false}
        maxImagePromptCount={4}
        referenceImages={[]}
        setReferenceImages={setReferenceImages}
        endFrameImage={image("old-end")}
        setEndFrameImage={setEndFrameImage}
        referenceVideos={[video("old-video")]}
        setReferenceVideos={setReferenceVideos}
        maxVideoCount={3}
        uploadVideo={deferredVideoUpload}
        referenceAudios={[audio("old-audio")]}
        setReferenceAudios={setReferenceAudios}
        maxAudioCount={2}
        uploadAudio={deferredAudioUpload}
      />,
    );

    const videoInput = container.querySelector('input[accept*="video/mp4"]');
    const audioInput = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="file"]'),
    ).find((input) => input.accept.includes("audio"));
    if (!(videoInput instanceof HTMLInputElement) || !audioInput) {
      throw new Error("media upload inputs not found");
    }

    fireEvent.change(videoInput, {
      target: {
        files: [new File(["video"], "video.mp4", { type: "video/mp4" })],
      },
    });
    await completeLatestDurationProbe(createElementSpy, "video", 2);
    await waitFor(() => expect(completeVideoUpload).toBeTypeOf("function"));

    fireEvent.change(audioInput, {
      target: {
        files: [new File(["audio"], "audio.mp3", { type: "audio/mpeg" })],
      },
    });
    await completeLatestDurationProbe(createElementSpy, "audio", 2);
    await waitFor(() => expect(completeAudioUpload).toBeTypeOf("function"));

    fireEvent.click(
      screen.getByRole("button", { name: "Clear all references" }),
    );
    act(() => {
      completeVideoUpload?.("late-video");
      completeAudioUpload?.("late-audio");
    });

    expect(setReferenceVideos).toHaveBeenCalledTimes(1);
    expect(setReferenceVideos).toHaveBeenLastCalledWith([]);
    expect(setReferenceAudios).toHaveBeenCalledTimes(1);
    expect(setReferenceAudios).toHaveBeenLastCalledWith([]);
    expect(setEndFrameImage).toHaveBeenCalledTimes(1);
    expect(setEndFrameImage).toHaveBeenLastCalledWith(undefined);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(4);
  });

  it("invalidates an in-flight gallery duration probe on clear", async () => {
    const createElementSpy = vi.spyOn(document, "createElement");
    const setReferenceVideos = vi.fn();
    render(
      <ImagePromptRow
        visible
        allowUpload
        isVideo
        isReferenceMode
        showVideoReferenceSection
        showEndFrameSection={false}
        maxImagePromptCount={4}
        referenceImages={[]}
        setReferenceImages={vi.fn()}
        referenceVideos={[]}
        setReferenceVideos={setReferenceVideos}
        maxVideoCount={3}
        referenceAudios={[]}
        setReferenceAudios={vi.fn()}
      />,
    );

    const libraryButtons = screen.getAllByRole("button", {
      name: "Pick from library",
    });
    fireEvent.click(libraryButtons[libraryButtons.length - 1]!);
    await waitFor(() => expect(gallery.forceFilter).toBe("video"));

    let galleryOperation: Promise<void> | undefined;
    act(() => {
      galleryOperation = gallery.onUseSelected?.([
        { id: "library-video", fullImage: "https://example.test/video.mp4" },
      ]);
    });
    await waitFor(() =>
      expect(
        createElementSpy.mock.calls.some(([tagName]) => tagName === "video"),
      ).toBe(true),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Clear all references" }),
    );
    await act(async () => {
      await galleryOperation;
    });

    expect(setReferenceVideos).toHaveBeenCalledTimes(1);
    expect(setReferenceVideos).toHaveBeenLastCalledWith([]);
  });

  it("invalidates an in-flight gallery duration probe when the picker closes", async () => {
    const createElementSpy = vi.spyOn(document, "createElement");
    const setReferenceVideos = vi.fn();
    render(
      <ImagePromptRow
        visible
        allowUpload
        isVideo
        isReferenceMode
        showVideoReferenceSection
        showEndFrameSection={false}
        maxImagePromptCount={4}
        referenceImages={[]}
        setReferenceImages={vi.fn()}
        referenceVideos={[]}
        setReferenceVideos={setReferenceVideos}
        maxVideoCount={3}
        referenceAudios={[]}
        setReferenceAudios={vi.fn()}
      />,
    );
    const libraryButtons = screen.getAllByRole("button", {
      name: "Pick from library",
    });
    fireEvent.click(libraryButtons[libraryButtons.length - 1]!);
    await waitFor(() => expect(gallery.forceFilter).toBe("video"));

    let galleryOperation: Promise<void> | undefined;
    act(() => {
      galleryOperation = gallery.onUseSelected?.([
        { id: "library-video", fullImage: "https://example.test/video.mp4" },
      ]);
    });
    await waitFor(() =>
      expect(
        createElementSpy.mock.calls.some(([tagName]) => tagName === "video"),
      ).toBe(true),
    );
    let probeIndex = -1;
    createElementSpy.mock.calls.forEach(([tagName], index) => {
      if (tagName === "video") probeIndex = index;
    });
    const media = createElementSpy.mock.results[probeIndex]
      ?.value as HTMLMediaElement;
    act(() => gallery.onClose?.());
    await act(async () => galleryOperation);

    expect(setReferenceVideos).not.toHaveBeenCalled();
    expect(media.onloadedmetadata).toBeNull();
    expect(media.onerror).toBeNull();
  });
});
