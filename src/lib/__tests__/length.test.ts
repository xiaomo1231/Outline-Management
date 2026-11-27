import { describe, it, expect, vi, beforeEach } from "vitest";

// 模拟流式输出：每次调用按顺序取一段回复，逐字回调，遇到 abort 就停
const replies: string[] = [];
const calls: any[] = [];
vi.mock("../ai/client", async (orig) => {
  const real = (await orig()) as any;
  return {
    ...real,
    chat: async (messages: any[], o: any) => {
      calls.push({ messages, o });
      const text = replies.shift() ?? "";
      let out = "";
      for (const ch of text) {
        if (o.signal?.aborted) throw new real.AiError("已停止", "abort");
        out += ch;
        o.onDelta?.(ch);
      }
      if (o.signal?.aborted) throw new real.AiError("已停止", "abort");
      return { content: out, toolCalls: [], usage: null };
    },
  };
});

import { capOf, lenSpec, sentenceEndAfter, trimToSentence, writeToTarget } from "../ai/length";
import { fillTarget } from "../ai/tasks";

const zi = (n: number) => "字".repeat(n - 1) + "。";

beforeEach(() => {
  replies.length = 0;
  calls.length = 0;
});

describe("字数控制", () => {
  it("提示词给出区间", () => {
    expect(lenSpec(1000)).toContain("900–1100");
    expect(lenSpec(300)).not.toContain("自然段");
  });

  it("句末识别包括后引号", () => {
    expect(sentenceEndAfter("他说：“走吧。”然后", 0)).toBe(8);
    expect(trimToSentence("第一句。第二句没写完")).toBe("第一句。");
  });

  it("超过上限在句末停下", async () => {
    replies.push(zi(100).repeat(20)); // 2000 字
    let got = "";
    const text = await writeToTarget([], 1000, { onDelta: (d) => (got += d) });
    expect(text.length).toBeLessThanOrEqual(capOf(1000) + 100);
    expect(text.length).toBeGreaterThanOrEqual(capOf(1000));
    expect(text.endsWith("。")).toBe(true);
    expect(got).toBe(text);
  });

  it("不够就补写，最多两轮", async () => {
    replies.push(zi(300), zi(200), zi(200), zi(200));
    let got = "";
    const tops: number[] = [];
    const text = await writeToTarget([], 1000, { onDelta: (d) => (got += d), onTopUp: (n) => tops.push(n) });
    expect(tops).toEqual([1, 2]);
    expect(calls.length).toBe(3);
    // 补写时把已写的内容作为上一轮回答带上
    expect(calls[1].messages.at(-2)).toEqual({ role: "assistant", content: zi(300) });
    expect(calls[1].messages.at(-1).content).toContain("还差约 700 字");
    expect(text).toBe([zi(300), zi(200), zi(200)].join("\n\n"));
    expect(got).toBe(text);
  });

  it("够了就不补", async () => {
    replies.push(zi(900));
    await writeToTarget([], 1000, { onDelta: () => {} });
    expect(calls.length).toBe(1);
  });

  it("作者点停止时照常报停止", async () => {
    const ctl = new AbortController();
    replies.push(zi(500));
    let n = 0;
    await expect(writeToTarget([], 1000, { signal: ctl.signal, onDelta: () => ++n === 10 && ctl.abort() })).rejects.toThrow("已停止");
  });

  it("默认目标字数", () => {
    const work = { chapWords: 3000 } as any;
    const ch = (scenes: any[]) => ({ ch: { scenes } }) as any;
    expect(fillTarget({ work }, ch([]))).toBe(3000);
    expect(fillTarget({ work }, ch([{ words: 1000 }, {}]))).toBe(2500);
    expect(fillTarget({ work }, ch([]), "字".repeat(2800))).toBe(500);
    expect(fillTarget({ work }, ch([]), "字".repeat(1000))).toBe(2000);
  });
});
