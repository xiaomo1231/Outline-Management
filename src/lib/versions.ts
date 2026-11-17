// 章节版本历史的规则：什么时候留快照、留多久。只有纯函数，方便测试。

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** 距上一份快照多久、字数变化多少，就再留一份 */
export const SNAP_EVERY = 10 * MIN;
export const SNAP_WORDS = 500;

export interface SnapMeta {
  at: number;
  words: number;
  html: string;
}

/** 自动保存时要不要顺手留一份快照 */
export function needSnapshot(last: SnapMeta | null, now: number, cur: { words: number; html: string }): boolean {
  if (!cur.words) return false;
  if (!last) return true;
  if (last.html === cur.html) return false;
  if (now - last.at >= SNAP_EVERY) return true;
  return Math.abs(cur.words - last.words) >= SNAP_WORDS;
}

/** 一章原来不少于 500 字，这次少了一半以上（含变空），就算字数骤降 */
export function isShrink(oldWords: number, newWords: number): boolean {
  return oldWords >= 500 && newWords < oldWords * 0.5;
}

/**
 * 保留规则：24 小时内全留；7 天内每小时留最新一份；30 天内每天一份；更早的每周一份。
 * 返回要保留的 id。
 */
export function keepVersions(list: { id: string; at: number }[], now: number): Set<string> {
  const keep = new Set<string>();
  const seen = new Set<string>();
  const sorted = [...list].sort((a, b) => b.at - a.at);
  for (const v of sorted) {
    const age = now - v.at;
    let bucket: string;
    if (age < DAY) {
      keep.add(v.id);
      continue;
    } else if (age < 7 * DAY) bucket = "h" + Math.floor(v.at / HOUR);
    else if (age < 30 * DAY) bucket = "d" + Math.floor(v.at / DAY);
    else bucket = "w" + Math.floor(v.at / (7 * DAY));
    if (seen.has(bucket)) continue;
    seen.add(bucket);
    keep.add(v.id);
  }
  return keep;
}

/** 数据库备份文件名里的时间：moshu-2026-11-12-1762981234567.db */
export function backupTime(name: string): number | null {
  const m = /^moshu-\d{4}-\d{2}-\d{2}-(\d+)\.db$/.exec(name);
  return m ? +m[1] : null;
}

/** 数据库备份保留规则：最近 24 份全留，另外 14 天里每天留最新一份 */
export function backupsToKeep(names: string[]): Set<string> {
  const rows = names.map((n) => ({ n, t: backupTime(n) })).filter((x): x is { n: string; t: number } => x.t != null);
  rows.sort((a, b) => b.t - a.t);
  const keep = new Set(rows.slice(0, 24).map((x) => x.n));
  const days = new Set<string>();
  for (const r of rows) {
    const d = r.n.slice(6, 16);
    if (days.has(d)) continue;
    if (days.size >= 14) break;
    days.add(d);
    keep.add(r.n);
  }
  return keep;
}
