import { useEffect, useState } from "react";
import { useStore } from "../lib/store";
import * as repo from "../lib/repo";
import { Empty } from "../components/ui";

export default function Library() {
  const works = useStore((s) => s.works);
  const openWork = useStore((s) => s.openWork);
  const removeWork = useStore((s) => s.removeWork);
  const go = useStore((s) => s.go);
  const [stats, setStats] = useState<Record<string, { words: number; chapters: number }>>({});

  useEffect(() => {
    (async () => {
      const out: typeof stats = {};
      for (const w of works) {
        const ts = await repo.allTexts(w.id);
        out[w.id] = { words: ts.reduce((a, t) => a + t.words, 0), chapters: ts.filter((t) => t.words > 0).length };
      }
      setStats(out);
    })();
  }, [works]);

  return (
    <section className="view">
      <div className="lib-head">
        <h2>我的作品</h2>
        <button className="btn primary" type="button" onClick={() => go("new")}>
          新建作品
        </button>
      </div>
      {!works.length && (
        <div className="panel" style={{ maxWidth: 560 }}>
          <Empty>还没有作品。点「新建作品」，先填书名和简介，再搭写作风格。所有内容只存在这台电脑上。</Empty>
        </div>
      )}
      <div className="works">
        {works.map((w) => (
          <article key={w.id} className="work-card">
            <h3>{w.name}</h3>
            <p>{w.intro || "（没有简介）"}</p>
            <div className="meta">
              {(stats[w.id]?.words ?? 0).toLocaleString()} 字 · {stats[w.id]?.chapters ?? 0} 章有正文 · 日更 {w.goal} 字 · 最近修改 {new Date(w.updated).toLocaleDateString()}
            </div>
            <div className="addrow">
              <button className="btn primary" type="button" onClick={() => openWork(w.id, "write")}>
                继续写
              </button>
              <button className="btn" type="button" onClick={() => openWork(w.id, "outline")}>
                大纲
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  if (confirm(`删除《${w.name}》？正文、大纲、人物和记忆都会删掉，不能恢复。`)) removeWork(w.id);
                }}
              >
                删除
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
