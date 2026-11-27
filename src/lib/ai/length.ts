/**
 * AI 生成正文的字数控制。
 * 模型数不准汉字，“约 N 字”只是参考，所以分三层：
 * 1. 提示词给区间和段数参考（lenSpec）；
 * 2. 流式输出时数字数，超过上限就在下一个句末停下（capped）；
 * 3. 写完不到目标的 85%，带着已写的内容让它接着补（writeToTarget）。
 */
import { chat, AiError, type ChatOpts, type Msg } from "./client";
import { countWords } from "../util";

/** 续写的三档长度 */
export const CONT_LENS = [
  { k: "短", n: 300 },
  { k: "中", n: 800 },
  { k: "长", n: 1500 },
] as const;
export const DEFAULT_CONT_LEN = 300;

/** 不足这个比例就自动补写 */
export const SHORT_RATIO = 0.85;

/** 写进提示词的字数要求 */
export function lenSpec(n: number): string {
  const lo = Math.round(n * 0.9);
  const hi = Math.round(n * 1.1);
  const paras = n >= 600 ? `，篇幅参考：大约 ${Math.max(3, Math.round(n / 120))} 个自然段` : "";
  return `约 ${n} 字（${lo}–${hi} 字之间${paras}）。字数是硬性要求：内容不够就把动作、神态、对白和细节写足，不要提前收尾；快到字数就收住`;
}

/** 流式输出的上限：目标的 1.25 倍，短的至少多给 150 字 */
export function capOf(target: number): number {
  return Math.round(Math.max(target * 1.25, target + 150));
}

/** 句末：句号、问号、叹号、省略号，后面可以跟着引号、括号 */
const END = /[。！？!?…][”’」』）)]*/g;

/**
 * 在 text 里找到 from 之后的第一个句末，返回句末后的位置；没有返回 -1
 */
export function sentenceEndAfter(text: string, from: number): number {
  END.lastIndex = Math.max(0, from);
  const m = END.exec(text);
  return m ? m.index + m[0].length : -1;
}

/** 截到最后一个完整的句子；一个句末都没有就原样返回 */
export function trimToSentence(text: string): string {
  let last = -1;
  END.lastIndex = 0;
  for (let m = END.exec(text); m; m = END.exec(text)) last = m.index + m[0].length;
  return last > 0 ? text.slice(0, last) : text;
}

/**
 * 包一层 onDelta：数字数，到 max 后在下一个句末掐断。
 * 被掐断时 aborted() 为 true，text() 是截好的完整内容。
 */
export function capped(max: number, onDelta: (t: string) => void, outer?: AbortSignal) {
  const ctl = new AbortController();
  const stop = () => ctl.abort();
  if (outer?.aborted) ctl.abort();
  else outer?.addEventListener("abort", stop, { once: true });
  let text = "";
  let cut = false;
  let words = 0;
  const feed = (d: string) => {
    if (cut) return;
    const start = text.length;
    text += d;
    words += countWords(d);
    if (words < max) return onDelta(d);
    // 到上限了：本段里有句末就停在那里；实在太长（多出三成还没句末）就截到上一个句末
    const end = sentenceEndAfter(text, start);
    if (end > 0 || words > max * 1.3) {
      const keep = end > 0 ? text.slice(0, end) : trimToSentence(text.slice(0, start)) || text;
      if (keep.length > start) onDelta(keep.slice(start));
      text = keep;
      cut = true;
      ctl.abort();
      return;
    }
    onDelta(d);
  };
  return {
    signal: ctl.signal,
    onDelta: feed,
    text: () => text,
    /** 是我们按字数掐断的（不是作者点了停止） */
    cut: () => cut && !outer?.aborted,
    done: () => outer?.removeEventListener("abort", stop),
  };
}

/** 跑一次流式生成，超过 max 就在句末停下；返回生成的文字 */
async function runCapped(messages: Msg[], max: number, o: ChatOpts & { onDelta: (t: string) => void }): Promise<string> {
  const cap = capped(max, o.onDelta, o.signal);
  try {
    const res = await chat(messages, { ...o, signal: cap.signal, onDelta: cap.onDelta });
    return res.content;
  } catch (e) {
    if (cap.cut() && e instanceof AiError && e.code === "abort") return cap.text();
    throw e;
  } finally {
    cap.done();
  }
}

export interface TargetOpts extends ChatOpts {
  onDelta: (t: string) => void;
  /** 最多自动补写几轮 */
  rounds?: number;
  /** 开始补写第 n 轮时回调，用来在界面上提示 */
  onTopUp?: (n: number, have: number) => void;
}

/**
 * 按目标字数生成：超了在句末停，不够就带着已写的接着补，最多补 rounds 轮。
 * 补写的内容另起一段，接在已有结果后面（onDelta 也会先收到段落分隔）。
 */
export async function writeToTarget(messages: Msg[], target: number, o: TargetOpts): Promise<string> {
  const max = capOf(target);
  let text = (await runCapped(messages, max, o)).trim();
  const rounds = o.rounds ?? 2;
  for (let i = 1; i <= rounds; i++) {
    if (o.signal?.aborted) break;
    const have = countWords(text);
    if (have >= target * SHORT_RATIO) break;
    const left = target - have;
    o.onTopUp?.(i, have);
    o.onDelta("\n\n");
    const more = (
      await runCapped(
        [
          ...messages,
          { role: "assistant", content: text },
          {
            role: "user",
            content: `上面写了约 ${have} 字，要求是约 ${target} 字，还差约 ${left} 字。从上面最后一句另起一段接着往下写约 ${left} 字：仍然只写这一次要求的范围，把还没展开的动作、对白、神态和细节写足；不要重复上面已经写过的内容，不要写到后面的情节，不要收尾总结。直接输出接下来的正文，不加任何说明。`,
          },
        ],
        max - have,
        o,
      )
    ).trim();
    // 模型认为写完了、只挤出一点点：不再硬补
    if (!more) break;
    text += "\n\n" + more;
    if (countWords(more) < 50) break;
  }
  return text;
}
