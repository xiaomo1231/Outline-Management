export function uid(prefix = ""): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** 本地日期 YYYY-MM-DD */
export function today(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 中文小说的字数口径：每个汉字、全角标点算 1，连续的拉丁字母或数字算 1 个词。
 * 空白不计。
 */
export function countWords(text: string): number {
  const cjk = text.match(/[　-〿㐀-䶿一-鿿豈-﫿＀-￯]/g)?.length ?? 0;
  const latin = text.replace(/[　-〿㐀-䶿一-鿿豈-﫿＀-￯]/g, " ").match(/[A-Za-z0-9]+/g)?.length ?? 0;
  return cjk + latin;
}

export function htmlToText(html: string): string {
  const d = document.createElement("div");
  d.innerHTML = html.replace(/<\/p>/g, "</p>\n");
  return (d.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
}

export function debounce<T extends (...a: any[]) => any>(fn: T, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  let waiting = false;
  const f = (...a: Parameters<T>) => {
    clearTimeout(t);
    waiting = true;
    t = setTimeout(() => {
      waiting = false;
      fn(...a);
    }, ms);
  };
  /** 立刻执行（不管有没有排着的），返回 fn 的结果 */
  f.flush = (...a: Parameters<T>): ReturnType<T> => {
    clearTimeout(t);
    waiting = false;
    return fn(...a);
  };
  /** 有没有排队等执行的调用 */
  f.pending = () => waiting;
  f.cancel = () => {
    clearTimeout(t);
    waiting = false;
  };
  return f;
}

export function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

/** "第12章 标题" → 12 */
export function chapterNo(title: string): number {
  const m = /^第(\d+)章/.exec(title);
  return m ? +m[1] : 0;
}

const p2 = (n: number) => String(n).padStart(2, "0");
/** 统一 24 小时制：2026-11-17 21:05 */
export function fmtTime(at: number | Date): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
/** 只要时分：21:05 */
export function fmtHM(at: number | Date): string {
  const d = new Date(at);
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

const CN = "零一二三四五六七八九";
/** 1→一，12→十二，25→二十五，105→一百零五 */
export function cnNum(n: number): string {
  if (n <= 0 || n >= 10000 || !Number.isInteger(n)) return String(n);
  const units = ["", "十", "百", "千"];
  const ds = String(n).split("").map(Number);
  let out = "";
  let zero = false;
  ds.forEach((d, i) => {
    const u = units[ds.length - 1 - i];
    if (d === 0) zero = !!out;
    else {
      if (zero) out += "零";
      zero = false;
      out += CN[d] + u;
    }
  });
  return out.replace(/^一十/, "十");
}
