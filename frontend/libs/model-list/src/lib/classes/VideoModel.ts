import { ModelCreator } from "src/index.js";
import { Model, ModelKind } from "./Model.js";
import { ModelCategory } from "../legacy/ModelConfig.js";
import { ModelTag } from "./metadata/ModelTag.js";
import { SizeOption } from "./metadata/SizeOption.js";
import { CommonBitrate, GenerationProvider } from "@storyteller/api-enums";
import {
  isValidVideoDuration,
  normalizeVideoDurationOptions,
} from "./properties/VideoDuration.js";

export class VideoModel extends Model {
  // Typescript type discriminator property
  // Since Vite minification and class name mangling can break instanceof checks,
  // we have a type discriminator property to check against.
  override readonly kind: ModelKind = "video_model";

  // Whether the model supports image starting frames
  readonly startFrame: boolean;

  // Whether the model supports image ending frames
  readonly endFrame: boolean;

  // Whether the model requires an image
  readonly requiresImage: boolean;

  // Whether the model can generate from a text prompt ALONE. When false, a text
  // prompt may still be used but an image (starting frame / reference) is also
  // required. Mirrors the webapp API's `text_to_video_supported`. Defaults true.
  readonly textToVideoSupported: boolean;

  // The size options for the model
  readonly sizeOptions: SizeOption[];

  // Default aspect ratio in the same wire-value form as sizeOptions.tauriValue
  readonly defaultAspectRatio?: string;

  // Whether this model supports toggling generation with sound
  readonly generateWithSound?: boolean;

  // Discrete duration options in seconds (e.g. [5, 10])
  readonly durationOptions?: number[];

  // Inclusive continuous duration range in seconds
  readonly minDuration?: number;
  readonly maxDuration?: number;

  // Maximum duration when a starting/reference/ending image is attached
  readonly maxDurationWithImageReferences?: number;

  // Default duration in seconds
  readonly defaultDuration?: number;

  // Independent media capabilities for reference mode
  readonly supportsImageReferences: boolean;
  readonly supportsVideoReferences: boolean;
  readonly supportsAudioReferences: boolean;

  // Whether the model supports any reference-mode medium
  readonly supportsReferenceMode: boolean;

  // Maximum number of reference images in reference mode
  readonly maxReferenceImages?: number;

  // Maximum number of reference videos in reference mode
  readonly maxReferenceVideos?: number;

  // Maximum total duration (seconds) of all reference videos combined
  readonly maxVideoRefDuration?: number;

  // Maximum number of reference audios in reference mode
  readonly maxReferenceAudios?: number;

  // Maximum total duration (seconds) of all reference audios combined
  readonly maxAudioRefDuration?: number;

  // Available resolution options (e.g. ["480p", "720p"])
  readonly resolutionOptions?: string[];

  // Whether the model supports using the CommonAspectRatio enum
  // We're just using this to select how to propagate aspect ratios
  // to the more recent models.
  // NB: Soon all the models will support this.
  readonly supportsCommonAspectRatio: boolean;

  // Default resolution
  readonly defaultResolution?: string;

  // Available output bitrate levels and the catalog-declared default
  readonly bitrateOptions?: CommonBitrate[];
  readonly defaultBitrate?: CommonBitrate;

  // Whether the model supports the system prompt toggle (default true)
  readonly supportsSystemPrompt: boolean;

  // Batch contract advertised by the backend.
  readonly minGenerationCount: number;
  readonly maxGenerationCount: number;
  readonly defaultGenerationCount: number;
  readonly predefinedGenerationCounts?: number[];

  constructor(args: {
    id: string;
    tauriId: string;
    fullName: string;
    category: ModelCategory;
    creator: ModelCreator;
    selectorName: string;
    selectorDescription: string;
    selectorBadges: string[];
    startFrame: boolean;
    endFrame: boolean;
    requiresImage: boolean;
    textToVideoSupported?: boolean;
    tags?: ModelTag[];
    sizeOptions?: SizeOption[];
    defaultAspectRatio?: string;
    progressBarTime?: number;
    generateWithSound?: boolean;
    providers?: GenerationProvider[];
    durationOptions?: number[];
    minDuration?: number;
    maxDuration?: number;
    maxDurationWithImageReferences?: number;
    defaultDuration?: number;
    supportsImageReferences?: boolean;
    supportsVideoReferences?: boolean;
    supportsAudioReferences?: boolean;
    /** Legacy aggregate used by static overlays while they migrate to the
     * independent media flags. */
    supportsReferenceMode?: boolean;
    maxReferenceImages?: number;
    maxReferenceVideos?: number;
    maxVideoRefDuration?: number;
    maxReferenceAudios?: number;
    maxAudioRefDuration?: number;
    resolutionOptions?: string[];
    defaultResolution?: string;
    bitrateOptions?: CommonBitrate[];
    defaultBitrate?: CommonBitrate;
    supportsSystemPrompt?: boolean;
    supportsCommonAspectRatio?: boolean;
    maxPromptLength?: number;
    minGenerationCount?: number;
    maxGenerationCount?: number;
    defaultGenerationCount?: number;
    predefinedGenerationCounts?: number[];
  }) {
    super(args);
    this.startFrame = args.startFrame;
    this.endFrame = args.endFrame;
    this.requiresImage = args.requiresImage;
    this.textToVideoSupported = args.textToVideoSupported ?? true;
    this.sizeOptions = args.sizeOptions ?? [];
    const defaultAspectRatio =
      typeof args.defaultAspectRatio === "string" &&
      args.defaultAspectRatio.length > 0 &&
      args.defaultAspectRatio === args.defaultAspectRatio.trim()
        ? args.defaultAspectRatio
        : undefined;
    this.defaultAspectRatio =
      defaultAspectRatio !== undefined &&
      (this.sizeOptions.length === 0 ||
        this.sizeOptions.some(
          ({ tauriValue }) => tauriValue === defaultAspectRatio,
        ))
        ? defaultAspectRatio
        : undefined;
    this.generateWithSound = args.generateWithSound || false;
    this.durationOptions = normalizeVideoDurationOptions(args.durationOptions);
    const minDuration = isValidVideoDuration(args.minDuration)
      ? args.minDuration
      : undefined;
    const maxDuration = isValidVideoDuration(args.maxDuration)
      ? args.maxDuration
      : undefined;
    const maxDurationWithImageReferences = isValidVideoDuration(
      args.maxDurationWithImageReferences,
    )
      ? args.maxDurationWithImageReferences
      : undefined;
    this.minDuration = minDuration;
    // Preserve individually valid incomplete bounds, but do not expose an
    // upper bound that contradicts an advertised minimum. The resolver can
    // then fall back to discrete options without carrying invalid metadata.
    this.maxDuration =
      maxDuration !== undefined &&
      (minDuration === undefined || maxDuration >= minDuration)
        ? maxDuration
        : undefined;
    // Preserve a valid image-specific cap even when the listing's scalar
    // relationships conflict. The resolver can then fail closed when the cap
    // falls below the general minimum, rather than silently dropping the cap
    // and sending a duration the backend explicitly disallowed.
    this.maxDurationWithImageReferences = maxDurationWithImageReferences;
    this.defaultDuration = isValidVideoDuration(args.defaultDuration)
      ? args.defaultDuration
      : undefined;
    const legacyReferenceMode = args.supportsReferenceMode === true;
    this.supportsImageReferences =
      args.supportsImageReferences ?? legacyReferenceMode;
    this.supportsVideoReferences =
      args.supportsVideoReferences ??
      (legacyReferenceMode &&
        typeof args.maxReferenceVideos === "number" &&
        args.maxReferenceVideos > 0);
    this.supportsAudioReferences =
      args.supportsAudioReferences ??
      (legacyReferenceMode &&
        typeof args.maxReferenceAudios === "number" &&
        args.maxReferenceAudios > 0);
    this.supportsReferenceMode =
      this.supportsImageReferences ||
      this.supportsVideoReferences ||
      this.supportsAudioReferences;
    this.maxReferenceImages = args.maxReferenceImages;
    this.maxReferenceVideos = args.maxReferenceVideos;
    this.maxVideoRefDuration = args.maxVideoRefDuration;
    this.maxReferenceAudios = args.maxReferenceAudios;
    this.maxAudioRefDuration = args.maxAudioRefDuration;
    this.resolutionOptions = args.resolutionOptions;
    this.defaultResolution = args.defaultResolution;
    this.bitrateOptions = args.bitrateOptions;
    this.defaultBitrate = args.defaultBitrate;
    this.supportsSystemPrompt = args.supportsSystemPrompt ?? true;
    this.supportsCommonAspectRatio = args.supportsCommonAspectRatio ?? false;
    const validCount = (value: unknown): value is number =>
      typeof value === "number" && Number.isSafeInteger(value) && value > 0;
    const advertisedCounts = (args.predefinedGenerationCounts ?? [])
      .filter(validCount)
      .filter((value, index, values) => values.indexOf(value) === index)
      .sort((a, b) => a - b);
    this.minGenerationCount = validCount(args.minGenerationCount)
      ? args.minGenerationCount
      : (advertisedCounts[0] ?? 1);
    this.maxGenerationCount = validCount(args.maxGenerationCount)
      ? Math.max(this.minGenerationCount, args.maxGenerationCount)
      : Math.max(
          this.minGenerationCount,
          advertisedCounts[advertisedCounts.length - 1] ??
            this.minGenerationCount,
        );
    const supportedCounts = advertisedCounts.filter(
      (value) =>
        value >= this.minGenerationCount && value <= this.maxGenerationCount,
    );
    this.predefinedGenerationCounts = supportedCounts.length
      ? supportedCounts
      : undefined;
    const clampedDefault = validCount(args.defaultGenerationCount)
      ? Math.min(
          Math.max(args.defaultGenerationCount, this.minGenerationCount),
          this.maxGenerationCount,
        )
      : this.minGenerationCount;
    this.defaultGenerationCount = this.predefinedGenerationCounts?.includes(
      clampedDefault,
    )
      ? clampedDefault
      : (this.predefinedGenerationCounts?.[0] ?? clampedDefault);
  }
}
