import DiffMatchPatch from "diff-match-patch";

/** 按字比较两段文字：-1 删掉的，1 新加的，0 不变 */
export function diffText(from: string, to: string): [number, string][] {
  const d = new DiffMatchPatch();
  d.Diff_Timeout = 2;
  const out = d.diff_main(from, to);
  d.diff_cleanupSemantic(out);
  return out.map(([op, t]) => [op, t]);
}

/** 润色、改写这类替换的结果和原文比：same 表示除了空白一个字都没改，n 是改动的处数 */
export function changeOf(orig: string, next: string): { same: boolean; n: number; parts: [number, string][] } {
  const squash = (s: string) => s.replace(/\s+/g, "");
  if (squash(orig) === squash(next)) return { same: true, n: 0, parts: [[0, next]] };
  const parts = diffText(orig.trim(), next.trim());
  let n = 0;
  let inChange = false;
  for (const [op, t] of parts) {
    // 只差空白的片段不算一处改动
    const real = op !== 0 && t.replace(/\s+/g, "") !== "";
    if (real && !inChange) n++;
    inChange = op !== 0 ? inChange || real : false;
  }
  return { same: false, n, parts };
}
