import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type SyntheticEvent,
} from "react";
import { ImageIcon, ImagesIcon, LoaderCircleIcon, PlusIcon, XIcon } from "lucide-react";
import { Button } from "@storyteller/ui-button";
import { Tooltip } from "@storyteller/ui-tooltip";
import { Modal } from "@storyteller/ui-modal";
import { twMerge } from "tailwind-merge";
import {
  UploaderStates,
  createOwnedMediaObjectUrl,
  discardOwnedMediaObjectUrl,
} from "@storyteller/common";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { RefImage } from "./types";
import { uploadImage } from "./upload-image";
import { useIsMobile } from "../ui/use-mobile";
import { SettingsDrawer } from "./mobile/SettingsDrawer";

type PendingCancellation = () => void;

const cancelPending = (pending: Set<PendingCancellation>) => {
  const cancellations = [...pending];
  pending.clear();
  cancellations.forEach((cancel) => cancel());
};

interface ImagePromptRowProps {
  maxImagePromptCount: number;
  referenceImages: RefImage[];
  setReferenceImages: (images: RefImage[]) => void;
  onPickFromLibrary?: () => void;
  onClearAll?: () => void; // unused, kept for API compat
  className?: string;

  // Video mode props
  isVideo?: boolean;
  isReferenceMode?: boolean;
  endFrameImage?: RefImage;
  setEndFrameImage?: (image?: RefImage) => void;
  showEndFrameSection?: boolean;
  onPickEndFrameFromLibrary?: () => void;
}

export const ImagePromptRow = ({
  maxImagePromptCount,
  referenceImages,
  setReferenceImages,
  onPickFromLibrary,
  onClearAll,
  className,
  isVideo,
  isReferenceMode,
  endFrameImage,
  setEndFrameImage,
  showEndFrameSection,
  onPickEndFrameFromLibrary,
}: ImagePromptRowProps) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const endFrameInputRef = useRef<HTMLInputElement>(null);

  // Stop in-row interactions from bubbling (drag/prompt-box behind), but let
  // events from portaled children (e.g. the mobile Add drawer) pass through so
  // Radix can dismiss them on backdrop click.
  const stopIfInside = (e: SyntheticEvent) => {
    if (rootRef.current?.contains(e.target as Node)) e.stopPropagation();
  };
  const [uploadingEndFrame, setUploadingEndFrame] = useState(false);
  const [uploadingImages, setUploadingImages] = useState<
    { id: string; previewUrl: string }[]
  >([]);
  const [previewImage, setPreviewImage] = useState<RefImage | null>(null);

  const mountedRef = useRef(true);
  const imageEpochRef = useRef(0);
  const endEpochRef = useRef(0);
  const pendingImageOperationsRef = useRef(new Set<PendingCancellation>());
  const pendingEndOperationsRef = useRef(new Set<PendingCancellation>());
  const livePolicyRef = useRef({
    maxImagePromptCount,
    isVideo,
    isReferenceMode,
    showEndFrameSection,
    setEndFrameImage,
  });
  livePolicyRef.current = {
    maxImagePromptCount,
    isVideo,
    isReferenceMode,
    showEndFrameSection,
    setEndFrameImage,
  };

  const imagePolicySignature = [
    maxImagePromptCount,
    isVideo,
    isReferenceMode,
  ].join("|");
  const endPolicySignature = [
    isVideo,
    isReferenceMode,
    showEndFrameSection,
    Boolean(setEndFrameImage),
  ].join("|");
  const renderedPolicySignaturesRef = useRef({
    image: imagePolicySignature,
    end: endPolicySignature,
  });
  if (renderedPolicySignaturesRef.current.image !== imagePolicySignature) {
    imageEpochRef.current += 1;
  }
  if (renderedPolicySignaturesRef.current.end !== endPolicySignature) {
    endEpochRef.current += 1;
  }
  renderedPolicySignaturesRef.current = {
    image: imagePolicySignature,
    end: endPolicySignature,
  };

  const referenceImagesRef = useRef(referenceImages);
  const lastPublishedImagesRef = useRef<RefImage[] | null>(null);
  const previousImagesPropRef = useRef(referenceImages);
  const imagesExternallyCleared =
    previousImagesPropRef.current !== referenceImages &&
    lastPublishedImagesRef.current !== referenceImages &&
    referenceImages.length === 0;
  if (imagesExternallyCleared) imageEpochRef.current += 1;
  if (previousImagesPropRef.current !== referenceImages) {
    previousImagesPropRef.current = referenceImages;
    lastPublishedImagesRef.current = null;
  }
  referenceImagesRef.current = referenceImages;

  const publishImages = (next: RefImage[]) => {
    referenceImagesRef.current = next;
    lastPublishedImagesRef.current = next;
    setReferenceImages(next);
  };

  const imageUploadSupported = () =>
    mountedRef.current && livePolicyRef.current.maxImagePromptCount > 0;
  const endUploadSupported = () => {
    const policy = livePolicyRef.current;
    return (
      mountedRef.current &&
      policy.isVideo === true &&
      policy.isReferenceMode !== true &&
      policy.showEndFrameSection === true &&
      Boolean(policy.setEndFrameImage)
    );
  };

  const cancelImageOperations = (advanceEpoch = true) => {
    if (advanceEpoch) imageEpochRef.current += 1;
    cancelPending(pendingImageOperationsRef.current);
    if (mountedRef.current) setUploadingImages([]);
  };
  const cancelEndOperations = (advanceEpoch = true) => {
    if (advanceEpoch) endEpochRef.current += 1;
    cancelPending(pendingEndOperationsRef.current);
    if (mountedRef.current) setUploadingEndFrame(false);
  };

  const appliedPolicySignaturesRef = useRef(
    renderedPolicySignaturesRef.current,
  );
  useEffect(() => {
    const previous = appliedPolicySignaturesRef.current;
    if (previous.image !== imagePolicySignature) {
      cancelImageOperations(false);
    }
    if (previous.end !== endPolicySignature) {
      cancelEndOperations(false);
    }
    appliedPolicySignaturesRef.current = {
      image: imagePolicySignature,
      end: endPolicySignature,
    };
  }, [imagePolicySignature, endPolicySignature]);

  useEffect(() => {
    if (imagesExternallyCleared) cancelImageOperations(false);
  }, [referenceImages]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      imageEpochRef.current += 1;
      endEpochRef.current += 1;
      cancelPending(pendingImageOperationsRef.current);
      cancelPending(pendingEndOperationsRef.current);
    };
  }, []);

  const allowReorder = maxImagePromptCount > 1 && referenceImages.length > 1;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const usedSlots = Math.min(
    maxImagePromptCount,
    referenceImages.length + uploadingImages.length,
  );

  const handleRemoveReference = (id: string) => {
    publishImages(
      referenceImagesRef.current.filter((image) => image.id !== id),
    );
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0 || !imageUploadSupported()) return;

    const currentCount =
      referenceImagesRef.current.length +
      pendingImageOperationsRef.current.size;
    const availableSlots = Math.max(
      0,
      livePolicyRef.current.maxImagePromptCount - currentCount,
    );
    if (availableSlots <= 0) {
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    const filesToProcess = files.slice(0, availableSlots);

    filesToProcess.forEach((file) => {
      const operationEpoch = imageEpochRef.current;
      const uploadId = Math.random().toString(36).substring(7);
      const previewUrl = createOwnedMediaObjectUrl(file);
      setUploadingImages((prev) => [...prev, { id: uploadId, previewUrl }]);

      let settled = false;
      const reader = new FileReader();
      const finish = () => {
        if (settled) return;
        settled = true;
        pendingImageOperationsRef.current.delete(cancel);
        discardOwnedMediaObjectUrl(previewUrl);
        if (mountedRef.current) {
          setUploadingImages((prev) =>
            prev.filter((image) => image.id !== uploadId),
          );
        }
      };
      const cancel = () => {
        reader.onloadend = null;
        reader.onerror = null;
        if (reader.readyState === FileReader.LOADING) reader.abort();
        finish();
      };
      const reject = cancel;
      pendingImageOperationsRef.current.add(cancel);

      reader.onloadend = async () => {
        if (typeof reader.result !== "string") {
          reject();
          return;
        }
        try {
          await uploadImage({
            title: `reference-image-${Math.random().toString(36).substring(2, 15)}`,
            assetFile: file,
            progressCallback: (newState) => {
              if (newState.status === UploaderStates.success && newState.data) {
                if (settled) return;
                if (
                  operationEpoch !== imageEpochRef.current ||
                  !imageUploadSupported()
                ) {
                  cancel();
                  return;
                }
                const refImage: RefImage = {
                  id: Math.random().toString(36).substring(7),
                  url: reader.result as string,
                  file,
                  mediaToken: newState.data,
                };
                finish();
                const current = referenceImagesRef.current;
                if (
                  current.length < livePolicyRef.current.maxImagePromptCount
                ) {
                  publishImages([...current, refImage]);
                }
              } else if (
                newState.status === UploaderStates.assetError ||
                newState.status === UploaderStates.imageCreateError
              ) {
                reject();
              }
            },
          });
        } finally {
          reject();
        }

        if (fileInputRef.current) fileInputRef.current.value = "";
      };
      reader.onerror = () => reject();
      reader.readAsDataURL(file);
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const current = referenceImagesRef.current;
    const oldIndex = current.findIndex((img) => img.id === active.id);
    const newIndex = current.findIndex((img) => img.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    publishImages(arrayMove(current, oldIndex, newIndex));
  };

  const handleEndFrameUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !endUploadSupported()) return;

    const operationEpoch = endEpochRef.current;
    setUploadingEndFrame(true);
    const reader = new FileReader();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      pendingEndOperationsRef.current.delete(cancel);
      if (mountedRef.current) setUploadingEndFrame(false);
    };
    const cancel = () => {
      reader.onloadend = null;
      reader.onerror = null;
      if (reader.readyState === FileReader.LOADING) reader.abort();
      finish();
    };
    pendingEndOperationsRef.current.add(cancel);
    reader.onloadend = async () => {
      if (typeof reader.result !== "string") {
        finish();
        return;
      }
      try {
        await uploadImage({
          title: `end-frame-${Math.random().toString(36).substring(2, 15)}`,
          assetFile: file,
          progressCallback: (newState) => {
            if (newState.status === UploaderStates.success && newState.data) {
              if (settled) return;
              if (
                operationEpoch !== endEpochRef.current ||
                !endUploadSupported()
              ) {
                cancel();
                return;
              }
              livePolicyRef.current.setEndFrameImage?.({
                id: Math.random().toString(36).substring(7),
                url: reader.result as string,
                file,
                mediaToken: newState.data,
              });
              finish();
            } else if (
              newState.status === UploaderStates.assetError ||
              newState.status === UploaderStates.imageCreateError
            ) {
              finish();
            }
          },
        });
      } finally {
        finish();
      }
      if (endFrameInputRef.current) endFrameInputRef.current.value = "";
    };
    reader.onerror = () => cancel();
    reader.readAsDataURL(file);
  };

  const canAddMore =
    referenceImages.length + uploadingImages.length < maxImagePromptCount;

  // Context-aware labels
  const sectionLabel = isVideo
    ? isReferenceMode
      ? "Image Ref"
      : "Start Frame"
    : "Image Prompts";

  const sectionSubtitle = isVideo
    ? isReferenceMode
      ? "Upload images"
      : "Animate an image"
    : "Use the elements of an image";

  const showCount = !isVideo || isReferenceMode;

  return (
    <>
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept="image/*"
        onChange={handleFileUpload}
        multiple={maxImagePromptCount > 1}
      />
      {showEndFrameSection && (
        <input
          type="file"
          ref={endFrameInputRef}
          className="hidden"
          accept="image/*"
          onChange={handleEndFrameUpload}
        />
      )}
      <div
        ref={rootRef}
        className={twMerge(
          "glass flex flex-col sm:flex-row rounded-2xl sm:rounded-t-2xl sm:rounded-b-none",
          className,
        )}
        onMouseDown={stopIfInside}
        onClick={stopIfInside}
        onPointerDown={stopIfInside}
      >
        <div className="flex min-w-0 flex-1 gap-2 px-3 py-2">
          <div className="flex grow flex-col gap-1 min-w-32">
            <div className="flex items-center gap-2 text-white/90">
              <ImageIcon  className="h-3.5 w-3.5" />
              <span className="flex items-center gap-1.5 text-sm font-medium">
                {sectionLabel}
                {showCount && (
                  <span className="font-semibold text-white/60">
                    (
                    {maxImagePromptCount === Number.MAX_SAFE_INTEGER
                      ? usedSlots
                      : `${usedSlots}/${maxImagePromptCount}`}
                    )
                  </span>
                )}
              </span>
            </div>
            <span className="text-[13px] text-white/60">{sectionSubtitle}</span>
          </div>

          <div className="flex flex-wrap gap-2">
            {allowReorder ? (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={referenceImages
                    .slice(0, maxImagePromptCount)
                    .map((img) => img.id)}
                  strategy={horizontalListSortingStrategy}
                >
                  {referenceImages
                    .slice(0, maxImagePromptCount)
                    .map((image) => (
                      <SortableImage
                        key={image.id}
                        image={image}
                        allowReorder={allowReorder}
                        onRemove={handleRemoveReference}
                        onPreview={(img) => setPreviewImage(img)}
                      />
                    ))}
                </SortableContext>
              </DndContext>
            ) : (
              referenceImages
                .slice(0, maxImagePromptCount)
                .map((image) => (
                  <ImageThumbnail
                    key={image.id}
                    image={image}
                    onRemove={handleRemoveReference}
                    onPreview={(img) => setPreviewImage(img)}
                  />
                ))
            )}

            {uploadingImages
              .slice(
                0,
                Math.max(0, maxImagePromptCount - referenceImages.length),
              )
              .map(({ id, previewUrl }) => (
                <UploadingThumbnail key={id} previewUrl={previewUrl} />
              ))}

            {canAddMore && (
              <AddButton
                onUpload={() => fileInputRef.current?.click()}
                onPickFromLibrary={onPickFromLibrary}
              />
            )}
          </div>
        </div>

        {/* End frame section */}
        {isVideo && showEndFrameSection && (
          <div className="flex min-w-0 flex-1 items-stretch gap-2 px-3 py-2 sm:py-0 sm:pe-3 sm:ps-0 border-t sm:border-t-0 border-white/10">
            <div className="flex grow gap-1">
              <div className="hidden sm:block w-[1px] bg-white/10" />
              <div className="flex grow flex-col gap-1 sm:p-2">
                <div className="flex items-center gap-2 text-white/90">
                  <ImageIcon  className="h-3.5 w-3.5" />
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    End Frame{" "}
                    <span className="text-xs text-white/60">(optional)</span>
                  </span>
                </div>
                <span className="text-[13px] text-white/60">
                  How video ends
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {endFrameImage ? (
                <div
                  className="group relative aspect-square w-10 sm:w-14 overflow-hidden rounded-lg border-2 border-white/30 transition-all cursor-pointer hover:border-white/80"
                  onClick={() => setPreviewImage(endFrameImage)}
                >
                  <img
                    src={endFrameImage.url}
                    alt="End frame"
                    className="h-full w-full object-cover"
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEndFrameImage?.(undefined);
                    }}
                    className="absolute right-[2px] top-[2px] flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-black/50 text-white sm:opacity-0 backdrop-blur-md transition-colors hover:bg-black sm:group-hover:opacity-100"
                  >
                    <XIcon  className="h-2.5 w-2.5" />
                  </button>
                </div>
              ) : uploadingEndFrame ? (
                <div className="flex aspect-square w-10 sm:w-14 items-center justify-center overflow-hidden rounded-lg border-2 border-white/30 bg-white/5">
                  <LoaderCircleIcon
                    
                    spin
                    className="h-5 w-5 text-white" />
                </div>
              ) : (
                <AddButton
                  onUpload={() => endFrameInputRef.current?.click()}
                  onPickFromLibrary={onPickEndFrameFromLibrary}
                />
              )}
            </div>
          </div>
        )}
      </div>

      <Modal
        isOpen={!!previewImage}
        onClose={() => setPreviewImage(null)}
        className="w-fit h-fit max-w-none bg-transparent border-0 p-0 shadow-none overflow-visible"
        backdropClassName="!bg-black/80"
        showClose={true}
        closeOnOutsideClick={true}
      >
        {previewImage && (
          <div className="relative flex items-center justify-center">
            <img
              src={previewImage.fullUrl || previewImage.url}
              alt="Preview"
              className="max-w-[90vw] max-h-[90vh] object-contain drop-shadow-2xl rounded-lg"
            />
          </div>
        )}
      </Modal>
    </>
  );
};

// ── Sub-components ───────────────────────────────────────────────────────

const ADD_BUTTON_CLASS =
  "flex aspect-square w-10 sm:w-14 items-center justify-center overflow-hidden rounded-lg border-2 border-dashed border-white/25 bg-white/5 transition-all hover:border-white/40 hover:bg-white/10";

// Upload / Pick-from-library affordance. On desktop it's a hover tooltip; on
// mobile that tooltip auto-opens from the emulated mouseenter fired on
// navigation, so we use a tap-triggered bottom sheet instead.
export const AddButton = ({
  onUpload,
  onPickFromLibrary,
  title = "Add image",
}: {
  onUpload: () => void;
  onPickFromLibrary?: () => void;
  title?: string;
}) => {
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const plus = (
    <PlusIcon  className="text-2xl text-white/80" />
  );

  if (!onPickFromLibrary) {
    return (
      <button onClick={onUpload} className={ADD_BUTTON_CLASS}>
        {plus}
      </button>
    );
  }

  if (isMobile) {
    return (
      <>
        <button
          onClick={() => setDrawerOpen(true)}
          className={ADD_BUTTON_CLASS}
        >
          {plus}
        </button>
        <SettingsDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          title={title}
          // Non-modal: this drawer opens the library modal on top of itself.
          // Two overlapping modal Radix layers each lock <body>, and the
          // sheet's close/cleanup strands a `pointer-events: none` lock on
          // <body> — freezing the whole page (mobile-only). See SettingsDrawer.
          modal={false}
        >
          <div className="flex flex-col gap-2 pb-2">
            <Button
              variant="primary"
              icon={PlusIcon}
              className="w-full"
              onClick={() => {
                onUpload();
                setDrawerOpen(false);
              }}
            >
              Upload
            </Button>
            <Button
              variant="action"
              icon={ImagesIcon}
              className="w-full bg-white/15 hover:bg-white/20"
              onClick={() => {
                setDrawerOpen(false);
                onPickFromLibrary();
              }}
            >
              Pick from library
            </Button>
          </div>
        </SettingsDrawer>
      </>
    );
  }

  return (
    <Tooltip
      interactive
      position="top"
      delay={100}
      className="bg-ui-controls text-base-fg border border-ui-controls-border p-2 -mb-0.5"
      closeOnClick
      content={
        <div className="flex flex-col gap-1.5">
          <Button
            variant="primary"
            onClick={onUpload}
            icon={PlusIcon}
            className="w-full"
          >
            Upload
          </Button>
          <Button
            variant="action"
            onClick={onPickFromLibrary}
            icon={ImagesIcon}
            className="w-full bg-white/15 hover:bg-white/20"
          >
            Pick from library
          </Button>
        </div>
      }
    >
      <button onClick={onUpload} className={ADD_BUTTON_CLASS}>
        {plus}
      </button>
    </Tooltip>
  );
};

const ImageThumbnail = ({
  image,
  onRemove,
  onPreview,
}: {
  image: RefImage;
  onRemove: (id: string) => void;
  onPreview?: (image: RefImage) => void;
}) => (
  <div
    className="group glass relative aspect-square w-10 sm:w-14 overflow-hidden rounded-lg border-2 border-white/30 transition-all cursor-pointer hover:border-white/80"
    onClick={() => onPreview?.(image)}
  >
    <img
      src={image.url}
      alt="Reference"
      className="h-full w-full object-cover"
    />
    <button
      aria-label="Remove reference image"
      onClick={(e) => {
        e.stopPropagation();
        onRemove(image.id);
      }}
      className="absolute right-[2px] top-[2px] flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-black/50 text-white sm:opacity-0 backdrop-blur-md transition-colors hover:bg-black sm:group-hover:opacity-100"
    >
      <XIcon  className="h-2.5 w-2.5" />
    </button>
  </div>
);

const SortableImage = ({
  image,
  allowReorder,
  onRemove,
  onPreview,
}: {
  image: RefImage;
  allowReorder: boolean;
  onRemove: (id: string) => void;
  onPreview?: (image: RefImage) => void;
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: image.id });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 9999 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(allowReorder ? { ...attributes, ...listeners } : {})}
      onClick={() => onPreview?.(image)}
      className={twMerge(
        "group glass relative aspect-square w-10 sm:w-14 overflow-hidden rounded-lg border-2 border-white/30 transition-opacity",
        allowReorder
          ? "cursor-move hover:border-white/80"
          : "cursor-pointer hover:border-white/80",
        isDragging && "opacity-50 shadow-lg",
      )}
    >
      <img
        src={image.url}
        alt="Reference"
        className="h-full w-full object-cover"
      />
      <button
        aria-label="Remove reference image"
        onClick={(e) => {
          e.stopPropagation();
          onRemove(image.id);
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        className="absolute right-[2px] top-[2px] flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-black/50 text-white sm:opacity-0 backdrop-blur-md transition-colors hover:bg-black sm:group-hover:opacity-100"
      >
        <XIcon  className="h-2.5 w-2.5" />
      </button>
    </div>
  );
};

const UploadingThumbnail = ({ previewUrl }: { previewUrl: string }) => {
  return (
    <div className="glass relative aspect-square w-10 sm:w-14 overflow-hidden rounded-lg border-2 border-white/30">
      <div className="absolute inset-0">
        <img
          src={previewUrl}
          alt="Uploading preview"
          className="h-full w-full object-cover blur-sm"
        />
      </div>
      <div className="absolute inset-0 flex items-center justify-center bg-black/20">
        <LoaderCircleIcon
          
          spin
          className="h-6 w-6 text-white" />
      </div>
    </div>
  );
};
