// 人物卡上的「写作限制」：这个人被放宽或被收紧的条目，和「风格与限制」页是同一份数据
import { useStore, toast } from "../lib/store";
import { levelName } from "../lib/limits";
import type { WriteLimit } from "../lib/types";

type Rel = "all" | "except" | "only";

function relOf(l: WriteLimit, name: string): Rel {
  const w = l.who;
  if (!w || w.mode === "all" || !w.names.includes(name)) return "all";
  return w.mode;
}

export default function CharLimits({ name }: { name: string }) {
  const limits = useStore((s) => s.style.limits ?? []);
  const edit = useStore((s) => s.edit);
  const n = name.trim();
  if (!n) return <p className="legend">起了名字以后，可以在这里给他放宽或收紧写作限制。</p>;
  const on = limits.filter((l) => !l.off);
  if (!on.length)
    return (
      <p className="legend">
        这本书还没有写作限制。到「风格与限制 → 写作限制」里加，例如「不要文绉绉的词」，再回来给爱装腔的人物放宽。
      </p>
    );
  function setRel(l: WriteLimit, rel: Rel) {
    const w = l.who ?? { mode: "all" as const, names: [], span: "dialog" as const };
    const others = w.names.filter((x) => x !== n);
    if (rel !== "all" && w.mode !== "all" && w.mode !== rel && others.length) {
      toast(`「${l.text}」已经${w.mode === "only" ? "只管" : "放宽了"}${others.join("、")}，一条限制不能同时放宽和收紧，到「风格与限制」页里改`);
      return;
    }
    const names = rel === "all" ? others : [...others, n];
    const mode = rel === "all" ? (names.length ? w.mode : "all") : rel;
    edit("style", (d) => {
      const x = d.limits?.find((y) => y.id === l.id);
      if (x) x.who = { ...w, mode, names } as any;
    });
  }
  return (
    <ul className="scan-list char-lim">
      {on.map((l) => {
        const r = relOf(l, n);
        return (
          <li key={l.id}>
            <span>
              {l.text} <span className="chip">{levelName(l.level)}</span>
            </span>
            <select value={r} aria-label={`「${l.text}」对${n}`} onChange={(e) => setRel(l, e.target.value as Rel)}>
              <option value="all">照常</option>
              <option value="except">给他放宽（他的对白可以用）</option>
              <option value="only">只管他</option>
            </select>
          </li>
        );
      })}
    </ul>
  );
}
