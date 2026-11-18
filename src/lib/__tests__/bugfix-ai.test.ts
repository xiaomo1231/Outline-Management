import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

let settings: Record<string, unknown> = {};
let usageRows: { day: string; prompt: number; cached: number; completion: number; calls: number }[] = [];
const added: number[][] = [];

vi.mock("../repo", () => ({
  getSetting: async (k: string, fb: unknown) => settings[k] ?? fb,
  addUsage: async (...a: number[]) => void added.push(a),
  getUsage: async (n: number) => usageRows.slice(0, n),
}));
vi.mock("../secret", () => ({ getSecret: async () => "sk-test" }));
vi.mock("../db", () => ({ isTauri: false }));

import { AiError, chat, listModels, normAi, DEFAULT_AI } from "../ai/client";
import { today } from "../util";
import { firstLine } from "../outline";
import { Md } from "../../components/Md";

const enc = new TextEncoder();
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  settings = {};
  usageRows = [];
  added.length = 0;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const ok = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });
const sse = (lines: string[]) =>
  new Response(
    new ReadableStream({
      start(c) {
        for (const l of lines) c.enqueue(enc.encode(l + "\n\n"));
        c.close();
      },
    }),
    { status: 200 },
  );
const delta = (t: string, finish: string | null = null) => "data: " + JSON.stringify({ choices: [{ delta: { content: t }, finish_reason: finish }] });

async function err(p: Promise<unknown>): Promise<AiError> {
  try {
    await p;
  } catch (e) {
    return e as AiError;
  }
  throw new Error("没有报错");
}

describe("H6 每日 token 上限只看今天", () => {
  it("昨天超了，今天照常能用", async () => {
    settings.ai = { dailyLimit: 1000 };
    usageRows = [{ day: "2000-01-01", prompt: 3000, cached: 0, completion: 100, calls: 1 }];
    fetchMock.mockResolvedValue(ok("好"));
    expect((await chat([{ role: "user", content: "hi" }])).content).toBe("好");
  });
  it("今天超了才拦", async () => {
    settings.ai = { dailyLimit: 1000 };
    usageRows = [{ day: today(), prompt: 3000, cached: 0, completion: 100, calls: 1 }];
    const e = await err(chat([{ role: "user", content: "hi" }]));
    expect(e.code).toBe("limit");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("L48 200 但包体不对", () => {
  it("HTML、空包体、{error} 都给可读提示", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>gateway</html>", { status: 200 }));
    expect((await err(chat([]))).message).toContain("无法识别");
    fetchMock.mockResolvedValueOnce(new Response("", { status: 200 }));
    expect((await err(chat([]))).message).toContain("无法识别");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "bad" } }), { status: 200 }));
    const e = await err(chat([]));
    expect(e).toBeInstanceOf(AiError);
    expect(e.message).toContain("bad");
  });
});

describe("L51 测试连接的报错", () => {
  it("401 说明密钥问题，断网说连不上", async () => {
    fetchMock.mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));
    expect((await err(listModels())).message).toContain("密钥不对或已失效");
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const e = await err(listModels());
    expect(e.code).toBe("net");
    expect(e.message).toContain("连不上 DeepSeek");
  });
});

describe("L52 温度和模型名规整", () => {
  it("温度夹到 0–2，空模型名用默认", async () => {
    expect(normAi({ ...DEFAULT_AI, temperature: 5, model: "  ", writeModel: " x " })).toMatchObject({ temperature: 2, model: DEFAULT_AI.model, writeModel: "x" });
    expect(normAi({ ...DEFAULT_AI, temperature: -1 }).temperature).toBe(0);
    settings.ai = { temperature: 5, model: "  " };
    fetchMock.mockResolvedValue(ok("好"));
    await chat([{ role: "user", content: "hi" }]);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.temperature).toBe(2);
    expect(body.model).toBe(DEFAULT_AI.model);
  });
});

describe("L40 / L41 流式", () => {
  it("正常结束", async () => {
    fetchMock.mockResolvedValue(sse([delta("甲"), delta("乙", "stop"), 'data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":2}}', "data: [DONE]"]));
    const got: string[] = [];
    const r = await chat([], { onDelta: (t) => got.push(t) });
    expect(r.content).toBe("甲乙");
    expect(got).toEqual(["甲", "乙"]);
    expect(added).toEqual([[3, 0, 2]]);
  });
  it("没收到 [DONE] 就断了，提示可能不完整", async () => {
    fetchMock.mockResolvedValue(sse([delta("只写了半")]));
    const got: string[] = [];
    const e = await err(chat([], { onDelta: (t) => got.push(t) }));
    expect(got.join("")).toBe("只写了半");
    expect(e.message).toContain("不完整");
  });
  it("长度截断也提示", async () => {
    fetchMock.mockResolvedValue(sse([delta("半", "length"), "data: [DONE]"]));
    expect((await err(chat([], { onDelta: () => {} }))).message).toContain("不完整");
  });
  it("读流时停止，显示已停止；断网显示连接中断", async () => {
    fetchMock.mockImplementation(async (_u: string, init: RequestInit) => {
      const body = new ReadableStream({
        start(c) {
          c.enqueue(enc.encode(delta("甲") + "\n\n"));
          init.signal?.addEventListener("abort", () => c.error(new DOMException("signal is aborted without reason", "AbortError")));
        },
      });
      return new Response(body, { status: 200 });
    });
    const ac = new AbortController();
    const p = chat([], { onDelta: () => ac.abort(), signal: ac.signal });
    const e = await err(p);
    expect(e.code).toBe("abort");
    expect(e.message).toBe("已停止");

    fetchMock.mockImplementation(async () => {
      const body = new ReadableStream({
        start(c) {
          c.enqueue(enc.encode(delta("甲") + "\n\n"));
          setTimeout(() => c.error(new TypeError("network error")), 5);
        },
      });
      return new Response(body, { status: 200 });
    });
    const e2 = await err(chat([], { onDelta: () => {} }));
    expect(e2.code).toBe("net");
    expect(e2.message).not.toContain("network error");
  });
});

describe("L45 标题不吃开头的数字", () => {
  it("去列表序号，保留年份", () => {
    expect(firstLine("好的，以下是建议：\n1937年冬，林舟回到北平")).toBe("1937年冬，林舟回到北平");
    expect(firstLine("1. **天台相见**")).toBe("天台相见");
    expect(firstLine("2、雨夜")).toBe("雨夜");
    expect(firstLine("- 3.5倍的价钱")).toBe("3.5倍的价钱");
  });
});

describe("M37 有序列表编号", () => {
  const html = (t: string) => renderToStaticMarkup(createElement(Md, { text: t }));
  it("列表项之间夹说明行、空行时编号接着往下", () => {
    const h = html("1. **方向一**：林舟离开\n   说明：他走了\n2. **方向二**：苏晚留下\n\n   说明：她留下\n3. 方向三");
    expect(h.match(/<ol/g)?.length).toBe(1);
    expect(h.match(/<li>/g)?.length).toBe(3);
    expect(h).toContain("林舟离开<br/>说明：他走了");
  });
  it("被段落隔开时保留原编号", () => {
    const h = html("1. 甲\n中间一段话\n2. 乙");
    expect(h).toContain('<ol start="2">');
  });
  it("2023.10.1、3.5倍 这类不是列表", () => {
    const h = html("1. 甲\n2023.10.1 那天下雨\n3.5倍的价钱");
    expect(h).toContain("<p>2023.10.1 那天下雨</p>");
    expect(h).toContain("<p>3.5倍的价钱</p>");
  });
});
