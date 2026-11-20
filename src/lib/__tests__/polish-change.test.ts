import { describe, expect, it } from "vitest";
import { changeOf } from "../diff";

describe("润色结果和原文对比", () => {
  const orig = "她没接话，转身往街里走，走出几步，忽然停下来，刀在鞘里，可她的手按在刀柄上，人半侧着，眼神复杂的望向江彤云。";

  it("一字不改时判定为没改", () => {
    expect(changeOf(orig, orig).same).toBe(true);
    // 只差空白、换行也算没改
    expect(changeOf(orig, "  " + orig.replace("，", "， ") + "\n").same).toBe(true);
  });

  it("数出改了几处", () => {
    const next = "她没接话，转身往街里走。走出几步，忽然停下来，手按在刀柄上，人半侧着，眼神复杂地望向江彤云。";
    const c = changeOf(orig, next);
    expect(c.same).toBe(false);
    expect(c.n).toBeGreaterThanOrEqual(3);
    // 对照里删掉的和新加的拼回去分别等于原文和结果
    expect(c.parts.filter(([op]) => op <= 0).map(([, t]) => t).join("")).toBe(orig);
    expect(c.parts.filter(([op]) => op >= 0).map(([, t]) => t).join("")).toBe(next);
  });
});
