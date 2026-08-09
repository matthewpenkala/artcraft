import { VideoModel } from "../classes/VideoModel.js";
import { getVideoDurationConstraint } from "../classes/properties/VideoDuration.js";
import { getEffectiveVideoReferenceCapabilities } from "../classes/properties/VideoReferenceCapabilities.js";
import { ModelCreator } from "../classes/metadata/ModelCreator.js";
import { buildVideoModelsFromListing } from "./buildModelsFromListing.js";

const overlayVideoModel = (durationOptions: number[] = [5, 10]) =>
  new VideoModel({
    id: "fictional_video",
    tauriId: "fictional_video",
    fullName: "Fictional video",
    category: "video",
    creator: ModelCreator.ArtCraft,
    selectorName: "Fictional video",
    selectorDescription: "Test fixture",
    selectorBadges: [],
    startFrame: false,
    endFrame: false,
    requiresImage: false,
    durationOptions,
    defaultDuration: 5,
  });

const overlayReferenceModel = () =>
  new VideoModel({
    id: "fictional_reference_video",
    tauriId: "fictional_reference_video",
    fullName: "Fictional reference video",
    category: "video",
    creator: ModelCreator.ArtCraft,
    selectorName: "Fictional reference video",
    selectorDescription: "Test fixture",
    selectorBadges: [],
    startFrame: true,
    endFrame: true,
    requiresImage: false,
    supportsReferenceMode: true,
    maxReferenceImages: 9,
    maxReferenceVideos: 3,
    maxVideoRefDuration: 15,
    maxReferenceAudios: 2,
    maxAudioRefDuration: 15,
  });

describe("buildVideoModelsFromListing duration capabilities", () => {
  it("hydrates range, image cap, options, and default without materializing the range", () => {
    const [model] = buildVideoModelsFromListing(
      [],
      [
        {
          model: "fictional_range_video",
          duration_seconds_options: [5, 10],
          duration_seconds_min: 4,
          duration_seconds_max: 30,
          duration_seconds_max_with_image_references: 10,
          duration_seconds_default: 7,
        },
      ],
      ["fictional_range_video"],
    );

    expect(model.durationOptions).toEqual([5, 10]);
    expect(model.minDuration).toBe(4);
    expect(model.maxDuration).toBe(30);
    expect(model.maxDurationWithImageReferences).toBe(10);
    expect(model.defaultDuration).toBe(7);
    expect(getVideoDurationConstraint(model)).toEqual({
      kind: "range",
      min: 4,
      max: 30,
    });
  });

  it("sanitizes invalid scalar values and discrete options", () => {
    const [model] = buildVideoModelsFromListing(
      [],
      [
        {
          model: "fictional_invalid_video",
          duration_seconds_options: [10, 0, 5, 10, 4.5, Infinity],
          duration_seconds_min: 4.5,
          duration_seconds_max: Number.MAX_SAFE_INTEGER + 1,
          duration_seconds_max_with_image_references: -1,
          duration_seconds_default: 0,
        },
      ],
      ["fictional_invalid_video"],
    );

    expect(model.durationOptions).toEqual([5, 10]);
    expect(model.minDuration).toBeUndefined();
    expect(model.maxDuration).toBeUndefined();
    expect(model.maxDurationWithImageReferences).toBeUndefined();
    expect(model.defaultDuration).toBeUndefined();
    expect(getVideoDurationConstraint(model)).toEqual({
      kind: "options",
      options: [5, 10],
    });
  });

  it("discards upper bounds that contradict a valid minimum", () => {
    const [model] = buildVideoModelsFromListing(
      [],
      [
        {
          model: "fictional_contradictory_video",
          duration_seconds_options: [5, 10],
          duration_seconds_min: 10,
          duration_seconds_max: 5,
          duration_seconds_max_with_image_references: 4,
          duration_seconds_default: 10,
        },
      ],
      ["fictional_contradictory_video"],
    );

    expect(model.minDuration).toBe(10);
    expect(model.maxDuration).toBeUndefined();
    expect(model.maxDurationWithImageReferences).toBe(4);
    expect(getVideoDurationConstraint(model)).toEqual({
      kind: "options",
      options: [5, 10],
    });
    expect(getVideoDurationConstraint(model, { imageCount: 1 })).toBeNull();
  });

  it("preserves a redundant image maximum while the resolver honors the tighter general maximum", () => {
    const [model] = buildVideoModelsFromListing(
      [],
      [
        {
          model: "fictional_excessive_image_cap_video",
          duration_seconds_min: 4,
          duration_seconds_max: 10,
          duration_seconds_max_with_image_references: 15,
          duration_seconds_default: 5,
        },
      ],
      ["fictional_excessive_image_cap_video"],
    );

    expect(model.minDuration).toBe(4);
    expect(model.maxDuration).toBe(10);
    expect(model.maxDurationWithImageReferences).toBe(15);
    expect(getVideoDurationConstraint(model, { imageCount: 1 })).toEqual({
      kind: "range",
      min: 4,
      max: 10,
    });
  });

  it("uses overlay options when the listing supplies no duration shape", () => {
    const [model] = buildVideoModelsFromListing(
      [overlayVideoModel()],
      [{ model: "fictional_video" }],
      ["fictional_video"],
    );

    expect(model.durationOptions).toEqual([5, 10]);
    expect(model.defaultDuration).toBe(5);
  });

  it("keeps an explicit empty listing option set authoritative", () => {
    const [model] = buildVideoModelsFromListing(
      [overlayVideoModel()],
      [
        {
          model: "fictional_video",
          duration_seconds_options: [],
          duration_seconds_min: 4,
        },
      ],
      ["fictional_video"],
    );

    expect(model.durationOptions).toBeUndefined();
    expect(getVideoDurationConstraint(model)).toBeNull();
  });
});

describe("buildVideoModelsFromListing reference capabilities", () => {
  it("keeps explicit false flags and zero limits authoritative over an overlay", () => {
    const [model] = buildVideoModelsFromListing(
      [overlayReferenceModel()],
      [
        {
          model: "fictional_reference_video",
          image_references_supported: false,
          image_references_max: 0,
          video_references_supported: false,
          video_references_max: 0,
          video_references_max_total_duration_seconds: 0,
          audio_references_supported: false,
          audio_references_max: 0,
          audio_references_max_total_duration_seconds: 0,
        },
      ],
      ["fictional_reference_video"],
    );

    expect(model).toMatchObject({
      supportsImageReferences: false,
      supportsVideoReferences: false,
      supportsAudioReferences: false,
      supportsReferenceMode: false,
      maxReferenceImages: 0,
      maxReferenceVideos: 0,
      maxVideoRefDuration: 0,
      maxReferenceAudios: 0,
      maxAudioRefDuration: 0,
    });
    expect(getEffectiveVideoReferenceCapabilities(model)).toMatchObject({
      maxReferenceImages: 0,
      maxReferenceVideos: 0,
      maxVideoRefDuration: 0,
      maxReferenceAudios: 0,
      maxAudioRefDuration: 0,
    });
  });

  it("uses a known overlay only when listing fields are absent", () => {
    const [model] = buildVideoModelsFromListing(
      [overlayReferenceModel()],
      [{ model: "fictional_reference_video" }],
      ["fictional_reference_video"],
    );

    expect(model).toMatchObject({
      supportsImageReferences: true,
      supportsVideoReferences: true,
      supportsAudioReferences: true,
      supportsReferenceMode: true,
      maxReferenceImages: 9,
      maxReferenceVideos: 3,
      maxReferenceAudios: 2,
    });
  });

  it("does not invent reference capabilities for an unknown server-only model", () => {
    const [model] = buildVideoModelsFromListing(
      [],
      [{ model: "server_only_video" }],
      ["server_only_video"],
    );

    expect(model).toMatchObject({
      supportsImageReferences: false,
      supportsVideoReferences: false,
      supportsAudioReferences: false,
      supportsReferenceMode: false,
    });
    expect(getEffectiveVideoReferenceCapabilities(model)).toMatchObject({
      maxReferenceImages: 0,
      maxReferenceVideos: 0,
      maxVideoRefDuration: 0,
      maxReferenceAudios: 0,
      maxAudioRefDuration: 0,
    });
  });

  it.each([
    ["image", true, false, false],
    ["video", false, true, false],
    ["audio", false, false, true],
  ])(
    "hydrates %s reference support independently",
    (_label, image, video, audio) => {
      const [model] = buildVideoModelsFromListing(
        [],
        [
          {
            model: "independent_reference_video",
            image_references_supported: image,
            video_references_supported: video,
            audio_references_supported: audio,
          },
        ],
        ["independent_reference_video"],
      );

      expect(model).toMatchObject({
        supportsImageReferences: image,
        supportsVideoReferences: video,
        supportsAudioReferences: audio,
        supportsReferenceMode: true,
      });
    },
  );
});
