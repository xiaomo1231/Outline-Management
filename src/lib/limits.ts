// 写作限制：作者给这本书定的「不要写什么」。
// 提示词里出现两次（系统提示开头一段完整版，生成请求最后一句提醒），生成后用词表在本地扫描。
import type { LimitLevel, LimitType, WriteLimit } from "./types";
import { uid } from "./util";

export const LIMIT_TYPES: LimitType[] = ["用词语感", "内容尺度", "情节走向", "人物言行", "格式标点"];
export const LEVELS: [LimitLevel, string][] = [
  ["never", "绝不出现"],
  ["brief", "一笔带过"],
  ["less", "尽量少用"],
];
export const levelName = (l: LimitLevel) => LEVELS.find((x) => x[0] === l)?.[1] ?? l;

export const DEFAULT_LEVEL: Record<LimitType, LimitLevel> = {
  用词语感: "less",
  内容尺度: "brief",
  情节走向: "never",
  人物言行: "never",
  格式标点: "less",
};
/** 「尽量少用」默认每千字几次 */
export const DEFAULT_CAP = 2;

/** 每种类型 AI 该怎么避开 */
export const HOW: Record<LimitType, string> = {
  用词语感: "换成更白、更贴合本书的说法，意思保留，不是把这句删掉",
  内容尺度: "按力度处理：绝不出现的不写；一笔带过的只用一两句交代结果，用转场或旁人反应代替过程和细节",
  情节走向: "大纲和正文都不往这个方向走，不要自己加这类情节",
  人物言行: "写到相关人物的对白和动作时避开",
  格式标点: "生成时照做",
};

type Preset = { key: string; text: string; type: LimitType; level: LimitLevel; cap?: number; examples?: string; want?: string; words: string[]; hint?: string[] };

/** 常用预设，勾上即用，自带检查词表。hint 是作者「这一次的要求」里会和它冲突的说法 */
export const PRESETS: Preset[] = [
  {
    key: "wenzhou",
    text: "不要文绉绉的词",
    type: "用词语感",
    level: "less",
    cap: 2,
    examples: "伫立、凝眸、旋即、良久",
    want: "用大白话，「站着」不写「伫立」，「过了好一会儿」不写「良久」",
    words: ["伫立", "凝眸", "旋即", "良久", "彼时", "缱绻", "踱步", "颔首", "莞尔", "蓦然", "倏地", "倏然", "须臾", "翌日", "俄顷", "兀自", "犹自", "怔忡", "阖眼", "睥睨", "嗫嚅", "踟蹰", "逡巡", "觑", "遂"],
    hint: ["文绉绉", "文雅", "古风", "文艺", "书面"],
  },
  {
    key: "meme",
    text: "不用网络梗和流行语",
    type: "用词语感",
    level: "never",
    words: ["yyds", "绝绝子", "破防", "内卷", "躺平", "emo", "上头", "整活", "芭比Q", "栓Q", "666", "格局打开", "狠狠地", "家人们", "离谱"],
    hint: ["网络梗", "梗", "流行语", "沙雕"],
  },
  {
    key: "idiom",
    text: "不堆四字成语",
    type: "用词语感",
    level: "less",
    cap: 3,
    want: "能用一句具体描写的，不用成语概括",
    words: ["电光火石", "千钧一发", "目瞪口呆", "心惊胆战", "不可思议", "惊天动地", "风驰电掣", "势如破竹", "毛骨悚然", "面面相觑", "哑口无言", "怒发冲冠"],
    hint: ["成语", "四字"],
  },
  {
    key: "curse",
    text: "不写脏话",
    type: "用词语感",
    level: "never",
    want: "需要骂人时用语气和动作表现，不出现脏字",
    words: ["他妈的", "他娘的", "妈的", "混蛋", "王八蛋", "狗东西", "狗日的", "贱人", "滚你的", "去你的"],
    hint: ["脏话", "骂", "粗口"],
  },
  {
    key: "gore",
    text: "不写血腥细节",
    type: "内容尺度",
    level: "brief",
    examples: "血肉模糊、断肢、脑浆",
    want: "写到伤亡只交代结果，用旁人反应或转场代替过程",
    words: ["血肉模糊", "鲜血喷", "血流如注", "血如泉涌", "脑浆", "内脏", "肠子", "断肢", "残肢", "碎骨", "血雾", "开膛", "剜", "血淋淋"],
    hint: ["血腥", "血", "残忍", "虐杀", "重口"],
  },
  {
    key: "sex",
    text: "不写性描写",
    type: "内容尺度",
    level: "brief",
    want: "最多写到关灯、转场",
    words: ["宽衣解带", "云雨", "缠绵", "娇喘", "喘息声", "床笫"],
    hint: ["床戏", "亲热", "肉", "性"],
  },
  {
    key: "animal",
    text: "不写虐待动物",
    type: "内容尺度",
    level: "never",
    words: ["虐猫", "虐狗", "踢狗", "剥皮"],
    hint: ["虐待动物"],
  },
  {
    key: "selfharm",
    text: "不写自残自杀细节",
    type: "内容尺度",
    level: "brief",
    words: ["割腕", "上吊", "跳楼", "服毒"],
    hint: ["自残", "自杀"],
  },
  {
    key: "dumb",
    text: "配角不降智",
    type: "情节走向",
    level: "never",
    examples: "反派突然犯低级错误、配角为了推剧情做出不合理的蠢事",
    words: [],
    hint: ["降智"],
  },
  {
    key: "abuse",
    text: "不虐主",
    type: "情节走向",
    level: "never",
    examples: "主角长期被欺压不反击、主角失去重要的人或能力",
    words: [],
    hint: ["虐主", "虐"],
  },
  {
    key: "excl",
    text: "少用感叹号",
    type: "格式标点",
    level: "less",
    cap: 3,
    words: ["！"],
    hint: ["感叹号"],
  },
];

export function fromPreset(key: string): WriteLimit | null {
  const p = PRESETS.find((x) => x.key === key);
  if (!p) return null;
  return { id: uid("lm"), text: p.text, type: p.type, level: p.level, cap: p.cap, examples: p.examples, want: p.want, words: [...p.words], except: [], preset: p.key };
}

/** 作者只写了一句话时，猜类型和力度 */
export function guessType(text: string): { type: LimitType; level: LimitLevel } {
  let type: LimitType = "用词语感";
  if (/号|标点|破折|省略/.test(text)) type = "格式标点";
  else if (/血|杀|尸|性描写|床|恐怖|惊悚|虐待|自残|自杀|暴力|毒品|酷刑/.test(text)) type = "内容尺度";
  else if (/降智|放过|后宫|虐主|圣母|走向|复活|死掉|黑化|背叛|三角|绿/.test(text)) type = "情节走向";
  else if (/^(主角|女主|男主|反派|配角|[一-龥]{2,3})(从不|不会|不|别|永远不)(说|哭|笑|骂|跪|求|喝|抽|打)/.test(text)) type = "人物言行";
  return { type, level: DEFAULT_LEVEL[type] };
}

export function newLimit(text: string): WriteLimit {
  const g = guessType(text);
  return { id: uid("lm"), text: text.trim(), type: g.type, level: g.level, cap: g.level === "less" ? DEFAULT_CAP : undefined, words: [], except: [] };
}

/**
 * 旧禁用清单 → 写作限制。短的（≤8 字、没有空格）当作词：用词语感 / 绝不出现，词本身进词表；
 * 长的是套路或剧情走向：情节走向 / 绝不出现，只写进提示词。
 */
export function migrateBans(text: string | undefined): WriteLimit[] {
  return (text ?? "")
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const word = x.length <= 8 && !/\s/.test(x);
      return { id: uid("lm"), text: x, type: word ? "用词语感" : "情节走向", level: "never", words: word ? [x] : [], except: [], fromOld: true } as WriteLimit;
    });
}

/** 打开作品时用：还没有 limits 就从旧禁用清单转 */
export function ensureLimits(limits: WriteLimit[] | undefined, bans: string | undefined): WriteLimit[] {
  return Array.isArray(limits) ? limits : migrateBans(bans);
}

/** 不同任务带哪些限制：写正文和聊天全带；排大纲和人设只带和情节、尺度、人物有关的 */
export type LimitTask = "prose" | "plan" | "check";
const PLAN_TYPES: LimitType[] = ["内容尺度", "情节走向", "人物言行"];

/** 正在写的位置：哪一卷、本章有哪些人物。知道位置时，按卷生效和「只管这些人」的限制才会被筛掉 */
export interface LimitAt {
  vol?: string;
  names?: string[];
}

export function activeLimits(limits: WriteLimit[] | undefined, task: LimitTask = "prose", at?: LimitAt): WriteLimit[] {
  const on = (limits ?? []).filter((l) => {
    if (l.off || !l.text.trim()) return false;
    if (at?.vol && l.vols?.length && !l.vols.includes(at.vol)) return false;
    if (at?.names && l.who?.mode === "only" && l.who.names.length && !l.who.names.some((n) => at.names!.includes(n))) return false;
    return true;
  });
  return task === "plan" ? on.filter((l) => PLAN_TYPES.includes(l.type)) : on;
}

function levelText(l: WriteLimit): string {
  if (l.level === "less") return `尽量少用${l.cap ? `，每千字最多 ${l.cap} 次` : ""}`;
  return levelName(l.level);
}

/** 人物范围写成一句话，给提示词和界面用 */
export function whoText(l: WriteLimit): string {
  const w = l.who;
  const names = (w?.names ?? []).filter(Boolean);
  if (!w || w.mode === "all" || !names.length) return "";
  const span = w.span === "pov" ? "的对白和他视角的叙述" : "的对白";
  const who = names.join("、");
  if (w.mode === "only") return `只管${who}${span}，其他人物和旁白不受这条限制`;
  const relax = w.level ? `可以${levelName(w.level)}` : "可以用";
  return `例外：${who}${span}${relax}，这是人设需要；旁白和其他人物照常限制`;
}

/** 系统提示开头的完整版 */
export function limitsBlock(limits: WriteLimit[] | undefined, task: LimitTask = "prose", at?: LimitAt): string {
  const on = activeLimits(limits, task, at);
  if (!on.length) return "";
  const lines: string[] = [
    task === "check"
      ? "=== 本书写作限制（作者定的，检查时也要查有没有违反）==="
      : "=== 本书写作限制（作者定的硬要求，优先级最高：高于文风、作者规则、作者这一次的要求和大纲里的写法）===",
  ];
  for (const t of LIMIT_TYPES) {
    const g = on.filter((l) => l.type === t);
    if (!g.length) continue;
    lines.push(`【${t}】${HOW[t]}`);
    for (const l of g) {
      const bits = [levelText(l)];
      if (l.examples?.trim()) bits.push("例如：" + l.examples.trim());
      else if (l.words.length) bits.push("例如：" + l.words.filter((w) => !l.except.includes(w)).slice(0, 6).join("、"));
      if (l.want?.trim()) bits.push("要这样写：" + l.want.trim());
      const w = whoText(l);
      if (w) bits.push(w);
      lines.push(`- ${l.text.trim()}（${bits.join("；")}）`);
    }
  }
  if (task !== "check") {
    lines.push(`处理规则：
- 绝不出现：一个字都不要写，也不要换个说法写。大纲非要写到时绕开它，情节结果保留。
- 一笔带过：可以发生，但只用一两句交代结果，不写过程和细节。
- 尽量少用：能不用就不用，不超过上限。
- 大纲和限制冲突时以限制为准，但大纲里的情节结果要保留。${task === "prose" ? "\n- 如果因为限制绕开或改动了大纲里的内容，在正文最后另起一行，以「【限制】」开头用一句话告诉作者；没有就不要写这一行。" : ""}`);
  }
  return lines.join("\n");
}

/** 生成请求最后一行的提醒：只列简称，防止被前文冲淡 */
export function limitsTail(limits: WriteLimit[] | undefined, task: LimitTask = "prose", at?: LimitAt): string {
  const on = activeLimits(limits, task, at);
  if (!on.length) return "";
  return "写之前再核对一遍本书写作限制：" + on.map((l) => l.text.trim() + (l.level === "brief" ? "（一笔带过）" : l.level === "less" ? "（尽量少用）" : "") + (l.who && l.who.mode !== "all" && l.who.names.length ? (l.who.mode === "only" ? `（只管${l.who.names.join("、")}）` : `（${l.who.names.join("、")}例外）`) : "")).join("；") + "。";
}

/** 把 AI 写在正文末尾的「【限制】……」说明拿出来，不进正文 */
export function splitLimitNote(text: string): { body: string; notes: string[] } {
  const notes: string[] = [];
  const body = text
    .split("\n")
    .filter((line) => {
      const m = line.trim().match(/^[【\[]限制[】\]][:：]?\s*(.*)$/);
      if (m) notes.push(m[1].trim());
      return !m;
    })
    .join("\n")
    .replace(/\n+$/, "");
  return { body, notes: notes.filter(Boolean) };
}

export interface LimitHit {
  id: string;
  word: string;
  from: number;
  to: number;
  /** 在对白里但认不出是谁说的，作者自己判断 */
  unsure?: boolean;
  /** 认出来的说话人 */
  who?: string;
}
export interface LimitStat {
  limit: WriteLimit;
  /** 算违反的次数（人物例外没超的不算在内） */
  n: number;
  /** 这段文字里允许出现的次数（绝不出现、一笔带过是 0） */
  allowed: number;
  over: boolean;
  words: string[];
  /** 因为人物例外没算的次数 */
  exempt: number;
  /** 认不出说话人的次数 */
  unsure: number;
}

/** 一段文字允许的次数：每千字 cap 次，按长度折算，至少 1 次 */
export function allowedIn(l: WriteLimit, len: number, level: LimitLevel = l.level): number {
  if (level !== "less") return 0;
  const cap = l.cap ?? DEFAULT_CAP;
  return Math.max(1, Math.round((cap * len) / 1000));
}

export interface Quote {
  from: number;
  to: number;
  /** 认出来的说话人（正式名字），认不出是 null */
  who: string | null;
}

const OPEN = "“「『\"";
const CLOSE: Record<string, string> = { "“": "”", "「": "」", "『": "』", '"': '"' };

/**
 * 找出文字里的对白，并按引号前后的「某某道」「某某冷笑一声：」认说话人。
 * 只在同一段、引号前后各 24 个字以内找名字（含别名），离引号最近的那个算说话人。
 */
export function findQuotes(text: string, people: { name: string; names: string[] }[] = []): Quote[] {
  const out: Quote[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (OPEN.includes(ch)) {
      const close = CLOSE[ch];
      let j = text.indexOf(close, i + 1);
      const nl = text.indexOf("\n", i + 1);
      if (j < 0 || (nl >= 0 && nl < j)) j = nl >= 0 ? nl : text.length;
      out.push({ from: i, to: Math.min(text.length, j + 1), who: null });
      i = j + 1;
    } else i++;
  }
  for (const q of out) {
    const lineStart = text.lastIndexOf("\n", q.from - 1) + 1;
    const lineEndRaw = text.indexOf("\n", q.to);
    const lineEnd = lineEndRaw < 0 ? text.length : lineEndRaw;
    // 前面：从上一句结束（或上一段对白结束）到引号；后面：引号到下一句结束
    const prevQ = out.filter((x) => x.to <= q.from && x.to > lineStart).pop();
    let a = Math.max(lineStart, prevQ ? prevQ.to : lineStart, q.from - 24);
    const cut = Math.max(text.lastIndexOf("。", q.from - 1), text.lastIndexOf("！", q.from - 1), text.lastIndexOf("？", q.from - 1));
    if (cut >= a) a = cut + 1;
    const before = text.slice(a, q.from);
    const nextQ = out.find((x) => x.from >= q.to && x.from < lineEnd);
    let b = Math.min(lineEnd, nextQ ? nextQ.from : lineEnd, q.to + 24);
    const after = text.slice(q.to, b);
    const endAfter = after.search(/[。！？]/);
    const afterS = endAfter >= 0 ? after.slice(0, endAfter) : after;
    // 先看「某某道：“……”」：引号前以冒号结尾，说话人在前面；再看「“……”某某道」；都不是就找离引号最近的名字
    const nearestBefore = () => {
      let best: { name: string; d: number } | null = null;
      for (const p of people)
        for (const n of p.names) {
          const bi = before.lastIndexOf(n);
          if (bi >= 0 && (!best || before.length - bi < best.d)) best = { name: p.name, d: before.length - bi };
        }
      return best;
    };
    const nearestAfter = (verb: boolean) => {
      let best: { name: string; d: number } | null = null;
      for (const p of people)
        for (const n of p.names) {
          const ai = afterS.indexOf(n);
          if (ai < 0) continue;
          if (verb && !/^.{0,6}?(道|说|问|笑|喊|叫|答|骂|吼|嚷|叹|应|哼)/.test(afterS.slice(ai + n.length))) continue;
          if (!best || ai < best.d) best = { name: p.name, d: ai };
        }
      return best;
    };
    let best = /[：:]\s*$/.test(before) ? nearestBefore() : null;
    best ??= nearestAfter(true) ?? nearestBefore() ?? nearestAfter(false);
    q.who = best?.name ?? null;
  }
  return out;
}

export interface ScanOpts {
  at?: LimitAt;
  /** 人物和他们的所有叫法，用来认说话人 */
  people?: { name: string; names: string[] }[];
  /** 本段/本章的视角人物 */
  pov?: string;
}

/**
 * 用词表扫一段文字。「尽量少用」只在超过上限时才算违反。
 * 有人物范围的限制：先认出词在谁的对白里（或谁的视角叙述里），再决定算不算；认不出说话人的单独标「不确定」。
 */
export function scanLimits(text: string, limits: WriteLimit[] | undefined, opts: ScanOpts = {}): { hits: LimitHit[]; stats: LimitStat[] } {
  const hits: LimitHit[] = [];
  const stats: LimitStat[] = [];
  const len = text.replace(/\s/g, "").length;
  const scoped = activeLimits(limits, "prose", opts.at).some((l) => l.who && l.who.mode !== "all" && l.who.names.length);
  const quotes = scoped ? findQuotes(text, opts.people) : [];
  const quoteAt = (i: number) => quotes.find((q) => q.from <= i && i < q.to);
  for (const l of activeLimits(limits, "prose", opts.at)) {
    const found: LimitHit[] = [];
    for (const w of l.words) {
      if (!w || l.except.includes(w)) continue;
      let i = text.indexOf(w);
      while (i >= 0) {
        // 例外词包住这个词的不算，例如词表有「遂」、例外有「遂心」
        const covered = l.except.some((x) => {
          const k = x.indexOf(w);
          return k >= 0 && text.substr(i - k, x.length) === x;
        });
        if (!covered) found.push({ id: l.id, word: w, from: i, to: i + w.length });
        i = text.indexOf(w, i + w.length);
      }
    }
    if (!found.length) continue;
    const who = l.who && l.who.mode !== "all" && l.who.names.length ? l.who : null;
    const counted: LimitHit[] = [];
    const relaxed: LimitHit[] = [];
    let unsure = 0;
    for (const h of found) {
      if (!who) {
        counted.push(h);
        continue;
      }
      const q = quoteAt(h.from);
      const mine = q ? (q.who ? who.names.includes(q.who) : null) : who.span === "pov" && opts.pov ? who.names.includes(opts.pov) : false;
      if (q?.who) h.who = q.who;
      if (who.mode === "except") {
        if (mine === true) relaxed.push(h);
        else if (mine === null) {
          unsure++;
          counted.push({ ...h, unsure: true });
        } else counted.push(h);
      } else {
        // 只管这些人：他们说的算，别人说的和旁白不算，认不出的标不确定
        if (mine === true) counted.push(h);
        else if (mine === null) {
          unsure++;
          counted.push({ ...h, unsure: true });
        }
      }
    }
    const allowed = allowedIn(l, len);
    const sure = counted.filter((h) => !h.unsure);
    const over = sure.length > allowed || (l.level !== "less" && counted.length > 0);
    // 放宽的人如果设了「尽量少用」，超了也要标
    const relaxLevel = who?.mode === "except" ? who.level : undefined;
    const relaxOver = relaxLevel === "less" && relaxed.length > allowedIn(l, len, "less");
    if (!counted.length && !relaxOver && !relaxed.length) continue;
    stats.push({ limit: l, n: relaxOver ? counted.length + relaxed.length : counted.length, allowed, over: over || relaxOver, words: [...new Set([...counted, ...relaxed].map((f) => f.word))], exempt: relaxOver ? 0 : relaxed.length, unsure });
    if (over) hits.push(...counted);
    if (relaxOver) hits.push(...relaxed);
  }
  hits.sort((a, b) => a.from - b.from);
  return { hits, stats };
}

/** 去掉「不要、不写……细节」这些，剩下限制的核心词，用来判断这一次的要求是不是和它冲突 */
export function coreOf(text: string): string {
  return text
    .replace(/^(不要|不想要|不想|不写|不用|不出现|别写|别用|别|禁止|少用|少写|尽量不|不)/, "")
    .replace(/(的?细节|的?描写|的?过程|的?词|的?字|的?话|的?内容|的?情节|和.*)$/, "")
    .trim();
}

/** 作者这一次的要求和哪些限制冲突（只做本地匹配，不调 AI） */
export function noteConflicts(note: string, limits: WriteLimit[] | undefined): WriteLimit[] {
  const n = note.trim();
  if (!n) return [];
  return activeLimits(limits).filter((l) => {
    const keys = [coreOf(l.text), ...(PRESETS.find((p) => p.key === l.preset)?.hint ?? []), ...l.words.filter((w) => w.length >= 2)];
    return keys.some((k) => k.length >= 2 ? n.includes(k) : k.length === 1 && l.preset === "gore" && n.includes(k));
  });
}

/** 把文字切成句子，记下每句的位置 */
export function sentences(text: string): { from: number; to: number; t: string }[] {
  const out: { from: number; to: number; t: string }[] = [];
  const re = /[^。！？!?…\n]+[。！？!?…]*[”」』"]?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) if (m[0].trim()) out.push({ from: m.index, to: m.index + m[0].length, t: m[0] });
  return out;
}

/** 含违反词的句子（去重，按顺序） */
export function badSentences(text: string, hits: LimitHit[]): { from: number; to: number; t: string }[] {
  return sentences(text).filter((s) => hits.some((h) => h.from < s.to && h.to > s.from));
}

/** 用 AI 改好的句子替换原句，其余字不动。fixes 的 i 对应 badSentences 的序号 */
export function applySentenceFixes(text: string, bad: { from: number; to: number }[], fixes: { i: number; t: string }[]): string {
  const map = new Map(fixes.filter((f) => bad[f.i] && typeof f.t === "string").map((f) => [f.i, f.t]));
  let out = "";
  let p = 0;
  bad.forEach((s, i) => {
    out += text.slice(p, s.from) + (map.has(i) ? map.get(i)! : text.slice(s.from, s.to));
    p = s.to;
  });
  return out + text.slice(p);
}

/** 词表文本框：顿号、逗号、空格、换行都能分隔 */
export function parseWords(s: string): string[] {
  return [...new Set(s.split(/[、，,\s]+/).map((x) => x.trim()).filter(Boolean))];
}

/** 「我的规则」里像限制的行：以不、别、禁止、从不、绝不、避免、少用开头 */
export function ruleLikeLimits(rules: string | undefined): string[] {
  return (rules ?? "")
    .split("\n")
    .map((x) => x.trim())
    .filter((x) => x && /^(不要|不写|不用|不让|不能|不准|不出现|别|禁止|从不|绝不|避免|少用|少写|尽量不)|^[\u4e00-\u9fa5]{1,4}(从不|绝不|不说|不哭|不骂)/.test(x));
}

/** 常用限制（跨书模板）存到新书时：换新 id，去掉人物和卷（那是旧书的） */
export function copyForBook(l: WriteLimit): WriteLimit {
  const { who, vols, fromOld, ...rest } = l;
  void who;
  void vols;
  void fromOld;
  return { ...rest, id: uid("lm"), words: [...l.words], except: [...l.except] };
}
