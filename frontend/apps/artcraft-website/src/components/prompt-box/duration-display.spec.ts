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

const promptBox = readFileSync(
  workspaceFile(
    "frontend/apps/artcraft-website/src/components/prompt-box/PromptBox.tsx",
  ),
  "utf8",
);

describe("website reference duration display consumers", () => {
  it("formats exact group totals without raw interpolation", () => {
    expect(promptBox).toContain("formatMediaDurationSeconds(");
    expect(promptBox).toContain("totalVideoRefDisplay");
    expect(promptBox).toContain("totalAudioRefDisplay");
    expect(promptBox).not.toMatch(/\$\{total(?:Video|Audio)RefSeconds\}/);
  });
});
