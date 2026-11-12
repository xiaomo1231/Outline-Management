import DiffMatchPatch from "diff-match-patch";

/** 按字比较两段文字：-1 删掉的，1 新加的，0 不变 */
export function diffText(from: string, to: string): [number, string][] {
  const d = new DiffMatchPatch();
  d.Diff_Timeout = 2;
  const out = d.diff_main(from, to);
  d.diff_cleanupSemantic(out);
  return out.map(([op, t]) => [op, t]);
}
