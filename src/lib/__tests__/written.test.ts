import { describe, expect, it } from "vitest";
import { writtenSoFar } from "../ai/context";

describe("本章已写正文", () => {
  it("短章给全文", () => expect(writtenSoFar("  一二三  ")).toBe("一二三"));
  it("长章保留开头和结尾", () => {
    const t = "头".repeat(3000) + "中".repeat(5000) + "尾".repeat(3000);
    const w = writtenSoFar(t, 6000);
    expect(w.startsWith("头")).toBe(true);
    expect(w.endsWith("尾".repeat(3000))).toBe(true);
    expect(w).toContain("中间省略");
  });
});
