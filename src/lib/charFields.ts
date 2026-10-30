import groups from "./charFields.json";

export type FieldFlag = "lock" | "hid" | "dyn";
export interface FieldDef {
  k: string;
  label: string;
  hint: string;
  flag?: FieldFlag;
}
export interface FieldGroup {
  id: string;
  name: string;
  note: string;
  fields: FieldDef[];
}

/** 详细版：12 组完整档案。简单版用其中的常用项，两边共用同一套键。 */
export const GROUPS = groups as FieldGroup[];

/** 简单版人物卡显示的字段 */
export const SIMPLE: [string, string][] = [
  ["tag", "一句话人设"],
  ["id", "身份"],
  ["look", "外貌（锁定）"],
  ["core", "性格核心"],
  ["want", "动机"],
  ["voice", "说话方式"],
  ["rel", "关系"],
  ["first", "首次出场"],
];

export const ROLES = ["男主", "女主", "男一", "男二", "女一", "女二", "反派", "导师", "配角", "自定义"];

const ALL = new Map<string, FieldDef>();
for (const g of GROUPS) for (const f of g.fields) ALL.set(f.k, f);
export function fieldDef(k: string): FieldDef | undefined {
  return ALL.get(k);
}
export function fieldLabel(k: string): string {
  return ALL.get(k)?.label ?? SIMPLE.find((x) => x[0] === k)?.[1] ?? k;
}
