import { CommonBitrate } from "@storyteller/api-enums";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

import { GenerateVideo } from "./GenerateVideo.js";

describe("GenerateVideo bitrate bridge", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({ status: "success", payload: {} });
  });

  it("forwards an explicit bitrate to the Tauri command", async () => {
    await GenerateVideo({
      model: "seedance_2p0",
      bitrate: CommonBitrate.High,
    });

    expect(invokeMock).toHaveBeenCalledWith("generate_video_command", {
      request: {
        model: "seedance_2p0",
        bitrate: "high",
      },
    });
  });

  it("omits bitrate when the model has no bitrate selection", async () => {
    await GenerateVideo({ model: "grok_imagine_video_1p5" });

    expect(invokeMock).toHaveBeenCalledWith("generate_video_command", {
      request: {
        model: "grok_imagine_video_1p5",
      },
    });
  });
});
