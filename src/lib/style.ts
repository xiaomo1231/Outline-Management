import type { StyleBlock, StyleDims, StyleMetrics, StyleSetup } from "./types";
import { metricsText } from "./corpus";

export const DIMS: [keyof StyleDims, string][] = [
  ["pov", "叙事视角"],
  ["lang", "语言质感"],
  ["vocab", "词汇质感"],
  ["rhythm", "节奏"],
  ["dialog", "对白"],
  ["tone", "情绪基调"],
  ["avoid", "避免"],
];

const E: StyleDims = { pov: "", lang: "", vocab: "", rhythm: "", dialog: "", tone: "", avoid: "" };
const b = (id: string, kind: StyleBlock["kind"], name: string, desc: string, d: Partial<StyleDims>): StyleBlock => ({ id, kind, name, desc, dims: { ...E, ...d }, builtin: true });

/**
 * 作者书库（D:\\大纲管理\\小说，288 本）按题材统计出的写法数字。
 * 统计脚本见仓库 tools/analyze.py；只保留数字，不保留原文。
 */
const M: Record<string, StyleMetrics> = {
  dushi: {"books": 27, "sentLen": 24.1, "sentSd": 15.0, "paraLen": 25.0, "paraOne": 0.952, "dialog": 0.321, "excl": 3.56, "ques": 4.82, "ellip": 0.84, "simile": 0.66, "firstPerson": 0.024, "firstDialog": 70, "chapLen": null, "endQ": 0.075, "endDialog": 0.15, "endShort": 0.237},
  xiuxian: {"books": 10, "sentLen": 27.6, "sentSd": 14.35, "paraLen": 28.0, "paraOne": 0.91, "dialog": 0.228, "excl": 4.705, "ques": 4.045, "ellip": 1.305, "simile": 1.035, "firstPerson": 0.032, "firstDialog": 74, "chapLen": 2382, "endQ": 0.05, "endDialog": 0.075, "endShort": 0.237},
  xuanyi: {"books": 20, "sentLen": 25.65, "sentSd": 15.9, "paraLen": 24.0, "paraOne": 0.968, "dialog": 0.26, "excl": 4.855, "ques": 3.45, "ellip": 0.795, "simile": 1.135, "firstPerson": 0.04, "firstDialog": 62, "chapLen": null, "endQ": 0.1, "endDialog": 0.175, "endShort": 0.25},
  lishi: {"books": 20, "sentLen": 26.85, "sentSd": 16.7, "paraLen": 23.0, "paraOne": 0.942, "dialog": 0.292, "excl": 5.065, "ques": 4.175, "ellip": 1.075, "simile": 0.62, "firstPerson": 0.043, "firstDialog": 75, "chapLen": null, "endQ": 0.087, "endDialog": 0.225, "endShort": 0.382},
  kehuan: {"books": 9, "sentLen": 27.1, "sentSd": 14.9, "paraLen": 26, "paraOne": 0.975, "dialog": 0.277, "excl": 3.98, "ques": 4.46, "ellip": 0.6, "simile": 0.62, "firstPerson": 0.027, "firstDialog": 73, "chapLen": null, "endQ": 0.075, "endDialog": 0.225, "endShort": 0.287},
  wuxia: {"books": 10, "sentLen": 32.75, "sentSd": 21.15, "paraLen": 43.0, "paraOne": 0.661, "dialog": 0.224, "excl": 3.065, "ques": 3.985, "ellip": 1.21, "simile": 0.89, "firstPerson": 0.018, "firstDialog": 114, "chapLen": 2996, "endQ": 0.075, "endDialog": 0.113, "endShort": 0.157},
  yanqing: {"books": 17, "sentLen": 25.9, "sentSd": 15.4, "paraLen": 25.0, "paraOne": 0.912, "dialog": 0.345, "excl": 4.79, "ques": 5.5, "ellip": 0.76, "simile": 0.59, "firstPerson": 0.015, "firstDialog": 54, "chapLen": null, "endQ": 0.069, "endDialog": 0.169, "endShort": 0.306},
  xuanhuan: {"books": 18, "sentLen": 28.0, "sentSd": 17.0, "paraLen": 27.5, "paraOne": 0.953, "dialog": 0.268, "excl": 4.905, "ques": 4.115, "ellip": 0.44, "simile": 0.78, "firstPerson": 0.032, "firstDialog": 78, "chapLen": 2198, "endQ": 0.05, "endDialog": 0.125, "endShort": 0.263},
  wangyou: {"books": 24, "sentLen": 25.2, "sentSd": 15.35, "paraLen": 23.5, "paraOne": 0.959, "dialog": 0.203, "excl": 5.115, "ques": 4.375, "ellip": 0.69, "simile": 0.755, "firstPerson": 0.034, "firstDialog": 106, "chapLen": null, "endQ": 0.075, "endDialog": 0.157, "endShort": 0.325},
  guyan: {"books": 10, "sentLen": 23.8, "sentSd": 12.8, "paraLen": 24.0, "paraOne": 0.883, "dialog": 0.264, "excl": 3.545, "ques": 6.025, "ellip": 0.28, "simile": 0.715, "firstPerson": 0.011, "firstDialog": 43, "chapLen": 2416, "endQ": 0.163, "endDialog": 0.157, "endShort": 0.263},
  gaoran: {"books": 44, "sentLen": 24.2, "sentSd": 14.8, "paraLen": 24.0, "paraOne": 0.893, "dialog": 0.316, "excl": 6.265, "ques": 4.735, "ellip": 1.43, "simile": 0.895, "firstPerson": 0.019, "firstDialog": 47, "chapLen": 2358, "endQ": 0.062, "endDialog": 0.154, "endShort": 0.175},
  gouzi: {"books": 10, "sentLen": 22.5, "sentSd": 17.2, "paraLen": 24.5, "paraOne": 0.815, "dialog": 0.325, "excl": 5.64, "ques": 6.275, "ellip": 3.38, "simile": 1.545, "firstPerson": 0.136, "firstDialog": 51, "chapLen": 2284, "endQ": 0.1, "endDialog": 0.225, "endShort": 0.388},
  puchen: {"books": 17, "sentLen": 32.4, "sentSd": 22.9, "paraLen": 40.0, "paraOne": 0.732, "dialog": 0.234, "excl": 3.37, "ques": 3.23, "ellip": 0.82, "simile": 1.21, "firstPerson": 0.012, "firstDialog": 96, "chapLen": 3221, "endQ": 0.062, "endDialog": 0.188, "endShort": 0.15},
};

/**
 * 内置风格块只写「怎么写」，不写「写什么」。
 * 文字描述结合了书库统计（见 M）：对白多少、句子长短、段落切法、章末收法。
 */
const RAW: StyleBlock[] = [
  b("dushi", "genre", "都市", "日常、职场、人际往来", { pov: "贴身第三人称，镜头跟着主角走", lang: "现代口语白话，短句为主，用生活里的具体细节带出质感", vocab: "当代日常与城市生活的词汇，品牌和流行语点到为止", rhythm: "推进快，场景切换利落，少铺垫", dialog: "多而口语化，允许打断、省略和答非所问", tone: "轻快里带一点锋利，情绪落在具体的人和事上", avoid: "文绉绉的书面腔、大段空泛的环境描写" }),
  b("xiuxian", "genre", "修仙", "修炼、心境、斗法", { pov: "第三人称，可以深入人物内心", lang: "偏古雅的白话，心境处可用四字短语但不堆砌", vocab: "道家修行、草木山川、天象的质感", rhythm: "修炼与积累处舒缓，斗法处短促", dialog: "略带古意，称谓讲究", tone: "清冷悠远，求道的孤独感", avoid: "现代网络用语、成段解释境界设定" }),
  b("honghuang", "genre", "洪荒", "天地变化、大能交锋、纪元更替", { pov: "全知与主角视角交替，镜头可以拉到极远", lang: "半文半白，句子短而重，多用单字动词，带古籍记事的口吻", vocab: "古雅宏大、偏上古神话的质感，只定质感不列名词", rhythm: "大跨度时间跳跃与关键时刻的慢镜头交替", dialog: "少而精，带仪式感，多留白", tone: "苍茫孤高，个人情绪放在天地背景下写", avoid: "现代网络用语、过度心理独白、轻佻的搞笑" }),
  b("xuanyi", "genre", "悬疑", "线索、对峙、揭示", { pov: "限知视角，读者只知道主角知道的", lang: "克制精确，多写可观察的细节，少写判断", vocab: "具体的物件、时间和动作", rhythm: "信息分批放出，章末留未解的问题", dialog: "话里有话，人物会回避和撒谎", tone: "压抑、紧绷", avoid: "提前揭示、旁白式讲解推理过程" }),
  b("lishi", "genre", "历史", "朝堂、礼俗、时代大事", { pov: "第三人称偏全知，可在人物与时代之间切换", lang: "沉稳的书面白话，可少量化用典籍语感", vocab: "器物、官制、礼俗的质感，不罗列名词", rhythm: "中等，大事件前有铺陈", dialog: "合乎身份与场合，尊卑分明", tone: "厚重，个人命运与时代互相映照", avoid: "用现代价值观直白说教、现代口语" }),
  b("kehuan", "genre", "科幻", "技术细节、宇宙尺度、未来社会", { pov: "第三人称，常带技术性的观察角度", lang: "干净理性，比喻取自物理和工程", vocab: "科学技术的质感，新造词遵守同一套构词规则", rhythm: "概念展开处放慢，行动处加快", dialog: "简洁专业，不用对白讲解设定", tone: "冷静宏阔，带着人的孤独", avoid: "术语堆砌、科普式说明" }),
  b("wuxia", "genre", "武侠", "打斗、江湖往来", { pov: "第三人称，镜头灵活", lang: "古典白话，动作干脆，少写招式名多写身法", vocab: "江湖、兵器、山水的质感", rhythm: "打斗短促，文戏舒展；段落可以长，一段写完一个完整动作或景", dialog: "简劲有侠气，留白", tone: "快意与苍凉并存", avoid: "数值化的武功描写、现代语" }),
  b("yanqing", "genre", "言情", "感情的靠近与拉扯", { pov: "贴身视角，常在两人之间切换但一段只跟一个人", lang: "细腻但不甜腻，情绪借小动作和停顿传出来", vocab: "日常物件、天气、身体距离的质感", rhythm: "关系推进慢，情绪转折处给足篇幅", dialog: "对白占比高（约三分之一），说一半藏一半，潜台词比台词重要", tone: "温柔里带一点不安", avoid: "直白的表白独白、霸总式台词、空洞的外貌夸赞" }),
  b("lenghumor", "tone", "冷幽默", "对白与叙述的转折处", { lang: "叙述冷淡，笑点藏在平铺直叙的陈述里", dialog: "不解释笑点，不加“哈哈”", tone: "冷面", avoid: "网络梗、感叹号堆叠" }),
  b("kezhi", "tone", "克制抒情", "情感场面", { lang: "情绪不直说，借动作和物件落地", tone: "含蓄，留余味", avoid: "直接写“他很难过”、排比式抒情" }),
  b("kuai", "tone", "快节奏", "全篇", { lang: "短句短段", rhythm: "每个场景只留一个核心动作，删掉过渡", avoid: "大段回忆和插叙" }),
  b("qunxiang", "tone", "群像", "多线并行的章节", { pov: "多视角轮换，每段固定一个人的视角", rhythm: "各线交替推进", avoid: "同一段里视角漂移" }),
  b("xuanhuan", "genre", "玄幻", "力量体系、宗门与大世界", { pov: "第三人称贴主角，大场面时短暂拉远看众人反应", lang: "通俗白话，句子中等偏长，交代战斗和境界时干脆", vocab: "力量、血脉、天地、兵器的质感，新名词少而稳定", rhythm: "一章一个推进点，战斗段落短句加速，修炼和赶路一笔带过", dialog: "对白约占四分之一，交锋时你来我往、句子短", tone: "昂扬，向上走的劲头", avoid: "成段解释等级设定、同一个反应词反复用" }),
  b("wangyou", "genre", "网游竞技", "副本、对局、数据面板", { pov: "第三人称贴主角，操作和判断写在叙述里", lang: "清楚利落，数值和规则交代一次就够", vocab: "游戏机制、装备、职业的质感，面板信息单独成段", rhythm: "开章先写局面再上对白，对局按回合推进，章末常停在结果揭晓前", dialog: "对白偏少，约占两成，多是队友间的短句和频道消息", tone: "紧张、好胜", avoid: "整页数值罗列、把规则讲两遍" }),
  b("guyan", "genre", "古言", "宅门、宫廷、婚恋", { pov: "贴身第三人称，跟着女性视角走", lang: "半文半白的口语，句子短而匀，少长句", vocab: "衣饰、礼数、器物、称谓的质感", rhythm: "开章很快进入对白，一来一回推进关系；常以一句问话收章", dialog: "称谓和分寸讲究，话里藏锋，多用反问", tone: "温婉中带机锋", avoid: "现代网络用语、直白的情绪说明" }),
  b("gaoran", "tone", "高燃快爽", "冲突与反转场面", { lang: "短句短段，一段一两句，感叹句多一些（每千字五六个）", rhythm: "开章几十字内就让人开口，冲突当场爆发当场收，旁观者的反应紧跟其后", dialog: "多而直接，约占三成，交锋时一句顶一句", tone: "痛快、昂扬", avoid: "冲突前的长铺垫、反应写得千篇一律" }),
  b("gouzi", "tone", "强钩子短句", "全篇，尤其章末", { pov: "可用第一人称，内心声音更直接", lang: "句子短，长短交错明显，省略号和破折号用来断气口", rhythm: "近四成的章以一句短句或一句对白收尾，把问题留到下一章", dialog: "对白约占三成，问句多，信息一半一半地给", tone: "紧绷、有悬念", avoid: "章末总结、把下一章要发生的事提前说出来" }),
  b("puchen", "tone", "厚重铺陈", "大场面、长篇主线", { lang: "句子偏长，段落可以写到四五十字，叙述与描写交织", rhythm: "大场面层层铺开，动作和景物交替，不急着收", dialog: "对白偏少，约占两成多，重话放在关键处", tone: "宏大、有分量", avoid: "一句一段的碎切、口水化对白" }),
];

/** 有统计数据的块挂上 metrics */
export const BUILTIN: StyleBlock[] = RAW.map((x) => (M[x.id] ? { ...x, metrics: M[x.id] } : x));

/** 风格块里不允许出现的内容和套路词：风格只管写法，不管情节 */
export const BANNED = ["退婚", "打脸", "金手指", "系统", "重生", "穿越", "废柴", "开局", "签到", "逆袭", "女主", "男主", "主角叫", "第一章", "桥段", "套路", "名叫"];

export function leak(block: Pick<StyleBlock, "name" | "desc" | "dims">): string[] {
  const all = [block.name, block.desc, ...Object.values(block.dims)].join(" ");
  return BANNED.filter((w) => all.includes(w));
}

export function emptySetup(): StyleSetup {
  return { core: null, sub: [], accent: [], rules: "", samples: "", blocks: [] };
}

export function allBlocks(s: StyleSetup): StyleBlock[] {
  return [...BUILTIN, ...s.blocks];
}

export function blockById(s: StyleSetup, id: string): StyleBlock | undefined {
  return allBlocks(s).find((x) => x.id === id);
}

/** 软上限：超过后提醒风格会被稀释 */
export const SOFT = { sub: 2, accent: 3 };

export interface Impact {
  shares: { name: string; slot: string; pct: number }[];
  chars: number;
  tokens: number;
  warnings: string[];
}

/** 按核心 / 次级 / 点缀的权重，算每个块大致占多少影响 */
export function impact(s: StyleSetup): Impact {
  const items: { name: string; slot: string; w: number }[] = [];
  const core = s.core && blockById(s, s.core);
  if (core) items.push({ name: core.name, slot: "核心", w: 5 });
  s.sub.forEach((id) => {
    const x = blockById(s, id);
    if (x) items.push({ name: x.name, slot: "次级", w: 2.5 });
  });
  s.accent.forEach((id) => {
    const x = blockById(s, id);
    if (x) items.push({ name: x.name, slot: "点缀", w: 1 });
  });
  const total = items.reduce((a, x) => a + x.w, 0) || 1;
  const text = compileStyle(s);
  const warnings: string[] = [];
  if (!core) warnings.push("还没有放核心风格，AI 会用很平均的写法。");
  if (s.sub.length > SOFT.sub) warnings.push(`次级风格有 ${s.sub.length} 个，超过 ${SOFT.sub} 个以后每个的影响都会变弱，混在一起容易变成“什么都像一点”。`);
  if (s.accent.length > SOFT.accent) warnings.push(`点缀有 ${s.accent.length} 个，太多点缀会互相打架，建议只留最想要的几个。`);
  const avoidHits = conflicts(s);
  warnings.push(...avoidHits);
  const corePct = core ? (5 / total) * 100 : 0;
  if (core && corePct < 40) warnings.push(`核心风格只占约 ${Math.round(corePct)}%，已经不太像“${core.name}”了。`);
  return {
    shares: items.map((x) => ({ name: x.name, slot: x.slot, pct: Math.round((x.w / total) * 100) })),
    chars: text.length,
    // 中文大约 1 字 ≈ 0.6 token
    tokens: Math.round(text.length * 0.6),
    warnings,
  };
}

/** 一个块要求的写法被另一个块列进了「避免」 */
function conflicts(s: StyleSetup): string[] {
  const ids = [s.core, ...s.sub, ...s.accent].filter(Boolean) as string[];
  const bl = ids.map((id) => blockById(s, id)).filter(Boolean) as StyleBlock[];
  const out: string[] = [];
  for (const a of bl)
    for (const c of bl) {
      if (a === c || !a.dims.avoid) continue;
      if (/对白|对话/.test(a.dims.avoid) && /多而|大量/.test(c.dims.dialog)) out.push(`「${a.name}」要求少写对白，和「${c.name}」的对白多相互冲突。`);
    }
  return out;
}

/** 把搭好的风格编译成写进提示词的一段话。作者规则和样章优先级最高。 */
export function compileStyle(s: StyleSetup): string {
  const core = s.core ? blockById(s, s.core) : undefined;
  const subs = s.sub.map((id) => blockById(s, id)).filter(Boolean) as StyleBlock[];
  const acc = s.accent.map((id) => blockById(s, id)).filter(Boolean) as StyleBlock[];
  const lines: string[] = [];
  if (s.rules.trim()) lines.push("【作者规则，最高优先级，和下面任何一条冲突时以这里为准】\n" + s.rules.trim());
  for (const [k, label] of DIMS) {
    const parts: string[] = [];
    if (core?.dims[k]) parts.push(core.dims[k]);
    for (const x of subs) if (x.dims[k]) parts.push(`兼有${x.name}的一面：${x.dims[k]}`);
    for (const x of acc) if (x.dims[k]) parts.push(`少量点缀（${x.desc || "全篇"}）：${x.dims[k]}`);
    if (parts.length) lines.push(`${label}：${parts.join("；")}`);
  }
  const mx = [core, ...subs].find((x) => x?.metrics);
  if (mx?.metrics) lines.push(metricsText(mx.metrics, mx.builtin ? `${mx.metrics.books} 本「${mx.name}」类小说的统计` : `「${mx.name}」的统计`));
  if (s.samples.trim()) lines.push("【作者样章，模仿它的语感、句子长短和用词习惯，不要模仿它的情节】\n" + s.samples.trim().slice(0, 3000));
  return lines.join("\n");
}

/** 规则融合：每个维度以第一个块为主，后面的块作为补充，避免项合并去重 */
export function fuse(blocks: StyleBlock[], name: string): StyleBlock {
  const dims = { ...E };
  for (const [k] of DIMS) {
    if (k === "avoid") {
      const set = new Set(blocks.flatMap((x) => x.dims.avoid.split(/[、，,]/).map((y) => y.trim()).filter(Boolean)));
      dims.avoid = [...set].join("、");
    } else {
      const vs = blocks.map((x) => x.dims[k]).filter(Boolean);
      dims[k] = vs.length > 1 ? `${vs[0]}；同时带一点：${vs.slice(1).join("；")}` : vs[0] || "";
    }
  }
  return { id: "", kind: "custom", name, desc: blocks.map((x) => x.name).join(" × "), dims };
}
