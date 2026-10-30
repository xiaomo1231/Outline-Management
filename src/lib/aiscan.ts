// 常见的“AI 腔”套话。只做提示，作者自己决定改不改。
export const PATTERNS: { re: RegExp; label: string }[] = [
  { re: /不是[^。，！？]{1,14}而是/g, label: "不是……而是……" },
  { re: /仿佛[^。！？]{0,16}(一般|似的)/g, label: "仿佛……一般" },
  { re: /嘴角(勾起|扬起|微微上扬)/g, label: "嘴角勾起" },
  { re: /一抹/g, label: "一抹" },
  { re: /眼中闪过一丝/g, label: "眼中闪过一丝" },
  { re: /深吸一口气/g, label: "深吸一口气" },
  { re: /这一刻/g, label: "这一刻" },
  { re: /空气(仿佛)?(凝固|安静)/g, label: "空气凝固" },
  { re: /不易察觉的/g, label: "不易察觉的" },
  { re: /五味杂陈/g, label: "五味杂陈" },
  { re: /(他|她)感到(愤怒|悲伤|震惊|害怕)/g, label: "情绪直说" },
  { re: /心中一(动|凛|紧)/g, label: "心中一动" },
  { re: /(缓缓|淡淡|微微)地?(说|开口|道)/g, label: "缓缓说道" },
  { re: /时间仿佛(静止|停止)/g, label: "时间静止" },
];

export function scan(text: string) {
  const rows: { label: string; n: number }[] = [];
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    const n = text.match(p.re)?.length ?? 0;
    if (n) rows.push({ label: p.label, n });
  }
  return rows;
}

/** 句子长度序列，用来画节奏条 */
export function sentenceLengths(text: string): number[] {
  return text
    .split(/[。！？!?…\n]+/)
    .map((s) => s.replace(/\s/g, "").length)
    .filter((n) => n > 0);
}
