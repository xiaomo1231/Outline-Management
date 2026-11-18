import { useEffect, useState } from "react";
import { useStore } from "../lib/store";
import * as repo from "../lib/repo";
import { AsyncButton, Empty } from "../components/ui";
import { createFromTxt, importPackFile, pickTxtBook, type TxtPick } from "./DataPanels";
import { allChapters } from "../lib/outline";
import { countWords } from "../lib/util";
import type { Volume } from "../lib/types";

/** 「3 天前」「今天」 */
function ago(t: number): string {
  const d = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(t).setHours(0, 0, 0, 0)) / 86400000);
  return d <= 0 ? "今天" : d === 1 ? "昨天" : `${d} 天前`;
}

export default function Library() {
  const works = useStore((s) => s.works);
  const openWork = useStore((s) => s.openWork);
  const removeWork = useStore((s) => s.removeWork);
  const go = useStore((s) => s.go);
  const [stats, setStats] = useState<Record<string, { words: number; chapters: number; last?: string }>>({});
  const [txt, setTxt] = useState<TxtPick | null>(null);

  useEffect(() => {
    (async () => {
      const out: typeof stats = {};
      for (const w of works) {
        const ts = await repo.allTexts(w.id);
        const vols = await repo.loadDoc<Volume[]>(w.id, "outline", []);
        const lastId = await repo.getSetting<string | null>("lastChapter:" + w.id, null);
        const chs = allChapters(vols);
        // 上次打开的章；没有记录就取最后一章有字的
        const withText = new Set(ts.filter((t) => t.words > 0).map((t) => t.id));
        const r = chs.find((x) => x.ch.id === lastId) ?? [...chs].reverse().find((x) => withText.has(x.ch.id));
        out[w.id] = { words: ts.reduce((a, t) => a + t.words, 0), chapters: withText.size, last: r ? `上次写到第 ${r.no} 章${r.ch.title ? "「" + r.ch.title + "」" : ""}` : undefined };
      }
      setStats(out);
    })();
  }, [works]);

  // 开头那段导入成「引子」时，它占第 1 章
  const restCh = txt?.restAsChapter && txt.rest.trim() ? 1 : 0;

  return (
    <section className="view">
      <div className="lib-head">
        <h2>我的作品</h2>
        <span className="addrow" style={{ margin: 0 }}>
          <AsyncButton
            onClick={async () => {
              const p = await pickTxtBook();
              if (p) setTxt(p);
            }}
          >
            导入 TXT 成书
          </AsyncButton>
          <AsyncButton
            onClick={async () => {
              const id = await importPackFile();
              if (id) await openWork(id, "write");
            }}
          >
            导入作品包
          </AsyncButton>
          <button className="btn primary" type="button" onClick={() => go("new")}>
            新建作品
          </button>
        </span>
      </div>
      {txt && (
        <div className="panel txt-pre" style={{ maxWidth: 760, marginBottom: 12 }}>
          <h3>导入预览</h3>
          <div className="meta-row">
            <label>
              书名
              <input value={txt.name} placeholder="没认出书名，填一个" onChange={(e) => setTxt({ ...txt, name: e.target.value })} />
            </label>
            {txt.author && (
              <label>
                作者
                <input value={txt.author} readOnly />
              </label>
            )}
          </div>
          <label className="meta-col">
            简介
            <textarea rows={2} value={txt.intro} onChange={(e) => setTxt({ ...txt, intro: e.target.value })} />
          </label>
          <p className="legend">
            认出 {txt.book.vols.length} 卷、{txt.book.vols.reduce((a, v) => a + v.chapters.length, 0)} 章，共 {txt.book.vols.reduce((a, v) => a + v.chapters.reduce((b, c) => b + countWords(c.text), 0), 0).toLocaleString()} 字。章节是按「第X章」这样的标题切的，切得不对可以导入后在大纲里调。
          </p>
          {txt.rest.trim() && (
            <label className="legend">
              <input type="checkbox" checked={txt.restAsChapter} onChange={(e) => setTxt({ ...txt, restAsChapter: e.target.checked })} /> 第一章前面还有 {countWords(txt.rest).toLocaleString()} 字没归到任何章（现在只拿来当简介，简介最多 300 字）。勾上就把这段也导入成开头一章「引子」。
            </label>
          )}
          <div className="txt-chs">
            {txt.book.vols.map((v, vi) => (
              <div key={vi}>
                <b>{v.title}</b>
                {/* 和导入后一样全书连续编号 */}
                <ol start={1 + (vi > 0 ? restCh : 0) + txt.book.vols.slice(0, vi).reduce((a, x) => a + x.chapters.length, 0)}>
                  {vi === 0 && restCh > 0 && (
                    <li>
                      引子 <small>{countWords(txt.rest).toLocaleString()} 字</small>
                    </li>
                  )}
                  {v.chapters.slice(0, 200).map((c, ci) => (
                    <li key={ci}>
                      {c.title || "（无题）"} <small>{countWords(c.text).toLocaleString()} 字</small>
                    </li>
                  ))}
                  {v.chapters.length > 200 && <li>……还有 {v.chapters.length - 200} 章</li>}
                </ol>
              </div>
            ))}
          </div>
          <div className="addrow">
            <AsyncButton primary onClick={async () => { const id = await createFromTxt(txt); setTxt(null); await openWork(id, "write"); }}>
              导入，接着写最后一章
            </AsyncButton>
            <AsyncButton onClick={async () => { const id = await createFromTxt(txt); setTxt(null); await openWork(id, "outline"); }}>
              导入，先看大纲
            </AsyncButton>
            <button className="btn" type="button" onClick={() => setTxt(null)}>
              取消
            </button>
          </div>
        </div>
      )}
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
              {stats[w.id]?.last ? <b className="last">{stats[w.id]!.last} · {ago(w.updated)}</b> : <b className="last">还没开始写 · {ago(w.created)}建的</b>}
              <br />
              {(stats[w.id]?.words ?? 0).toLocaleString()} 字 · {stats[w.id]?.chapters ?? 0} 章有正文 · 日更 {w.goal} 字
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
                  if (confirm(`删除《${w.name}》？整本书会放进回收站，30 天内可以在「设置 → 回收站」恢复。`)) removeWork(w.id);
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
