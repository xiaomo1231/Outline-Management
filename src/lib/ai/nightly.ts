// AI 整理：自动整理跑完后才动。补归档漏掉的章节、写写作日记、整理核心摘要和设定集。
import { chat } from "./client";
import type { Ctx } from "./context";
import { useStore } from "../store";
import * as repo from "../repo";
import * as mem from "../memory";
import { allChapters } from "../outline";
import { fieldLabel } from "../charFields";
import { compileStyle } from "../style";
import { today } from "../util";
import { archiveMany, archiveMap, stale } from "./archive";

/** 每晚最多补归档几章，再多就到记忆页手动「补归档全部」 */
export const NIGHT_LIMIT = 30;

export async function modelRun(c: Ctx, residentLimit: number, onStep?: (s: string) => void): Promise<mem.MemLogEntry> {
  const lines: string[] = [];
  const log = await mem.getLog(c.work.id);
  const lastScript = log.find((e) => e.kind === "script");
  if (!lastScript || lastScript.day !== today() || !lastScript.ok) {
    const e: mem.MemLogEntry = { at: Date.now(), day: today(), kind: "model", ok: false, lines: ["今天的自动整理还没跑完，AI 整理不动。"] };
    await mem.appendLog(c.work.id, e);
    return e;
  }
  try {
    // 1. 补归档：白天每章写完会自动归档，这里补上漏掉的（没填密钥时、关窗前没来得及的）
    const texts = await repo.allTexts(c.work.id);
    const left = await stale(c.work.id, c.vols);
    const todo = left.slice(0, NIGHT_LIMIT);
    const arc = todo.length ? await archiveMany(todo, (d, n, cur) => cur && onStep?.(`归档 ${cur}（${d}/${n}）`), undefined, 3) : { ok: 0, failed: 0, err: undefined };
    lines.push(`补归档 ${arc.ok} 章${arc.failed ? `，失败 ${arc.failed} 章（${arc.err}）` : ""}${left.length > todo.length ? `，还剩 ${left.length - todo.length} 章没归档，可以在记忆页点「补归档全部」` : ""}。`);
    // 归档写进来的新事实当场入层
    if (arc.ok) {
      const st = useStore.getState();
      await mem.scriptRun(st.work!, st.vols);
    }
    const s = useStore.getState();
    const cur: Ctx = { ...c, vols: s.vols, chars: s.chars };

    // 2. 写作日记
    onStep?.("写今天的写作日记");
    const daily = (await repo.dailyWords(c.work.id, 1)).find((x) => x.day === today());
    const todays = allChapters(cur.vols).filter((r) => texts.find((x) => x.id === r.ch.id && new Date(x.updated).toDateString() === new Date().toDateString()));
    const changesToday = cur.chars.flatMap((p) => (p.changes ?? []).filter((x) => new Date(x.at).toDateString() === new Date().toDateString()).map((x) => `${p.name}：${fieldLabel(x.field)} ${x.from || "（空）"} → ${x.to}（${x.status === "conflict" ? "锁定项冲突，待处理" : x.cause}）`));
    const diary = await chat([
      { role: "system", content: "你替作者写当天的写作日记，平实、具体、不夸。分五段，每段用【】标题：今日进度、剧情推进、人物变化、伏笔变动、遗留问题。" },
      { role: "user", content: `今天写了 ${daily?.words ?? 0} 字。\n今天动过的章节：\n${todays.map((r) => `第${r.no}章 ${r.ch.title}：${r.ch.summary || ""}`).join("\n") || "无"}\n人设变化：\n${changesToday.join("\n") || "无"}\n大纲里的伏笔：\n${cur.vols.flatMap((v) => v.chapters.flatMap((ch) => ch.scenes.filter((x) => x.plant || x.pay).map((x) => `${x.plant ? "埋 " + x.plant : ""}${x.pay ? " 收 " + x.pay : ""}`))).join("；") || "无"}` },
    ], { temperature: 0.5 });
    await repo.saveDiary(c.work.id, today(), diary.content.trim());
    lines.push("写作日记已生成。");

    // 3. 核心摘要压短捋顺
    onStep?.("整理核心摘要");
    const facts = await mem.items(c.work.id, 1);
    const raw = mem.buildResident(cur.work, cur.chars, cur.vols, cur.events, compileStyle(cur.style), facts, residentLimit * 2);
    const res = await chat([
      { role: "system", content: `你整理小说的「核心摘要」：每次调用 AI 都会带上它。一半写人物当前状态和写作规范，一半写剧情事实和未收伏笔。压到 ${residentLimit} 字以内，信息不丢，去掉重复，用短句。直接输出正文。` },
      { role: "user", content: raw },
    ], { temperature: 0.2 });
    const text = res.content.trim().slice(0, Math.round(residentLimit * 1.1));
    await mem.saveResident(c.work.id, text, residentLimit);
    lines.push(`核心摘要 ${text.length} 字（上限 ${residentLimit}）。`);

    // 4. 设定集：只提炼「这本书定下了什么」
    onStep?.("更新设定集");
    const bible = await mem.getBible(c.work.id);
    // 设定集上次更新之后归档过的章（包括白天自动归档的）
    const arcs = await archiveMap(c.work.id);
    const sums = allChapters(s.vols)
      .filter((r) => (arcs.get(r.ch.id)?.at ?? 0) > bible.at)
      .slice(-40)
      .map((r) => `第${r.no}章：${arcs.get(r.ch.id)!.summary}`)
      .join("\n");
    if (sums) {
      const b = await chat([
        { role: "system", content: "你维护小说的「设定集」：只记已经确立、以后不能推翻的设定和事实，按类别分组（世界规则、人物定论、重要物件、地点、时间线定点）。保留已有条目，加入新的，删除重复。直接输出全文。" },
        { role: "user", content: `现有设定集：\n${bible.text || "（空）"}\n\n新写的章节摘要：\n${sums}` },
      ], { temperature: 0.2 });
      await mem.saveBible(c.work.id, b.content.trim());
      lines.push("设定集已更新。");
    } else lines.push("没有新章节，设定集不动。");

    const e: mem.MemLogEntry = { at: Date.now(), day: today(), kind: "model", ok: true, lines };
    await mem.appendLog(c.work.id, e);
    return e;
  } catch (err: any) {
    const e: mem.MemLogEntry = { at: Date.now(), day: today(), kind: "model", ok: false, lines: [...lines, "出错：" + (err?.message || err)] };
    await mem.appendLog(c.work.id, e);
    return e;
  }
}
