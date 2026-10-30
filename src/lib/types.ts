export type Id = string;

export interface Work {
  id: Id;
  name: string;
  intro: string;
  /** 日更目标（字） */
  goal: number;
  /** 每章预计字数 */
  chapWords: number;
  created: number;
  updated: number;
}

export type ChapterStatus = "大纲" | "写作中" | "已写";

export interface Scene {
  id: Id;
  t: string;
  goal: string;
  conf: string;
  who: string[];
  plant: string;
  pay: string;
  pov?: string;
  day?: number | null;
  time?: string;
  place?: string;
  turn?: string;
  result?: string;
  moodA?: string;
  moodB?: string;
  pace?: string;
  reveal?: string;
  words?: number | null;
  st?: string;
  note?: string;
  /** 关联的时间线事件 */
  ev?: Id;
  /** 从哪里导入的，例如「时间线」 */
  from?: string;
  ai?: boolean;
}

export interface Chapter {
  id: Id;
  title: string;
  status: ChapterStatus;
  scenes: Scene[];
  fn?: string;
  w?: number | null;
  hook?: string;
  note?: string;
  /** 在篇幅规划里的位置：事件段序号、阶段序号（-1 表示段前过渡） */
  pl?: { a: number; p: number } | null;
  /** AI 生成的章节摘要（记忆系统用） */
  summary?: string;
  summaryAt?: number;
}

export interface Volume {
  id: Id;
  title: string;
  chapters: Chapter[];
  summary?: string;
}

export type EventType = "main" | "side" | "plant" | "pay";

export interface StoryEvent {
  id: Id;
  day: number;
  time?: string;
  /** 章节 id；null 表示未指定 */
  ch: Id | null;
  t: string;
  who: string;
  ty: EventType;
  place?: string;
  imp?: number | "";
  fore?: string;
  pre?: Id | "";
  cause?: string;
  process?: string;
  result?: string;
  impact?: string;
  reveal?: string;
  note?: string;
  sc?: Id;
  from?: string;
  ai?: boolean;
}

export type PhaseKind = "trans" | "body" | "peak" | "end" | "free";
export interface Phase {
  k: PhaseKind;
  n: string;
  c: number;
  g: string;
  ai?: boolean;
}
export interface Arc {
  name: string;
  gap: number;
  ph: Phase[];
}

export interface CharChange {
  id: Id;
  /** 发生在哪一章 */
  ch: Id;
  field: string;
  from: string;
  to: string;
  cause: string;
  quote?: string;
  by: "ai" | "author";
  at: number;
  status: "applied" | "conflict" | "undone";
}

export type RevealState = "未揭示" | "部分揭示" | "已揭示";

export interface Character {
  id: Id;
  role: string;
  name: string;
  /** 字段值，键见 charFields.ts */
  f: Record<string, string>;
  /** 哪些字段是 AI 写的（作者改过后移除） */
  ai?: Record<string, 1>;
  /** 字段来源章节，例如「第3章」 */
  src?: Record<string, string>;
  /** 可隐藏字段的揭示计划 */
  rev?: Record<string, { s: RevealState; ch?: string }>;
  /** 每组的自定义字段 */
  custom?: Record<string, { k: string; label: string }[]>;
  /** 按章节记录的变化 */
  changes?: CharChange[];
  /** 知情范围：从哪一章起知道什么 */
  knows?: { secret: string; ch: Id | null }[];
  /** 状态：死亡后出场会报错 */
  dead?: Id | null;
}

/** 称呼表：A 叫 B 什么 */
export interface CallEntry {
  from: string;
  to: string;
  term: string;
}

export interface StyleDims {
  pov: string;
  lang: string;
  vocab: string;
  rhythm: string;
  dialog: string;
  tone: string;
  avoid: string;
}
export interface StyleBlock {
  id: Id;
  name: string;
  /** 题材 / 基调 / 自定义 */
  kind: "genre" | "tone" | "custom";
  desc: string;
  dims: StyleDims;
  builtin?: boolean;
  ai?: boolean;
  /** 从小说统计出来的写法数字，编译进提示词作为量化参考 */
  metrics?: StyleMetrics;
}
/** 写法的量化特征。比例都是 0–1，频率是每千字 */
export interface StyleMetrics {
  /** 统计了几本书 */
  books: number;
  /** 平均句长（字） */
  sentLen: number;
  /** 句长的波动（标准差） */
  sentSd: number;
  /** 段落长度中位数（字） */
  paraLen: number;
  /** 只有一句话的段落占比 */
  paraOne: number;
  /** 对白字数占比 */
  dialog: number;
  /** 感叹号、问号、省略号 每千字 */
  excl: number;
  ques: number;
  ellip: number;
  /** 比喻词（仿佛、好像、如同……）每千字 */
  simile: number;
  /** 叙述里第一人称的比例 */
  firstPerson: number;
  /** 章节开头到第一句对白的字数 */
  firstDialog: number;
  /** 章长中位数（字），没有章节标题的书算不出来 */
  chapLen: number | null;
  /** 章末是问句 / 对白 / 15 字内短句的比例 */
  endQ: number | null;
  endDialog: number | null;
  endShort: number | null;
}
export interface StyleSetup {
  core: Id | null;
  sub: Id[];
  accent: Id[];
  /** 作者自己的规则，优先级最高 */
  rules: string;
  /** 作者的样章，原文保留 */
  samples: string;
  /** 本作品自建的风格块 */
  blocks: StyleBlock[];
}

export interface ChangeSet {
  id: Id;
  at: number;
  label: string;
  /** 改动前的整份数据，用于整组撤销 */
  before: Partial<Record<DocKind, unknown>>;
  undone?: boolean;
}

export type DocKind = "outline" | "chars" | "events" | "plan" | "style" | "calls" | "resident" | "bible" | "memlog" | "changesets" | "inspire";

export interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  at: number;
  /** 这次参考了哪些资料 */
  refs?: string[];
}
export interface Chat {
  id: Id;
  title: string;
  msgs: ChatMsg[];
  updated: number;
}

export interface MemItem {
  id: Id;
  work_id: Id;
  /** 1 近期 2 中期 3 早期 4 归档 */
  layer: number;
  kind: "fact" | "thread" | "decision" | "rejected" | "inspire";
  text: string;
  short: string;
  /** 来自第几章 */
  ch: number;
  hits: number;
  last_hit: number;
  score: number;
  created: number;
  updated: number;
  src: string;
}
