import { useEffect, useState, type InputHTMLAttributes } from "react";
import { useStore } from "../lib/store";
import * as repo from "../lib/repo";
import * as T from "../lib/ai/tasks";
import { atOf, type Ctx } from "../lib/ai/context";
import { allChapters } from "../lib/outline";
import { namesOf } from "../lib/mention";
import { newLimit, scanLimits } from "../lib/limits";
import StyleBuilder from "../components/StyleBuilder";
import LimitsPanel from "../components/LimitsPanel";
import { Seg } from "../components/ui";

export default function Style() {
  const style = useStore((s) => s.style);
  const edit = useStore((s) => s.edit);
  const work = useStore((s) => s.work)!;
  const save = useStore((s) => s.saveWorkInfo);
  const tab = useStore((s) => s.styleTab);
  const chars = useStore((s) => s.chars);
  const names = chars.map((c) => c.name.trim()).filter(Boolean);
  const vols = useStore((s) => s.vols);
  const counts = useBookCounts(tab === "limits");
  return (
    <section id="style" className="view">
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="meta-row">
          <label>
            书名
            <InfoInput value={work.name} ok={(v) => !!v.trim()} fix={() => "未命名作品"} save={(v) => save({ name: v })} />
          </label>
          <label>
            日更目标（字）
            <InfoInput type="number" min={100} step={100} value={work.goal} ok={(v) => +v >= 100} fix={(v) => String(Math.max(100, +v || 2000))} save={(v) => save({ goal: +v })} />
          </label>
          <label>
            每章大约（字）
            <InfoInput type="number" min={500} step={100} value={work.chapWords} ok={(v) => +v >= 500} fix={(v) => String(Math.max(500, +v || 2500))} save={(v) => save({ chapWords: +v })} />
          </label>
        </div>
        <label className="meta-col">
          一句话简介
          <textarea rows={2} value={work.intro} onChange={(e) => save({ intro: e.target.value })} />
        </label>
      </div>
      <Seg<"style" | "limits">
        label="风格与限制"
        value={tab}
        options={[
          ["style", "风格"],
          ["limits", `写作限制（${(style.limits ?? []).filter((l) => !l.off).length}）`],
        ]}
        onChange={(v) => useStore.setState({ styleTab: v })}
        style={{ maxWidth: 360 }}
      />
      {tab === "limits" ? (
        <LimitsPanel
          value={style.limits ?? []}
          names={names}
          onChange={(v) => edit("style", (d) => void (d.limits = v as any))}
          vols={vols.map((v) => ({ id: v.id, title: v.title }))}
          genWords={(l) => T.suggestLimitWords(ctx(), l)}
          counts={counts}
          rules={style.rules}
          moveRules={(lines) =>
            edit("style", (d) => {
              d.rules = d.rules
                .split("\n")
                .filter((x) => !lines.includes(x.trim()))
                .join("\n");
              d.limits = [...(d.limits ?? []), ...lines.map((x) => newLimit(x))] as any;
            })
          }
        />
      ) : (
        <StyleBuilder value={style} onChange={(v) => edit("style", () => v)} />
      )}
    </section>
  );
}

/**
 * 书名、日更、每章字数：合格的值边打边存；离开输入框时不合格的改成合格值再存
 * （和新建作品一样：书名为空用「未命名作品」，日更至少 100，每章至少 500）
 */
function InfoInput({ value, ok, fix, save, ...rest }: { value: string | number; ok: (v: string) => boolean; fix: (v: string) => string; save: (v: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onBlur">) {
  const [t, setT] = useState(String(value));
  useEffect(() => setT(String(value)), [value]);
  return (
    <input
      {...rest}
      value={t}
      onChange={(e) => {
        setT(e.target.value);
        if (ok(e.target.value)) save(e.target.value);
      }}
      onBlur={() => {
        if (ok(t)) return;
        const v = fix(t);
        setT(v);
        save(v);
      }}
    />
  );
}

function ctx(): Ctx {
  const s = useStore.getState();
  return { work: s.work!, vols: s.vols, chars: s.chars, events: s.events, plan: s.plan, style: s.style, calls: s.calls, changesets: s.changesets };
}

/** 全书正文按每条限制扫一遍，数违反的次数（按每章所在的卷和人物筛选） */
function useBookCounts(on: boolean): Record<string, number> | undefined {
  const work = useStore((s) => s.work);
  const limits = useStore((s) => s.style.limits);
  const vols = useStore((s) => s.vols);
  const chars = useStore((s) => s.chars);
  const [counts, setCounts] = useState<Record<string, number>>();
  useEffect(() => {
    if (!on || !work) return;
    let alive = true;
    const t = setTimeout(async () => {
      const texts = new Map((await repo.allTexts(work.id)).map((x) => [x.id, x.plain ?? ""]));
      const people = chars.filter((c) => c.name.trim()).map((c) => ({ name: c.name.trim(), names: namesOf(c) }));
      const out: Record<string, number> = Object.fromEntries((limits ?? []).filter((l) => l.words.length).map((l) => [l.id, 0]));
      for (const r of allChapters(vols)) {
        const plain = texts.get(r.ch.id);
        if (!plain) continue;
        const povs = [...new Set(r.ch.scenes.map((s) => s.pov).filter(Boolean))] as string[];
        const res = scanLimits(plain, limits, { at: atOf({ vols, chars }, r), people, pov: povs.length === 1 ? povs[0] : undefined });
        for (const h of res.hits) out[h.id] = (out[h.id] ?? 0) + 1;
      }
      if (alive) setCounts(out);
    }, 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [on, work, limits, vols, chars]);
  return counts;
}
