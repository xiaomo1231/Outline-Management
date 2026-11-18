// 回收站：删掉的章、场景先放这里，30 天后每日整理时才真删。作品的回收站在 works 表的 deleted 列。
import * as repo from "./repo";
import { getDb } from "./db";
import { useStore } from "./store";
import { uid } from "./util";
import type { Chapter, Id, MemItem, Scene, StoryEvent, TrashItem } from "./types";

export const KEEP_DAYS = 30;
const DAY = 86_400_000;

/** 放回的场景重新和事件关联：事件还在、没被别的场景占着，就把 sc 和章节接回来；否则清掉场景这边的 ev */
function relink(events: StoryEvent[], scenes: Scene[], chId: Id, live: Set<Id>) {
  for (const s of scenes) {
    if (!s.ev) continue;
    const e = events.find((x) => x.id === s.ev);
    if (e && (!e.sc || e.sc === s.id || !live.has(e.sc))) {
      e.sc = s.id;
      e.ch = chId;
    } else delete s.ev;
  }
}
const sceneIds = (vols: { chapters: Chapter[] }[]) => new Set(vols.flatMap((v) => v.chapters.flatMap((c) => c.scenes.map((x) => x.id))));

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
  // 这一章记的人设变化和归档事实一起收起来：章不在了，变化会被当成从第 1 章起生效
  const changes = s.chars.map((p) => ({ char: p.id, list: (p.changes ?? []).filter((x) => x.ch === ch.id) })).filter((x) => x.list.length);
  const sids = new Set(ch.scenes.map((x) => x.id));
  const evs = s.events.filter((e) => e.ch === ch.id).map((e) => e.id);
  s.editMany(["vols", "events", "chars"], (d) => {
    d.vols[v].chapters.splice(c, 1);
    for (const e of d.events) {
      if (e.sc && sids.has(e.sc)) delete e.sc;
      if (e.ch === ch.id) e.ch = null;
    }
    for (const p of d.chars) if (p.changes?.some((x) => x.ch === ch.id)) p.changes = p.changes.filter((x) => x.ch !== ch.id);
  });
  const src = "归档:" + ch.id;
  const db = await getDb();
  const facts = await db.all<MemItem>(`SELECT * FROM memory WHERE work_id=? AND src=?`, [work, src]);
  const item: TrashItem = { id: uid("tr"), kind: "chapter", at: Date.now(), label: `第${no}章 ${ch.title || "（无题）"}`, parent: vol.id, index: c, data: ch, changes, facts, evs };
  await db.exec(`DELETE FROM memory WHERE work_id=? AND src=?`, [work, src]);
  await repo.markTextDeleted(ch.id, true);
  await saveTrash(work, [item, ...(await listTrash(work))]);
}

/** 删场景 */
export async function trashScene(work: Id, v: number, c: number, si: number, dropEvent = false) {
  const s = useStore.getState();
  const ch = s.vols[v]?.chapters[c];
  const sc = ch?.scenes[si];
  if (!ch || !sc) return;
  const item: TrashItem = { id: uid("tr"), kind: "scene", at: Date.now(), label: `场景「${sc.t || "（无题）"}」（${ch.title || "无题章"}）`, parent: ch.id, index: si, data: sc };
  s.editMany(["vols", "events"], (d) => {
    const x = d.vols[v].chapters[c].scenes[si];
    const ei = x.ev ? d.events.findIndex((y) => y.id === x.ev) : -1;
    if (ei >= 0) {
      if (dropEvent) d.events.splice(ei, 1);
      else delete d.events[ei].sc;
    }
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
    s.editMany(["vols", "events"], (x) => {
      const d = x.vols;
      if (!d.length) d.push({ id: uid("v"), title: "第一卷", chapters: [] });
      let vi = d.findIndex((x) => x.id === item.parent);
      if (vi < 0) {
        vi = d.length - 1;
        where = `原来的卷没了，放在「${d[vi].title}」末尾`;
        d[vi].chapters.push(ch);
      } else d[vi].chapters.splice(Math.min(item.index, d[vi].chapters.length), 0, ch);
      // 场景和事件重新接上；整章记的事件等删章时清掉章节的，记回这一章
      const c = d[vi].chapters.find((y) => y.id === ch.id)!;
      relink(x.events as StoryEvent[], c.scenes as Scene[], ch.id, sceneIds(d as any));
      for (const e of x.events) if (item.evs?.includes(e.id) && e.ch == null && !e.sc) e.ch = ch.id;
    });
    // 删章时收起来的人设变化和记忆事实放回去（人物已经删了的就算了）
    if (item.changes?.length)
      s.edit("chars", (d) => {
        for (const x of item.changes!) {
          const p = d.find((y) => y.id === x.char);
          if (!p) continue;
          const have = new Set((p.changes ?? []).map((y) => y.id));
          (p.changes ??= []).push(...x.list.filter((y) => !have.has(y.id)));
        }
      });
    if (item.facts?.length) {
      const db = await getDb();
      for (const m of item.facts)
        await db.exec(`INSERT OR IGNORE INTO memory(id, work_id, layer, kind, text, short, ch, hits, last_hit, score, created, updated, src) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`, [m.id, m.work_id, m.layer, m.kind, m.text, m.short, m.ch, m.hits, m.last_hit, m.score, m.created, m.updated, m.src]);
    }
    await repo.markTextDeleted(ch.id, false);
  } else {
    const sc = item.data as Scene;
    let ok = false;
    s.editMany(["vols", "events"], (x) => {
      const d = x.vols;
      let at: Chapter | undefined;
      for (const v of d)
        for (const c of v.chapters)
          if (c.id === item.parent) {
            c.scenes.splice(Math.min(item.index, c.scenes.length), 0, sc);
            at = c as Chapter;
          }
      if (!at) {
        const first = d[0]?.chapters[0];
        if (first) {
          first.scenes.push(sc);
          at = first as Chapter;
          where = `原来的章没了，放在「${first.title || "第一章"}」末尾`;
        }
      }
      if (!at) return;
      ok = true;
      // 删场景时事件那边的关联已经断了，放回来要接上
      relink(x.events as StoryEvent[], at.scenes.filter((y) => y.id === sc.id), at.id, sceneIds(d as any));
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
