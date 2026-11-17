import { describe, expect, it } from "vitest";
import { bottomMargin, scrollDelta } from "../../components/keepCaret";

describe("打字时自动往下翻", () => {
  it("光标离底部还远就不动", () => {
    expect(scrollDelta(300, 330, 0, 800)).toBe(0);
  });
  it("光标贴近或超出底部就往下翻，留出四分之一屏", () => {
    expect(bottomMargin(800)).toBe(200);
    expect(scrollDelta(770, 800, 0, 800)).toBe(200);
    expect(scrollDelta(900, 930, 0, 800)).toBe(330);
  });
  it("窗口很矮时至少留 120 像素，但不会把光标推出顶部", () => {
    expect(bottomMargin(300)).toBe(120);
    expect(scrollDelta(100, 290, 0, 300)).toBe(92);
  });
});
