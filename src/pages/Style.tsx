import { useStore } from "../lib/store";
import StyleBuilder from "../components/StyleBuilder";

export default function Style() {
  const style = useStore((s) => s.style);
  const edit = useStore((s) => s.edit);
  const work = useStore((s) => s.work)!;
  const save = useStore((s) => s.saveWorkInfo);
  return (
    <section id="style" className="view">
      <div className="panel" style={{ marginBottom: 16 }}>
        <div className="meta-row">
          <label>
            书名
            <input value={work.name} onChange={(e) => save({ name: e.target.value })} />
          </label>
          <label>
            日更目标（字）
            <input type="number" min={100} step={100} value={work.goal} onChange={(e) => save({ goal: +e.target.value })} />
          </label>
          <label>
            每章大约（字）
            <input type="number" min={500} step={100} value={work.chapWords} onChange={(e) => save({ chapWords: +e.target.value })} />
          </label>
        </div>
        <label className="meta-col">
          一句话简介
          <textarea rows={2} value={work.intro} onChange={(e) => save({ intro: e.target.value })} />
        </label>
      </div>
      <StyleBuilder value={style} onChange={(v) => edit("style", () => v)} />
    </section>
  );
}
