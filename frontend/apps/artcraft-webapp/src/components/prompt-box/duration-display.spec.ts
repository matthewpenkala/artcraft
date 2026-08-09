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
    expect(promptBox).toContain(
      "formatMediaDurationSeconds(totalVideoRefSeconds)",
    );
    expect(promptBox).toContain(
      "formatMediaDurationSeconds(totalAudioRefSeconds)",
    );
    expect(createVideo).toContain(
      "formatMediaDurationSeconds(rejection.remainingSeconds)",
    );
    expect(createVideo).toContain("buildProbedTimedRefsToAdd(");
    expect(mediaReferenceRow).not.toContain("currentTotal + duration");
    expect(createVideo).not.toContain("total + duration");

    const combined = `${mediaReferenceRow}\n${promptBox}`;
    expect(combined).not.toMatch(/\{(?:video|audio)\.duration\}s/);
    expect(combined).not.toMatch(/\$\{total(?:Video|Audio)RefSeconds\}/);
  });
});
