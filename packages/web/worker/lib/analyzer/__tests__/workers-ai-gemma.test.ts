import { describe, expect, it } from "vitest";
import { toImageDataUri } from "../workers-ai-gemma";

describe("toImageDataUri", () => {
  it("data URI の media type は添付の content type", () => {
    const uri = toImageDataUri(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]).buffer, "image/png");

    expect(uri.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("charcode chunk 境界をまたぐ画像でも 1 byte も落とさない", () => {
    // fromCharCode の spread を割る 0x8000 境界を 2 回跨ぎ、端数も残す長さ。
    // 0x00 と 0xff を含めて latin1 往復で潰れないことも同時に見る。
    const size = 0x8000 * 2 + 7;
    const bytes = Uint8Array.from({ length: size }, (_, i) => i % 256);

    const uri = toImageDataUri(bytes.buffer, "image/jpeg");
    const base64 = uri.slice("data:image/jpeg;base64,".length);
    const decoded = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

    expect(decoded).toEqual(bytes);
  });

  it("空バッファは media type だけの data URI になる", () => {
    expect(toImageDataUri(new ArrayBuffer(0), "image/webp")).toBe("data:image/webp;base64,");
  });
});
