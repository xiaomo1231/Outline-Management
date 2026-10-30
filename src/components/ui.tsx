import { useState, type ReactNode } from "react";

export function Issue({ lv, children, actions }: { lv: "r" | "y" | "g"; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="issue">
      <span className={"lv " + lv}>{lv === "r" ? "必改" : lv === "y" ? "建议" : "可选"}</span>
      {children}
      {actions && <div className="ia">{actions}</div>}
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange, label, style }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string; style?: React.CSSProperties }) {
  return (
    <div className="seg" role="group" aria-label={label} style={style}>
      {options.map(([k, l]) => (
        <button key={k} type="button" aria-pressed={value === k} onClick={() => onChange(k)}>
          {l}
        </button>
      ))}
    </div>
  );
}

/** 点了以后显示“处理中”，出错时把错误显示在按钮旁边 */
export function AsyncButton({ onClick, children, primary, disabled, title }: { onClick: () => Promise<unknown>; children: ReactNode; primary?: boolean; disabled?: boolean; title?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={"btn" + (primary ? " primary" : "")}
      disabled={busy || disabled}
      title={title}
      onClick={async () => {
        setBusy(true);
        try {
          await onClick();
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "处理中…" : children}
    </button>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty" style={{ margin: 0 }}>{children}</p>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="fld">
      <span>{label}</span>
      <div>
        {children}
        {hint && <div className="hint">{hint}</div>}
      </div>
    </div>
  );
}

/** 自动撑高的输入框 */
export function Area({ value, onChange, rows = 1, placeholder, className, label }: { value: string; onChange: (v: string) => void; rows?: number; placeholder?: string; className?: string; label?: string }) {
  return <textarea rows={rows} value={value} placeholder={placeholder} className={className} aria-label={label} onChange={(e) => onChange(e.target.value)} />;
}
