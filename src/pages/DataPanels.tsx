// 设置页里的「导出」「备份与恢复」「回收站」，以及作品库的导入。
import { useEffect, useState } from "react";
import { useStore, toast } from "../lib/store";
import * as repo from "../lib/repo";
import * as bk from "../lib/backup";
import * as trash from "../lib/trash";
import { isTauri } from "../lib/db";
import { allChapters, newChapter } from "../lib/outline";
import { buildDocx, type DocBlock } from "../lib/docx";
import { exportPack, importPack, isPack, workExists } from "../lib/pack";
import { parseBook, plainOf, textToHtml } from "../lib/importTxt";
import { decode } from "../lib/corpus";
import { countWords, uid } from "../lib/util";
import { AsyncButton, Empty } from "../components/ui";
import type { TrashItem, Volume, Work } from "../lib/types";

/* ---------- 文件读写 ---------- */

async function saveFile(name: string, data: string | Uint8Array, ext: string, label: string) {
  if (isTauri) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({ defaultPath: name, filters: [{ name: label, extensions: [ext] }] });
    if (!path) return;
    const fs = await import("@tauri-apps/plugin-fs");
    if (typeof data === "string") await fs.writeTextFile(path, data);
    else await fs.writeFile(path, data);
    toast("已导出到 " + path);
  } else {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([data as BlobPart], { type: typeof data === "string" ? "text/plain;charset=utf-8" : "application/octet-stream" }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  }
}

/** 让作者选一个文件，返回内容；取消时返回 null */
async function pickFile(exts: string[], label: string): Promise<ArrayBuffer | null> {
  if (isTauri) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({ multiple: false, filters: [{ name: label, extensions: exts }] });
    if (!path || Array.isArray(path)) return null;
    const { readFile } = await import("@tauri-apps/plugin-fs");
    const b = await readFile(path as string);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  }
  return new Promise((res) => {
    const i = document.createElement("input");
    i.type = "file";
    i.accept = exts.map((e) => "." + e).join(",");
    i.onchange = () => (i.files?.[0] ? i.files[0].arrayBuffer().then(res) : res(null));
    i.click();
  });
}

/* ---------- 导出 ---------- */

type Fmt = "txt" | "md" | "docx";

async function exportRange(fmt: Fmt, from: number, to: number) {
  const s = useStore.getState();
  if (!s.work) return;
  const rows = allChapters(s.vols).filter((r) => r.no >= from && r.no <= to);
  if (!rows.length) {
    toast("这个范围里没有章节");
    return;
  }
  const whole = from <= 1 && to >= allChapters(s.vols).length;
  const blocks: DocBlock[] = [];
  if (whole) {
    blocks.push({ kind: "title", text: s.work.name });
    if (s.work.intro) blocks.push({ kind: "p", text: s.work.intro });
  }
  let lastVol = -1;
  for (const r of rows) {
    if (whole && r.v !== lastVol) {
      lastVol = r.v;
      blocks.push({ kind: "h1", text: s.vols[r.v].title });
    }
    blocks.push({ kind: "h2", text: `第${r.no}章 ${r.ch.title}`.trim() });
    const t = await repo.loadText(r.ch.id);
    for (const p of (t?.plain ?? "").split("\n").map((x) => x.trim()).filter(Boolean)) blocks.push({ kind: "p", text: p });
  }
  const base = whole ? s.work.name : rows.length === 1 ? `${s.work.name} 第${from}章` : `${s.work.name} 第${from}-${to}章`;
  if (fmt === "docx") return saveFile(base + ".docx", buildDocx(blocks), "docx", "Word 文档");
  const text = blocks
    .map((b) => {
      if (fmt === "md") return b.kind === "title" ? `# ${b.text}` : b.kind === "h1" ? `## ${b.text}` : b.kind === "h2" ? `### ${b.text}` : b.text;
      return b.kind === "p" ? "　　" + b.text : "\n" + b.text + "\n";
    })
    .join(fmt === "md" ? "\n\n" : "\n");
  return saveFile(`${base}.${fmt}`, text, fmt, fmt.toUpperCase());
}

export function ExportPanel() {
  const vols = useStore((s) => s.vols);
  const work = useStore((s) => s.work);
  const n = allChapters(vols).length;
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(n);
  const [fmt, setFmt] = useState<Fmt>("docx");
  useEffect(() => setTo(n), [n]);
  if (!work) return null;
  return (
    <div className="panel">
      <h3>导出</h3>
      <div className="meta-row">
        <label>
          从第几章
          <input type="number" min={1} max={n} value={from} onChange={(e) => setFrom(+e.target.value)} />
        </label>
        <label>
          到第几章
          <input type="number" min={1} max={n} value={to} onChange={(e) => setTo(+e.target.value)} />
        </label>
        <label>
          格式
          <select value={fmt} onChange={(e) => setFmt(e.target.value as Fmt)}>
            <option value="docx">Word（.docx）</option>
            <option value="txt">TXT</option>
            <option value="md">Markdown</option>
          </select>
        </label>
      </div>
      <div className="addrow">
        <AsyncButton onClick={() => exportRange(fmt, Math.min(from, to), Math.max(from, to))}>导出第 {Math.min(from, to)}–{Math.max(from, to)} 章</AsyncButton>
        <AsyncButton
          onClick={async () => {
            await useStore.getState().flushSaves();
            const p = await exportPack(work);
            await saveFile(`${work.name}.moshu.json`, JSON.stringify(p), "json", "墨枢作品包");
          }}
        >
          导出作品包（换电脑用）
        </AsyncButton>
      </div>
      <p className="legend">作品包里有这本书的正文、大纲、人物、时间线、记忆、历史版本和对话，在另一台电脑的「作品库 → 导入作品包」打开。整章发文用写作页的「复制发文格式」更快。</p>
    </div>
  );
}

/* ---------- 导入 ---------- */

/** 导入 txt 成一本新书，返回作品 id */
export async function importTxtBook(): Promise<string | null> {
  const buf = await pickFile(["txt"], "TXT 小说");
  if (!buf) return null;
  const book = parseBook(decode(buf));
  const chapters = book.vols.reduce((a, v) => a + v.chapters.length, 0);
  if (!chapters) {
    toast("这个文件是空的");
    return null;
  }
  const name = prompt(`识别到 ${book.vols.length} 卷、${chapters} 章。书名叫什么？`, "导入的作品");
  if (!name) return null;
  const vols: Volume[] = [];
  const texts: { id: string; text: string }[] = [];
  for (const v of book.vols) {
    const vol: Volume = { id: uid("v"), title: v.title, chapters: [] };
    for (const c of v.chapters) {
      const ch = { ...newChapter(c.title), status: "已写" as const };
      vol.chapters.push(ch);
      texts.push({ id: ch.id, text: c.text });
    }
    vols.push(vol);
  }
  const s = useStore.getState();
  const id = await s.createWork({ name, intro: book.preface.slice(0, 300), goal: 4000, chapWords: 3000 }, { vols });
  for (const t of texts) {
    const plain = plainOf(t.text);
    await repo.saveText(id, t.id, textToHtml(t.text), plain, countWords(plain), 0);
  }
  // 导入不算今天写的字
  await (await import("../lib/db")).getDb().then((db) => db.exec(`DELETE FROM daily WHERE work_id=?`, [id]));
  toast(`已导入《${name}》：${chapters} 章`);
  return id;
}

/** 导入作品包，返回作品 id */
export async function importPackFile(): Promise<string | null> {
  const buf = await pickFile(["json"], "墨枢作品包");
  if (!buf) return null;
  let p: unknown;
  try {
    p = JSON.parse(new TextDecoder().decode(buf));
  } catch {
    toast("这不是墨枢的作品包");
    return null;
  }
  if (!isPack(p)) {
    toast("这不是墨枢的作品包");
    return null;
  }
  const ex = await workExists(p.work.id);
  if (ex && !confirm(`这台电脑上已经有《${p.work.name}》${ex.deleted ? "（在回收站里）" : ""}。用作品包（导出于 ${new Date(p.exportedAt).toLocaleString()}）整本覆盖它吗？覆盖前会先备份数据库。`)) return null;
  if (ex) {
    const r = await bk.backup();
    if (r.startsWith("备份失败")) {
      toast(r + "，没有覆盖");
      return null;
    }
  }
  const s = useStore.getState();
  if (s.work?.id === p.work.id) await s.flushSaves();
  await importPack(p);
  await s.loadWorks();
  toast(`已导入《${p.work.name}》`);
  return p.work.id;
}

/* ---------- 备份与恢复 ---------- */

export function BackupPanel() {
  const work = useStore((s) => s.work);
  const vols = useStore((s) => s.vols);
  const [list, setList] = useState<bk.BackupFile[]>([]);
  const [dir2, setDir2] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [chs, setChs] = useState<{ id: string; words: number; updated: number }[]>([]);
  const [step, setStep] = useState("");
  const load = () => bk.listBackups().then(setList);
  useEffect(() => {
    load();
    bk.getSecondDir().then(setDir2);
  }, []);
  if (!isTauri)
    return (
      <div className="panel">
        <h3>备份与恢复</h3>
        <Empty>浏览器调试版不做文件备份。</Empty>
      </div>
    );
  const titles = new Map(allChapters(vols).map((r) => [r.ch.id, `第${r.no}章 ${r.ch.title}`]));
  return (
    <div className="panel">
      <h3>备份与恢复</h3>
      <p className="legend">每天结账、关窗、写作时每 2 小时各备份一次。最近 24 份全留，另外 14 天里每天留一份。</p>
      <div className="addrow">
        <AsyncButton
          onClick={async () => {
            toast(await bk.backup());
            await load();
          }}
        >
          立即备份
        </AsyncButton>
        <AsyncButton
          onClick={async () => {
            const { open } = await import("@tauri-apps/plugin-dialog");
            const d = await open({ directory: true });
            if (!d || Array.isArray(d)) return;
            await bk.setSecondDir(d as string);
            setDir2(d as string);
            toast("以后每次备份都会复制一份到 " + d);
          }}
        >
          {dir2 ? "换第二备份目录" : "设置第二备份目录"}
        </AsyncButton>
        {dir2 && (
          <button
            className="btn"
            type="button"
            onClick={async () => {
              await bk.setSecondDir("");
              setDir2("");
            }}
          >
            不用第二备份目录
          </button>
        )}
      </div>
      {dir2 && <p className="legend">第二备份目录：{dir2}。可以选网盘的同步文件夹，复制过去的是静态文件，不会像直接同步数据库那样损坏。</p>}
      {step && <p className="legend">{step}</p>}
      {list.length ? (
        <table className="ev">
          <thead>
            <tr>
              <th>时间</th>
              <th>大小</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((b) => (
              <tr key={b.name}>
                <td className="num">{new Date(b.at).toLocaleString()}</td>
                <td className="num">{b.size != null ? (b.size / 1048576).toFixed(1) + " MB" : ""}</td>
                <td>
                  {work && (
                    <AsyncButton
                      onClick={async () => {
                        if (open === b.name) return setOpen(null);
                        setChs(await bk.chaptersInBackup(b.name, work.id));
                        setOpen(b.name);
                      }}
                    >
                      {open === b.name ? "收起" : "取回某一章"}
                    </AsyncButton>
                  )}{" "}
                  <AsyncButton
                    onClick={async () => {
                      if (!confirm(`把所有作品恢复到 ${new Date(b.at).toLocaleString()} 的样子？这之后写的内容会被替换掉（恢复前会自动备份一份现在的数据，反悔可以再恢复回来）。`)) return;
                      await useStore.getState().flushSaves();
                      try {
                        await bk.restoreAll(b.name, setStep);
                        setStep("恢复完成，正在重新加载……");
                        setTimeout(() => location.reload(), 800);
                      } catch (e: any) {
                        setStep("恢复失败：" + (e?.message || e));
                      }
                    }}
                  >
                    整库恢复
                  </AsyncButton>
                  {open === b.name && (
                    <ul className="scan-list">
                      {chs.filter((c) => titles.has(c.id)).length ? (
                        chs
                          .filter((c) => titles.has(c.id))
                          .map((c) => (
                            <li key={c.id}>
                              <span>
                                {titles.get(c.id)} · {c.words.toLocaleString()} 字
                              </span>
                              <AsyncButton
                                onClick={async () => {
                                  if (work && (await bk.pullChapter(b.name, work.id, c.id))) toast("已放进这一章的「历史」，到写作页对比后再决定用不用");
                                }}
                              >
                                放进历史
                              </AsyncButton>
                            </li>
                          ))
                      ) : (
                        <li className="empty">这份备份里没有这本书的正文。</li>
                      )}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty>还没有备份。</Empty>
      )}
    </div>
  );
}

/* ---------- 回收站 ---------- */

export function TrashPanel() {
  const work = useStore((s) => s.work);
  const [items, setItems] = useState<TrashItem[]>([]);
  const [works, setWorks] = useState<{ work: Work; at: number }[]>([]);
  const load = async () => {
    setWorks(await repo.listDeletedWorks());
    setItems(work ? await trash.listTrash(work.id) : []);
  };
  useEffect(() => {
    load();
  }, [work?.id]);
  return (
    <div className="panel">
      <h3>回收站</h3>
      <p className="legend">删掉的书、章、场景在这里留 30 天，之后结账时彻底删除。</p>
      {!works.length && !items.length && <Empty>回收站是空的。</Empty>}
      <ul className="scan-list">
        {works.map((x) => (
          <li key={x.work.id}>
            <span>
              《{x.work.name}》 · 整本书 · 还剩 {trash.daysLeft(x.at)} 天
            </span>
            <span>
              <AsyncButton
                onClick={async () => {
                  await repo.restoreWork(x.work.id);
                  await useStore.getState().loadWorks();
                  toast(`已恢复《${x.work.name}》`);
                  await load();
                }}
              >
                恢复
              </AsyncButton>{" "}
              <AsyncButton
                onClick={async () => {
                  if (!confirm(`彻底删除《${x.work.name}》？这次真的不能恢复了（除非从数据库备份里整库恢复）。`)) return;
                  await repo.deleteWork(x.work.id);
                  await load();
                }}
              >
                彻底删除
              </AsyncButton>
            </span>
          </li>
        ))}
        {items.map((x) => (
          <li key={x.id}>
            <span>
              {x.label} · 还剩 {trash.daysLeft(x.at)} 天
            </span>
            <span>
              <AsyncButton
                onClick={async () => {
                  toast(await trash.restoreItem(work!.id, x.id));
                  await load();
                }}
              >
                恢复
              </AsyncButton>{" "}
              <AsyncButton
                onClick={async () => {
                  if (!confirm(`彻底删除「${x.label}」？`)) return;
                  await trash.purgeItem(work!.id, x.id);
                  await load();
                }}
              >
                彻底删除
              </AsyncButton>
            </span>
          </li>
        ))}
      </ul>
      {work && <p className="legend">章和场景的回收站按书分开，这里显示的是《{work.name}》的。</p>}
    </div>
  );
}
