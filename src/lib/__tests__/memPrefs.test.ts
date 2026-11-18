import { describe, expect, it } from "vitest";
import { MEM_DEFAULT, migrateMemPrefs, residentLimitOf } from "../hooks";

describe("核心摘要上限", () => {
  it("默认 10000，超范围夹住", () => {
    expect(MEM_DEFAULT.residentLimit).toBe(10000);
    expect(residentLimitOf({})).toBe(10000);
    expect(residentLimitOf({ residentLimit: 50 })).toBe(1000);
    expect(residentLimitOf({ residentLimit: 99999 })).toBe(20000);
  });
  it("老设置里的旧默认 3000 升到 10000，作者改过的不动，只迁一次", () => {
    expect(migrateMemPrefs({ residentLimit: 3000, autoModel: true })).toEqual({ residentLimit: 10000, autoModel: true, rv: 2 });
    expect(migrateMemPrefs({ residentLimit: 5000 })).toEqual({ residentLimit: 5000, rv: 2 });
    expect(migrateMemPrefs({})).toEqual({ residentLimit: 10000, rv: 2 });
    expect(migrateMemPrefs({ residentLimit: 3000, rv: 2 })).toBeNull();
  });
});
