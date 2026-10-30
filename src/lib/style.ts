import type { StyleBlock, StyleDims, StyleSetup } from "./types";

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
 * 内置风格块只写「怎么写」，不写「写什么」。
 * 等你把小说发来后，会按同样的格式提炼出更多预设。
 */
export const BUILTIN: StyleBlock[] = [
  b("dushi", "genre", "都市", "日常、职场、人际往来", { pov: "贴身第三人称，镜头跟着主角走", lang: "现代口语白话，短句为主，用生活里的具体细节带出质感", vocab: "当代日常与城市生活的词汇，品牌和流行语点到为止", rhythm: "推进快，场景切换利落，少铺垫", dialog: "多而口语化，允许打断、省略和答非所问", tone: "轻快里带一点锋利，情绪落在具体的人和事上", avoid: "文绉绉的书面腔、大段空泛的环境描写" }),
  b("xiuxian", "genre", "修仙", "修炼、心境、斗法", { pov: "第三人称，可以深入人物内心", lang: "偏古雅的白话，心境处可用四字短语但不堆砌", vocab: "道家修行、草木山川、天象的质感", rhythm: "修炼与积累处舒缓，斗法处短促", dialog: "略带古意，称谓讲究", tone: "清冷悠远，求道的孤独感", avoid: "现代网络用语、成段解释境界设定" }),
  b("honghuang", "genre", "洪荒", "天地变化、大能交锋、纪元更替", { pov: "全知与主角视角交替，镜头可以拉到极远", lang: "半文半白，句子短而重，多用单字动词，带古籍记事的口吻", vocab: "古雅宏大、偏上古神话的质感，只定质感不列名词", rhythm: "大跨度时间跳跃与关键时刻的慢镜头交替", dialog: "少而精，带仪式感，多留白", tone: "苍茫孤高，个人情绪放在天地背景下写", avoid: "现代网络用语、过度心理独白、轻佻的搞笑" }),
  b("xuanyi", "genre", "悬疑", "线索、对峙、揭示", { pov: "限知视角，读者只知道主角知道的", lang: "克制精确，多写可观察的细节，少写判断", vocab: "具体的物件、时间和动作", rhythm: "信息分批放出，章末留未解的问题", dialog: "话里有话，人物会回避和撒谎", tone: "压抑、紧绷", avoid: "提前揭示、旁白式讲解推理过程" }),
  b("lishi", "genre", "历史", "朝堂、礼俗、时代大事", { pov: "第三人称偏全知，可在人物与时代之间切换", lang: "沉稳的书面白话，可少量化用典籍语感", vocab: "器物、官制、礼俗的质感，不罗列名词", rhythm: "中等，大事件前有铺陈", dialog: "合乎身份与场合，尊卑分明", tone: "厚重，个人命运与时代互相映照", avoid: "用现代价值观直白说教、现代口语" }),
  b("kehuan", "genre", "科幻", "技术细节、宇宙尺度、未来社会", { pov: "第三人称，常带技术性的观察角度", lang: "干净理性，比喻取自物理和工程", vocab: "科学技术的质感，新造词遵守同一套构词规则", rhythm: "概念展开处放慢，行动处加快", dialog: "简洁专业，不用对白讲解设定", tone: "冷静宏阔，带着人的孤独", avoid: "术语堆砌、科普式说明" }),
  b("wuxia", "genre", "武侠", "打斗、江湖往来", { pov: "第三人称，镜头灵活", lang: "古典白话，动作干脆，少写招式名多写身法", vocab: "江湖、兵器、山水的质感", rhythm: "打斗短促，文戏舒展", dialog: "简劲有侠气，留白", tone: "快意与苍凉并存", avoid: "数值化的武功描写、现代语" }),
  b("yanqing", "genre", "言情", "感情的靠近与拉扯", { pov: "贴身视角，常在两人之间切换但一段只跟一个人", lang: "细腻但不甜腻，情绪借小动作和停顿传出来", vocab: "日常物件、天气、身体距离的质感", rhythm: "关系推进慢，情绪转折处给足篇幅", dialog: "说一半藏一半，潜台词比台词重要", tone: "温柔里带一点不安", avoid: "直白的表白独白、霸总式台词、空洞的外貌夸赞" }),
  b("lenghumor", "tone", "冷幽默", "对白与叙述的转折处", { lang: "叙述冷淡，笑点藏在平铺直叙的陈述里", dialog: "不解释笑点，不加“哈哈”", tone: "冷面", avoid: "网络梗、感叹号堆叠" }),
  b("kezhi", "tone", "克制抒情", "情感场面", { lang: "情绪不直说，借动作和物件落地", tone: "含蓄，留余味", avoid: "直接写“他很难过”、排比式抒情" }),
  b("kuai", "tone", "快节奏", "全篇", { lang: "短句短段", rhythm: "每个场景只留一个核心动作，删掉过渡", avoid: "大段回忆和插叙" }),
  b("qunxiang", "tone", "群像", "多线并行的章节", { pov: "多视角轮换，每段固定一个人的视角", rhythm: "各线交替推进", avoid: "同一段里视角漂移" }),
];

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
