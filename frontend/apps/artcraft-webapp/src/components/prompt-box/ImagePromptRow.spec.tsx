import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resetOwnedMediaObjectUrlsForTests,
  UploaderStates,
  type UploaderState,
} from "@storyteller/common";
import { ImagePromptRow } from "./ImagePromptRow";
import type { RefImage } from "./types";

const upload = vi.hoisted(() => ({
  callback: undefined as ((state: UploaderState) => void) | undefined,
  start: vi.fn(
    ({
      progressCallback,
    }: {
      progressCallback: (state: UploaderState) => void;
    }) =>
      new Promise<void>(() => {
        upload.callback = progressCallback;
      }),
  ),
}));

vi.mock("./upload-image", () => ({ uploadImage: upload.start }));

vi.mock("../ui/use-mobile", () => ({ useIsMobile: () => false }));

vi.mock("./mobile/SettingsDrawer", () => ({
  SettingsDrawer: ({ children }: { children: ReactNode }) => children,
}));

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
  Tooltip: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@storyteller/ui-modal", () => ({ Modal: () => null }));

const referenceImage = (id: string): RefImage => ({
  id,
  url: `https://example.test/${id}.png`,
  file: new File([id], `${id}.png`, { type: "image/png" }),
  mediaToken: id,
});

const ControlledRow = ({
  showExternalClear = false,
}: {
  showExternalClear?: boolean;
}) => {
  const [images, setImages] = useState([referenceImage("removed")]);
  return (
    <>
      <output data-testid="tokens">
        {images.map((reference) => reference.mediaToken).join(",")}
      </output>
      <ImagePromptRow
        maxImagePromptCount={3}
        referenceImages={images}
        setReferenceImages={setImages}
      />
      {showExternalClear && (
        <button onClick={() => setImages([])}>External clear</button>
      )}
    </>
  );
};

const beginImageUpload = async (container: HTMLElement, inputIndex = 0) => {
  const input = container.querySelectorAll('input[accept="image/*"]')[
    inputIndex
  ];
  if (!(input instanceof HTMLInputElement)) {
    throw new Error("image upload input not found");
  }
  fireEvent.change(input, {
    target: {
      files: [new File(["new"], "new.png", { type: "image/png" })],
    },
  });
  await waitFor(() => expect(upload.callback).toBeTypeOf("function"));
};

describe("webapp ImagePromptRow live reference reconciliation", () => {
  beforeEach(() => {
    upload.callback = undefined;
    upload.start.mockClear();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:pending-image"),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    resetOwnedMediaObjectUrlsForTests();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("does not restore a removed image when a pending upload completes in the same batch", async () => {
    const { container } = render(<ControlledRow />);
    await beginImageUpload(container);

    const remove = screen.getByRole("button", {
      name: "Remove reference image",
    });
    act(() => {
      remove.click();
      upload.callback?.({
        status: UploaderStates.success,
        data: "uploaded",
      });
    });

    expect(screen.getByTestId("tokens").textContent).toBe("uploaded");
  });

  it("does not repopulate after an external clear and releases its preview URL", async () => {
    const { container } = render(<ControlledRow showExternalClear />);
    await beginImageUpload(container);

    fireEvent.click(screen.getByRole("button", { name: "External clear" }));
    act(() => {
      upload.callback?.({
        status: UploaderStates.success,
        data: "too-late",
      });
    });

    expect(screen.getByTestId("tokens").textContent).toBe("");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:pending-image");
  });

  it("uses the current lower cap when a deferred upload completes", async () => {
    const setReferenceImages = vi.fn();
    const { container, rerender } = render(
      <ImagePromptRow
        maxImagePromptCount={3}
        referenceImages={[]}
        setReferenceImages={setReferenceImages}
      />,
    );
    await beginImageUpload(container);

    rerender(
      <ImagePromptRow
        maxImagePromptCount={0}
        referenceImages={[]}
        setReferenceImages={setReferenceImages}
      />,
    );
    act(() => {
      upload.callback?.({
        status: UploaderStates.success,
        data: "too-late",
      });
    });

    expect(setReferenceImages).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:pending-image");
  });

  it("rejects a deferred upload and releases its preview URL after unmount", async () => {
    const setReferenceImages = vi.fn();
    const { container, unmount } = render(
      <ImagePromptRow
        maxImagePromptCount={3}
        referenceImages={[]}
        setReferenceImages={setReferenceImages}
      />,
    );
    await beginImageUpload(container);

    unmount();
    act(() => {
      upload.callback?.({
        status: UploaderStates.success,
        data: "too-late",
      });
    });

    expect(setReferenceImages).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:pending-image");
  });

  it("does not restore an end frame after the model switches to reference mode", async () => {
    const setEndFrameImage = vi.fn();
    const props = {
      maxImagePromptCount: 1,
      referenceImages: [] as RefImage[],
      setReferenceImages: vi.fn(),
      isVideo: true,
      showEndFrameSection: true,
      setEndFrameImage,
    };
    const { container, rerender } = render(<ImagePromptRow {...props} />);
    await beginImageUpload(container, 1);

    rerender(<ImagePromptRow {...props} isReferenceMode />);
    act(() => {
      upload.callback?.({
        status: UploaderStates.success,
        data: "too-late",
      });
    });

    expect(setEndFrameImage).not.toHaveBeenCalled();
  });
});
