import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

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

const readSource = (relativePath: string) =>
  readFileSync(
    workspaceFile(
      `frontend/apps/artcraft-webapp/src/components/prompt-box/${relativePath}`,
    ),
    "utf8",
  );

describe("webapp reference duration display consumers", () => {
  it("formats cards, totals, group hints, and remaining duration", () => {
    const mediaReferenceRow = readSource("./MediaReferenceRow.tsx");
    const promptBox = readSource("./PromptBox.tsx");
    const createVideo = readFileSync(
      workspaceFile(
        "frontend/apps/artcraft-webapp/src/pages/create-video/create-video.tsx",
      ),
      "utf8",
    );

    for (const expression of [
      "formatMediaDurationSeconds(video.duration)",
      "formatMediaDurationSeconds(audio.duration)",
      "formatMediaDurationMillis(",
      "totalVideoDurationMillis",
      "totalAudioDurationMillis",
      "mediaDurationLimitStatus(",
      "remainingMediaDurationSeconds(",
    ]) {
      expect(mediaReferenceRow).toContain(expression);
    }
    expect(promptBox).toContain("formatMediaDurationSeconds(");
    expect(promptBox).toContain("totalVideoRefDisplay");
    expect(promptBox).toContain("totalAudioRefDisplay");
    expect(createVideo).toContain("formatMediaDurationSeconds(remaining)");
    expect(createVideo).toContain("remainingMediaDurationSeconds(");
    expect(createVideo).toContain("appendProbedMediaReferenceBatch(");
    expect(createVideo).toContain("const referenceMediaProjection = useMemo(");
    expect(createVideo).toContain("referenceMediaProjection;");
    expect(createVideo).toContain(
      'referenceOperationKey={`${selectedModel?.model ?? ""}:${isReferenceMode}`}',
    );
    expect(createVideo.match(/referenceOperationKey=/g)).toHaveLength(1);
    expect(createVideo).toContain(
      "onReferenceFramesChange={setReferenceFrames}",
    );
    expect(mediaReferenceRow).not.toContain("currentTotal + duration");
    expect(createVideo).not.toContain("total + duration");
    expect(createVideo).not.toContain('new File([], "library-');

    const combined = `${mediaReferenceRow}\n${promptBox}`;
    expect(combined).not.toMatch(/\{(?:video|audio)\.duration\}s/);
    expect(combined).not.toMatch(/\$\{total(?:Video|Audio)RefSeconds\}/);
  });

  it("does not clamp duration merely because empty Reference mode was selected", () => {
    const createVideo = readFileSync(
      workspaceFile(
        "frontend/apps/artcraft-webapp/src/pages/create-video/create-video.tsx",
      ),
      "utf8",
    );
    const handlerStart = createVideo.indexOf(
      "const handleInputModeChange = useCallback(",
    );
    const handlerEnd = createVideo.indexOf(
      "const imagePickerMax =",
      handlerStart,
    );

    expect(handlerStart).toBeGreaterThanOrEqual(0);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    const handler = createVideo.slice(handlerStart, handlerEnd);
    expect(handler).not.toContain("duration_seconds_max_with_image_references");
    expect(handler).not.toContain("setDuration(");
  });

  it("uses the same target-model image projection for UI, cost, and submit", () => {
    const createImage = readFileSync(
      workspaceFile(
        "frontend/apps/artcraft-webapp/src/pages/create-image/create-image.tsx",
      ),
      "utf8",
    );

    expect(createImage).toContain(
      "storedReferenceImages.slice(0, maxImageRefs)",
    );
    expect(createImage).toContain(
      "imageMediaTokenCount: referenceImages.length",
    );
  });
});
