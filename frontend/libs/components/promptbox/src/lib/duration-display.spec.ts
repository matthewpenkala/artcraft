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
    workspaceFile(`frontend/libs/components/promptbox/src/lib/${relativePath}`),
    "utf8",
  );

describe("reference duration display consumers", () => {
  it("formats exact card and legacy-row durations without raw interpolation", () => {
    const deckCard = readSource("./deck/DeckCard.tsx");
    const imagePromptRow = readSource("./ImagePromptRow.tsx");
    const audioReferenceRow = readSource("./common/AudioReferenceRow.tsx");

    expect(deckCard).toContain("formatMediaDurationSeconds(item.duration)");
    expect(imagePromptRow).toContain(
      "formatMediaDurationSeconds(video.duration)",
    );
    expect(imagePromptRow).toContain(
      "formatMediaDurationSeconds(audio.duration)",
    );
    expect(imagePromptRow).toContain(
      "formatMediaDurationMillis(totalVideoDurationMillis",
    );
    expect(imagePromptRow).toContain(
      "formatMediaDurationMillis(totalAudioDurationMillis",
    );
    expect(audioReferenceRow).toContain(
      "formatMediaDurationSeconds(audio.duration)",
    );

    const combined = `${deckCard}\n${imagePromptRow}\n${audioReferenceRow}`;
    expect(combined).not.toMatch(/\{(?:item|video|audio)\.duration\}s/);
    expect(combined).not.toMatch(/\{total(?:Video|Audio)Duration\}s/);
  });

  it("formats shared deck group totals", () => {
    const promptBoxVideo = readSource("./PromptBoxVideo.tsx");

    expect(promptBoxVideo).toContain(
      "formatMediaDurationSeconds(totalVideoRefSeconds)",
    );
    expect(promptBoxVideo).toContain(
      "formatMediaDurationSeconds(totalAudioRefSeconds)",
    );
    expect(promptBoxVideo).not.toMatch(/\$\{total(?:Video|Audio)RefSeconds\}/);
  });
});
