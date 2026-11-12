/**
 * TagField：设置里「兴趣」「不想看的」用的标签输入（规范 §7.7.6）。
 * 输入框 + 回车/加号添加，已加的标签是一个带 ✕ 的纸片；到上限后输入框失效并说明原因。
 */
import { useState } from "react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Field";

type Props = {
  label: string;
  hint?: string;
  placeholder: string;
  values: string[];
  max: number;
  maxChars: number;
  disabled?: boolean;
  /** 返回值用于即时提示（比如“太长了”）。 */
  onChange: (next: string[]) => void;
};

export function TagField({ label, hint, placeholder, values, max, maxChars, disabled = false, onChange }: Props) {
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState("");
  const full = values.length >= max;

  const add = () => {
    const value = draft.trim();
    if (!value) return;
    if ([...value].length > maxChars) {
      setNote(`每个最多 ${maxChars} 个字。`);
      return;
    }
    if (values.includes(value)) {
      setDraft("");
      setNote("");
      return;
    }
    if (full) {
      setNote(`最多 ${max} 个。`);
      return;
    }
    onChange([...values, value]);
    setDraft("");
    setNote("");
  };

  return (
    <div className="tagfield">
      <div className="tagfield__row">
        <Input className="tagfield__input"
          type="text"
          value={draft}
          placeholder={full ? `已经有 ${max} 个了` : placeholder}
          aria-label={label}
          maxLength={maxChars + 4}
          disabled={disabled || full}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
        />
        <Button variant="secondary" disabled={disabled || full} onClick={add}>
          加上
        </Button>
      </div>
      {values.length > 0 && (
        <ul className="tagfield__list" aria-label={`已加的${label}`}>
          {values.map((value) => (
            <li key={value} className="tagfield__chip">
              <span>{value}</span>
              <button
                type="button"
                className="tagfield__x"
                aria-label={`去掉 ${value}`}
                disabled={disabled}
                onClick={() => onChange(values.filter((item) => item !== value))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="tagfield__hint" role={note ? "status" : undefined}>
        {note || hint}
      </p>
    </div>
  );
}
