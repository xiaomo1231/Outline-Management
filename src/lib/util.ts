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

export function debounce<T extends (...a: any[]) => void>(fn: T, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  const f = (...a: Parameters<T>) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
  f.flush = (...a: Parameters<T>) => {
    clearTimeout(t);
    fn(...a);
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
