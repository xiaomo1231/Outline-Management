import { isTauri } from "../db";
import { addUsage, getSetting } from "../repo";
import { getSecret } from "../secret";

export interface AiSettings {
  baseUrl: string;
  /** 日常用的模型：起草、梳理、聊天 */
  model: string;
  /** 写正文和深度检查用的模型 */
  writeModel: string;
  temperature: number;
  /** 每天的 token 上限，0 表示不限 */
  dailyLimit: number;
}
export const DEFAULT_AI: AiSettings = { baseUrl: "https://api.deepseek.com", model: "deepseek-chat", writeModel: "deepseek-chat", temperature: 1.0, dailyLimit: 0 };

export async function aiSettings(): Promise<AiSettings> {
  return { ...DEFAULT_AI, ...(await getSetting<Partial<AiSettings>>("ai", {})) };
}

export class AiError extends Error {
  constructor(msg: string, public code: "nokey" | "http" | "net" | "limit" | "abort" | "parse") {
    super(msg);
  }
}

export interface Msg {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}
export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}
export interface ToolDef {
  type: "function";
  function: { name: string; description: string; parameters: object };
}
export interface Usage {
  prompt_tokens: number;
  completion_tokens: number;
  prompt_cache_hit_tokens?: number;
}

async function doFetch(url: string, init: RequestInit): Promise<Response> {
  if (isTauri) {
    // 走原生网络层，绕开浏览器的跨域限制
    const { fetch: tfetch } = await import("@tauri-apps/plugin-http");
    return tfetch(url, init);
  }
  return fetch(url, init);
}

async function prepare() {
  const cfg = await aiSettings();
  const key = await getSecret("deepseek");
  if (!key) throw new AiError("还没有填 DeepSeek 密钥，请到「设置」里填写。", "nokey");
  if (cfg.dailyLimit > 0) {
    const { getUsage } = await import("../repo");
    const u = (await getUsage(1))[0];
    if (u && u.prompt + u.completion > cfg.dailyLimit) throw new AiError(`今天的用量已经超过你设的上限（${cfg.dailyLimit} token），可以在「设置」里调整。`, "limit");
  }
  return { cfg, key };
}

export interface ChatOpts {
  model?: "main" | "write";
  json?: boolean;
  temperature?: number;
  tools?: ToolDef[];
  maxTokens?: number;
  signal?: AbortSignal;
  /** 传入后用流式返回，每收到一段就回调 */
  onDelta?: (text: string) => void;
}
export interface ChatResult {
  content: string;
  toolCalls: ToolCall[];
  usage: Usage | null;
}

export async function chat(messages: Msg[], o: ChatOpts = {}): Promise<ChatResult> {
  const { cfg, key } = await prepare();
  const body: any = {
    model: o.model === "write" ? cfg.writeModel : cfg.model,
    messages,
    temperature: o.temperature ?? cfg.temperature,
    stream: !!o.onDelta,
  };
  if (o.maxTokens) body.max_tokens = o.maxTokens;
  if (o.json) body.response_format = { type: "json_object" };
  if (o.tools?.length) body.tools = o.tools;
  if (o.onDelta) body.stream_options = { include_usage: true };
  let res: Response;
  try {
    res = await doFetch(cfg.baseUrl.replace(/\/$/, "") + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify(body),
      signal: o.signal,
    });
  } catch (e: any) {
    if (e?.name === "AbortError") throw new AiError("已停止", "abort");
    throw new AiError("连不上 DeepSeek：" + (e?.message || e), "net");
  }
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    const hint = res.status === 401 ? "密钥不对或已失效。" : res.status === 402 ? "DeepSeek 账户余额不足。" : res.status === 429 ? "请求太频繁，稍后再试。" : "";
    throw new AiError(`DeepSeek 返回 ${res.status}。${hint}${t.slice(0, 200)}`, "http");
  }
  let out: ChatResult;
  if (o.onDelta && res.body) out = await readStream(res, o.onDelta);
  else {
    const j = await res.json();
    const m = j.choices?.[0]?.message ?? {};
    out = { content: m.content ?? "", toolCalls: m.tool_calls ?? [], usage: j.usage ?? null };
  }
  if (out.usage) await addUsage(out.usage.prompt_tokens, out.usage.prompt_cache_hit_tokens ?? 0, out.usage.completion_tokens).catch(() => {});
  return out;
}

async function readStream(res: Response, onDelta: (t: string) => void): Promise<ChatResult> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let content = "";
  let usage: Usage | null = null;
  const tools: ToolCall[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const j = JSON.parse(data);
        if (j.usage) usage = j.usage;
        const d = j.choices?.[0]?.delta;
        if (d?.content) {
          content += d.content;
          onDelta(d.content);
        }
        for (const tc of d?.tool_calls ?? []) {
          const t = (tools[tc.index] ??= { id: "", type: "function", function: { name: "", arguments: "" } });
          if (tc.id) t.id = tc.id;
          if (tc.function?.name) t.function.name += tc.function.name;
          if (tc.function?.arguments) t.function.arguments += tc.function.arguments;
        }
      } catch {
        /* 半截的行等下一段 */
      }
    }
  }
  return { content, toolCalls: tools.filter(Boolean), usage };
}

/** 让模型返回 JSON 并解析；解析失败重试一次 */
export async function chatJson<T>(messages: Msg[], o: ChatOpts = {}): Promise<T> {
  for (let i = 0; i < 2; i++) {
    const r = await chat(messages, { ...o, json: true });
    try {
      const t = r.content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
      return JSON.parse(t) as T;
    } catch {
      if (i === 1) throw new AiError("AI 返回的内容格式不对，请再试一次。", "parse");
    }
  }
  throw new AiError("AI 返回的内容格式不对", "parse");
}

export async function listModels(): Promise<string[]> {
  const { cfg, key } = await prepare();
  const res = await doFetch(cfg.baseUrl.replace(/\/$/, "") + "/models", { headers: { Authorization: "Bearer " + key } });
  if (!res.ok) throw new AiError(`DeepSeek 返回 ${res.status}`, "http");
  const j = await res.json();
  return (j.data ?? []).map((m: any) => m.id);
}

export function errText(e: unknown): string {
  return e instanceof AiError ? e.message : "出错了：" + ((e as any)?.message || String(e));
}
