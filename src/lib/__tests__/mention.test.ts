import { describe, expect, it } from "vitest";
import { addMentioned, mentioned } from "../mention";

const chars: { name: string; f: Record<string, string> }[] = [
  { name: "萧镇岳", f: { alias: "萧城主、城主" } },
  { name: "萧映棠", f: {} },
  { name: "江彤云", f: { alias: "彤云" } },
  { name: "沈厉霜", f: {} },
];

describe("按大纲识别出场人物", () => {
  it("名字和别名都能认出来", () => {
    expect(mentioned(chars, "萧城主注意到了彤云，萧映棠嘴上说用不着")).toEqual(["萧镇岳", "萧映棠", "江彤云"]);
  });
  it("只补新提到的，不把手动取消的加回来", () => {
    expect(addMentioned([], chars, "江彤云来了", "江彤云来了，萧映棠迎上去")).toEqual(["萧映棠"]);
    expect(addMentioned(["沈厉霜"], chars, "", "沈厉霜和江彤云")).toEqual(["沈厉霜", "江彤云"]);
  });
});
