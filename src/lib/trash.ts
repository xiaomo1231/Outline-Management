// 回收站：删掉的章、场景先放这里，30 天后结账时才真删。作品的回收站在 works 表的 deleted 列。
import * as repo from "./repo";
import { useStore } from "./store";
import { uid } from "./util";
import type { Chapter, Id, Scene, TrashItem } from "./types";

export const KEEP_DAYS = 30;
const DAY = 86_400_000;

export async function listTrash(work: Id): Promise<TrashItem[]> {
  return repo.loadDoc<TrashItem[]>(work, "trash", []);
}
async function saveTrash(work: Id, list: TrashItem[]) {
  await repo.saveDoc(work, "trash", list);
}

/** 删章：从大纲里拿掉，正文只做标记 */
export async function trashChapter(work: Id, v: number, c: number, no: number) {
  const s = useStore.getState();
  const vol = s.vols[v];
  const ch = vol?.chapters[c];
  if (!ch) return;
  const item: TrashItem = { id: uid("tr"), kind: "chapter", at: Date.now(), label: `第${no}章 ${ch.title || "（无题）"}`, parent: vol.id, index: c, data: ch };
  const sids = new Set(ch.scenes.map((x) => x.id));
  s.editMany(["vols", "events"], (d) => {
    d.vols[v].chapters.splice(c, 1);
    for (const e of d.events) {
      if (e.sc && sids.has(e.sc)) delete e.sc;
      if (e.ch === ch.id) e.ch = null;
    }
  });
  await repo.markTextDeleted(ch.id, true);
  await saveTrash(work, [item, ...(await listTrash(work))]);
}

/** 删场景 */
export async function trashScene(work: Id, v: number, c: number, si: number) {
  const s = useStore.getState();
  const ch = s.vols[v]?.chapters[c];
  const sc = ch?.scenes[si];
  if (!ch || !sc) return;
  const item: TrashItem = { id: uid("tr"), kind: "scene", at: Date.now(), label: `场景「${sc.t || "（无题）"}」（${ch.title || "无题章"}）`, parent: ch.id, index: si, data: sc };
  s.editMany(["vols", "events"], (d) => {
    const x = d.vols[v].chapters[c].scenes[si];
    const e = x.ev && d.events.find((y) => y.id === x.ev);
    if (e) delete e.sc;
    d.vols[v].chapters[c].scenes.splice(si, 1);
  });
  await saveTrash(work, [item, ...(await listTrash(work))]);
}

/** 放回原处。原来的卷或章没了，就放到最后一卷 / 第一章 */
export async function restoreItem(work: Id, id: Id): Promise<string> {
  const list = await listTrash(work);
  const item = list.find((x) => x.id === id);
  if (!item) return "这一项已经不在回收站里了";
  const s = useStore.getState();
  if (s.work?.id !== work) return "先打开这本书再恢复";
  let where = "";
  if (item.kind === "chapter") {
    const ch = item.data as Chapter;
    s.edit("vols", (d) => {
      if (!d.length) d.push({ id: uid("v"), title: "第一卷", chapters: [] });
      let vi = d.findIndex((x) => x.id === item.parent);
      if (vi < 0) {
        vi = d.length - 1;
        where = `原来的卷没了，放在「${d[vi].title}」末尾`;
        d[vi].chapters.push(ch);
      } else d[vi].chapters.splice(Math.min(item.index, d[vi].chapters.length), 0, ch);
    });
    await repo.markTextDeleted(ch.id, false);
  } else {
    const sc = item.data as Scene;
    let ok = false;
    s.edit("vols", (d) => {
      for (const v of d)
        for (const c of v.chapters)
          if (c.id === item.parent) {
            c.scenes.splice(Math.min(item.index, c.scenes.length), 0, sc);
            ok = true;
          }
      if (!ok) {
        const first = d[0]?.chapters[0];
        if (first) {
          first.scenes.push(sc);
          ok = true;
          where = `原来的章没了，放在「${first.title || "第一章"}」末尾`;
        }
      }
    });
    if (!ok) return "书里还没有章节，没法放回场景";
  }
  await saveTrash(
    work,
    list.filter((x) => x.id !== id),
  );
  return "已恢复：" + item.label + (where ? "。" + where : "");
}

/** 彻底删除一项 */
export async function purgeItem(work: Id, id: Id) {
  const list = await listTrash(work);
  const item = list.find((x) => x.id === id);
  if (item?.kind === "chapter") await repo.deleteText((item.data as Chapter).id);
  await saveTrash(
    work,
    list.filter((x) => x.id !== id),
  );
}

/** 清掉超过 30 天的：一本书的章和场景，以及回收站里的整本书 */
export async function purgeOld(now = Date.now()): Promise<number> {
  let n = 0;
  const cut = now - KEEP_DAYS * DAY;
  for (const { work, at } of await repo.listDeletedWorks()) {
    if (at < cut) {
      await repo.deleteWork(work.id);
      n++;
    }
  }
  for (const w of await repo.listWorks()) {
    const list = await listTrash(w.id);
    const old = list.filter((x) => x.at < cut);
    if (!old.length) continue;
    for (const x of old) if (x.kind === "chapter") await repo.deleteText((x.data as Chapter).id);
    await saveTrash(
      w.id,
      list.filter((x) => x.at >= cut),
    );
    n += old.length;
  }
  return n;
}

export function daysLeft(at: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((at + KEEP_DAYS * DAY - now) / DAY));
}
