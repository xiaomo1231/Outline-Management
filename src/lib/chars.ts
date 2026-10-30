import { GROUPS, fieldDef, fieldLabel, SIMPLE } from "./charFields";
import type { Character, CallEntry, Volume } from "./types";
import { allChapters, findChapter } from "./outline";

/** 人物在第 no 章时的状态：初始卡加上这一章及之前已生效的变化 */
export function snapshot(c: Character, vols: Volume[], no: number): Record<string, string> {
  const f = { ...c.f };
  const chs = allChapters(vols);
  const nOf = (id: string) => chs.find((x) => x.ch.id === id)?.no ?? 0;
  const list = (c.changes ?? []).filter((x) => x.status === "applied" && nOf(x.ch) <= no).sort((a, b) => nOf(a.ch) - nOf(b.ch) || a.at - b.at);
  for (const x of list) f[x.field] = x.to;
  return f;
}

/** 某个字段在第 no 章是否还不能写进正文 */
export function hiddenAt(c: Character, k: string, no: number): boolean {
  const d = fieldDef(k);
  if (d?.flag !== "hid") return false;
  const r = c.rev?.[k];
  if (!r || r.s === "未揭示") {
    const m = r?.ch && /\d+/.exec(r.ch);
    return !(m && +m[0] <= no);
  }
  return false;
}

/** 写成给 AI 看的人设描述。forProse 时去掉还没揭示的隐藏项 */
export function describe(c: Character, vols: Volume[], no: number, opts: { forProse?: boolean; brief?: boolean } = {}): string {
  const f = snapshot(c, vols, no);
  const lines = [`【${c.name || "（未命名）"}】${c.role}`];
  const keys = opts.brief ? SIMPLE.map((x) => x[0]) : Object.keys(f);
  for (const k of keys) {
    const v = f[k];
    if (!v) continue;
    if (opts.forProse && hiddenAt(c, k, no)) continue;
    const d = fieldDef(k);
    const flag = d?.flag === "lock" ? "（锁定，不能写出矛盾）" : d?.flag === "hid" && !opts.forProse ? `（${c.rev?.[k]?.s ?? "未揭示"}）` : "";
    lines.push(`${fieldLabel(k)}${flag}：${v}`);
  }
  const knows = (c.knows ?? []).filter((x) => !x.ch || (findChapter(vols, x.ch)?.no ?? 0) <= no);
  if (knows.length) lines.push("已经知道：" + knows.map((x) => x.secret).join("；"));
  if (c.dead && (findChapter(vols, c.dead)?.no ?? Infinity) <= no) lines.push("状态：已死亡");
  return lines.join("\n");
}

export function completion(c: Character): { done: number; all: number; groups: Record<string, [number, number]> } {
  let done = 0;
  let all = 0;
  const groups: Record<string, [number, number]> = {};
  for (const g of GROUPS) {
    const keys = [...g.fields.map((f) => f.k), ...(c.custom?.[g.id] ?? []).map((x) => x.k)];
    const d = keys.filter((k) => (c.f[k] || "").trim()).length;
    groups[g.id] = [d, keys.length];
    done += d;
    all += keys.length;
  }
  return { done, all, groups };
}

export interface RuleIssue {
  lv: "r" | "y";
  text: string;
  quote?: string;
}

/** 第一层人设检查：不调 AI。已死人物出场、称呼不符、锁定项关键词冲突 */
export function ruleCheck(text: string, chars: Character[], calls: CallEntry[], vols: Volume[], no: number): RuleIssue[] {
  const out: RuleIssue[] = [];
  for (const c of chars) {
    if (!c.name) continue;
    const deadNo = c.dead ? findChapter(vols, c.dead)?.no : undefined;
    if (deadNo && deadNo < no && text.includes(c.name)) {
      const i = text.indexOf(c.name);
      const around = text.slice(Math.max(0, i - 20), i + 30);
      if (!/(想起|记得|坟|遗|生前|死去|已故|当年)/.test(around)) out.push({ lv: "r", text: `「${c.name}」在第 ${deadNo} 章已经死亡，这里又出场了。`, quote: around });
    }
    // 锁定项：例如设定“左眉有疤”，正文写“右眉的疤”
    const look = c.f.look || "";
    const side = /(左|右)(眉|眼|手|脸|耳|臂|腿)/.exec(look);
    if (side) {
      const other = (side[1] === "左" ? "右" : "左") + side[2];
      const re = new RegExp(`${c.name}[^。]{0,20}${other}`);
      const m = re.exec(text);
      if (m) out.push({ lv: "r", text: `「${c.name}」的锁定外貌是「${look}」，这里写成了「${other}」。`, quote: m[0] });
    }
  }
  // 称呼表：在对白里用错称呼
  for (const e of calls) {
    if (!e.from || !e.to || !e.term) continue;
    const re = new RegExp(`${e.from}[^。“]{0,12}[道说问喊叫][:：，,]?“([^”]{0,40})”`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const line = m[1];
      const target = chars.find((c) => c.name === e.to);
      const aliases = [target?.name, ...(target?.f.alias || "").split(/[、，,（）()]/)].filter(Boolean) as string[];
      if (aliases.some((a) => line.startsWith(a)) && !line.includes(e.term)) out.push({ lv: "y", text: `称呼表里「${e.from}」叫「${e.to}」为「${e.term}」，这句对白用了别的叫法。`, quote: m[0] });
    }
  }
  return out;
}
