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

/** day：结哪一天的账（漏跑后补跑时是漏掉的那天），日记写到这一天 */
export async function modelRun(c: Ctx, residentLimit: number, onStep?: (s: string) => void, day = today()): Promise<mem.MemLogEntry> {
  const lines: string[] = [];
  // AI 返回空内容时不覆盖原有的，这次记为失败
  let bad = false;
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

    // 2. 写作日记：按结账的那一天统计
    const label = day === today() ? "今天" : day;
    onStep?.(`写${label}的写作日记`);
    const daily = (await repo.dailyWords(c.work.id, 7)).find((x) => x.day === day);
    const todays = allChapters(cur.vols).filter((r) => texts.find((x) => x.id === r.ch.id && today(new Date(x.updated)) === day));
    const changesToday = cur.chars.flatMap((p) => (p.changes ?? []).filter((x) => today(new Date(x.at)) === day).map((x) => `${p.name}：${fieldLabel(x.field)} ${x.from || "（空）"} → ${x.to}（${x.status === "conflict" ? "锁定项冲突，待处理" : x.cause}）`));
    const diary = await chat([
      { role: "system", content: "你替作者写当天的写作日记，平实、具体、不夸。分五段，每段用【】标题：今日进度、剧情推进、人物变化、伏笔变动、遗留问题。" },
      { role: "user", content: `${label}写了 ${daily?.words ?? 0} 字。\n${label}动过的章节：\n${todays.map((r) => `第${r.no}章 ${r.ch.title}：${r.ch.summary || ""}`).join("\n") || "无"}\n人设变化：\n${changesToday.join("\n") || "无"}\n大纲里的伏笔：\n${cur.vols.flatMap((v) => v.chapters.flatMap((ch) => ch.scenes.filter((x) => x.plant || x.pay).map((x) => `${x.plant ? "埋 " + x.plant : ""}${x.pay ? " 收 " + x.pay : ""}`))).join("；") || "无"}` },
    ], { temperature: 0.5 });
    if (diary.content.trim()) {
      await repo.saveDiary(c.work.id, day, diary.content.trim());
      lines.push(`写作日记已生成（${day}）。`);
    } else {
      bad = true;
      lines.push("写作日记：AI 返回了空内容，没有保存。");
    }

    // 3. 核心摘要压短捋顺
    onStep?.("整理核心摘要");
    const facts = await mem.items(c.work.id, 1);
    const styleText = compileStyle(cur.style);
    const raw = mem.buildResident(cur.work, cur.chars, cur.vols, cur.events, styleText, facts, residentLimit * 2);
    const res = await chat([
      { role: "system", content: `你整理小说的「核心摘要」：每次调用 AI 都会带上它。一半写人物当前状态和写作规范，一半写剧情事实和未收伏笔。压到 ${residentLimit} 字以内，信息不丢，去掉重复，用短句。直接输出正文。` },
      { role: "user", content: raw },
    ], { temperature: 0.2 });
    const text = res.content.trim().slice(0, Math.round(residentLimit * 1.1));
    if (text) {
      await mem.saveResident(c.work.id, text, residentLimit, mem.styleSig(styleText));
      lines.push(`核心摘要 ${text.length} 字（上限 ${residentLimit}）。`);
    } else {
      bad = true;
      lines.push("核心摘要：AI 返回了空内容，原来的保留不动。");
    }

    // 4. 设定集：只提炼「这本书定下了什么」
    onStep?.("更新设定集");
    const bible = await mem.getBible(c.work.id);
    // 上次 AI 提炼之后归档过的章（包括白天自动归档的）；作者手动保存设定集不算提炼
    const upto = Date.now();
    const arcs = await archiveMap(c.work.id);
    const sums = allChapters(s.vols)
      .filter((r) => (arcs.get(r.ch.id)?.at ?? 0) > (bible.upto ?? bible.at))
      .slice(-40)
      .map((r) => `第${r.no}章：${arcs.get(r.ch.id)!.summary}`)
      .join("\n");
    if (sums) {
      const b = await chat([
        { role: "system", content: "你维护小说的「设定集」：只记已经确立、以后不能推翻的设定和事实，按类别分组（世界规则、人物定论、重要物件、地点、时间线定点）。保留已有条目，加入新的，删除重复。直接输出全文。" },
        { role: "user", content: `现有设定集：\n${bible.text || "（空）"}\n\n新写的章节摘要：\n${sums}` },
      ], { temperature: 0.2 });
      const nb = b.content.trim();
      // 空的、或比原来短了一大截（原来要求保留已有条目），多半是出错了，不覆盖作者的设定集
      if (!nb || (bible.text.length > 200 && nb.length < bible.text.length / 3)) {
        bad = true;
        lines.push(`设定集：AI 返回的内容${nb ? "比原来短太多" : "是空的"}，原来的设定集保留不动，下次整理再试。`);
      } else {
        await mem.saveBible(c.work.id, nb, upto);
        lines.push("设定集已更新。");
      }
    } else lines.push("没有新章节，设定集不动。");

    const e: mem.MemLogEntry = { at: Date.now(), day: today(), kind: "model", ok: !bad, lines };
    await mem.appendLog(c.work.id, e);
    return e;
  } catch (err: any) {
    const e: mem.MemLogEntry = { at: Date.now(), day: today(), kind: "model", ok: false, lines: [...lines, "出错：" + (err?.message || err)] };
    await mem.appendLog(c.work.id, e);
    return e;
  }
}
