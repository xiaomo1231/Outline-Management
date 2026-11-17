import { describe, expect, it } from "vitest";
import { pickAsset, type Asset } from "../update";

const h = "sha256:" + "a".repeat(64);
const assets: Asset[] = [
  { name: "moshu_0.2.2_x64-portable.zip", url: "u1", digest: h, size: 1 },
  { name: "moshu_0.2.2_x64-setup.exe", url: "u2", digest: h, size: 2 },
  { name: "moshu_0.2.2_x64-portable.exe", url: "u3", digest: h, size: 3 },
];

describe("自动更新选文件", () => {
  it("安装版下 setup.exe，免安装版下 portable.exe", () => {
    expect(pickAsset(assets, "installer")?.url).toBe("u2");
    expect(pickAsset(assets, "portable")?.url).toBe("u3");
  });
  it("没有校验值的文件不自动下载", () => {
    expect(pickAsset([{ ...assets[1], digest: "" }], "installer")).toBeNull();
  });
  it("旧版本的发布页没有 portable.exe 时，免安装版不自动更新", () => {
    expect(pickAsset(assets.slice(0, 2), "portable")).toBeNull();
  });
});

import { noteLine } from "../ai/tasks";
describe("续写扩写的要求", () => {
  it("填了就优先照做，不填就按上下文和大纲", () => {
    expect(noteLine("节奏放慢，多写心理")).toContain("节奏放慢，多写心理");
    expect(noteLine("  ")).toContain("按前文、本章大纲和人物设定");
  });
});
