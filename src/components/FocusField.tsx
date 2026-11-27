// 本章写作重点：章卡和写作页右栏共用。文本框 + 可自定义的常用重点 + 和写作限制的冲突提示。
import { useEffect, useState } from "react";
import { useStore } from "../lib/store";
import { useSetting } from "../lib/hooks";
import { addChip, chipOn, cleanChips, DEFAULT_FOCUS_CHIPS, FOCUS_CHIPS_KEY, newChip, removeChip, type FocusChip } from "../lib/focus";
import { levelName, noteConflicts } from "../lib/limits";
import { Area } from "./ui";

export const FOCUS_PLACEHOLDER = "例如：重点写主角出手后的压迫感，交手写细，围观者的反应多给笔墨；收尾那段简单带过";

/** 写作重点和写作限制撞上时的提示：生成时以限制为准 */
export function FocusConflicts({ focus }: { focus: string }) {
  const limits = useStore((s) => s.style.limits);
  const cs = noteConflicts(focus, limits);
  if (!cs.length) return null;
  return (
    <>
      {cs.map((l) => (
        <div className="note-conflict" key={l.id}>
          和写作限制 <b>「{l.text}」</b>（{levelName(l.level)}）可能冲突，生成时以限制为准。真要写，可以到「风格与限制」里暂停这条或让它只管别的卷。
        </div>
      ))}
    </>
  );
}

export function FocusField({ value, onChange, compact }: { value: string; onChange: (v: string) => void; compact?: boolean }) {
  const [raw, setRaw] = useSetting<FocusChip[]>(FOCUS_CHIPS_KEY, DEFAULT_FOCUS_CHIPS);
  const chips = cleanChips(raw);
  const [editing, setEditing] = useState(false);
  return (
    <div className="focus-fld">
      <Area value={value} onChange={onChange} rows={compact ? 2 : 2} placeholder={FOCUS_PLACEHOLDER} label="写作重点" />
      <div className="focus-chips" role="group" aria-label="常用重点">
        {chips.map((c) => {
          const on = chipOn(value, c);
          return (
            <button key={c.id} type="button" className={"fchip" + (on ? " on" : "")} aria-pressed={on} title={c.text} onClick={() => onChange(on ? removeChip(value, c) : addChip(value, c))}>
              {c.label}
            </button>
          );
        })}
        <button type="button" className="fchip edit" onClick={() => setEditing(!editing)} aria-expanded={editing} title="增删改这些常用重点，所有作品通用">
          {editing ? "收起" : chips.length ? "自定义…" : "加常用重点…"}
        </button>
      </div>
      {editing && <ChipEditor chips={chips} save={(v) => setRaw(v)} />}
      <FocusConflicts focus={value} />
    </div>
  );
}

/** 编辑常用重点：按钮上的名字 + 点了以后插进去的那句写法 */
function ChipEditor({ chips, save }: { chips: FocusChip[]; save: (v: FocusChip[]) => void }) {
  const [list, setList] = useState<FocusChip[]>(chips);
  // 别处（另一个章卡、写作页）改过后同步过来
  useEffect(() => setList(chips), [JSON.stringify(chips)]);
  const put = (v: FocusChip[]) => {
    setList(v);
    save(v);
  };
  const set = (i: number, k: "label" | "text", v: string) => {
    const n = list.map((c, j) => (j === i ? { ...c, [k]: v } : c));
    setList(n);
    // 名字为空的先不存，免得打字到一半那一项消失
    if (n[i].label.trim()) save(n);
  };
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const n = [...list];
    [n[i], n[j]] = [n[j], n[i]];
    put(n);
  };
  return (
    <div className="focus-edit">
      <p className="hint">按钮上显示名字，点了会把右边那句写法加进写作重点。所有作品通用。</p>
      {list.map((c, i) => (
        <div className="row" key={c.id}>
          <input value={c.label} placeholder="名字" aria-label={`第${i + 1}个常用重点的名字`} onChange={(e) => set(i, "label", e.target.value)} />
          <input value={c.text} placeholder="点了以后加进去的写法" aria-label={`第${i + 1}个常用重点的写法`} onChange={(e) => set(i, "text", e.target.value)} />
          <button type="button" className="btn sm" title="上移" aria-label="上移" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
          <button type="button" className="btn sm" title="下移" aria-label="下移" disabled={i === list.length - 1} onClick={() => move(i, 1)}>↓</button>
          <button type="button" className="btn sm" title="删除" aria-label="删除" onClick={() => put(list.filter((_, j) => j !== i))}>删</button>
        </div>
      ))}
      <div className="acts">
        <button type="button" className="btn sm" onClick={() => setList([...list, newChip()])}>
          加一个
        </button>
        <button type="button" className="btn sm" onClick={() => put(DEFAULT_FOCUS_CHIPS)} title="换回自带的 8 个">
          恢复默认
        </button>
      </div>
    </div>
  );
}
