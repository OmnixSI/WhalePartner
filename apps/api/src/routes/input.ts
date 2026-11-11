import { ChatInputError } from "../chat/service.ts";

export function text(value: unknown, max: number, field: string, required = true): string | undefined {
  if (value === undefined || value === null || value === "") {
    if (required) throw new ChatInputError(`${field} 不能为空。`);
    return undefined;
  }
  if (typeof value !== "string" || value.length > max) throw new ChatInputError(`${field} 必须是不超过 ${max} 字的文字。`);
  return value.trim();
}
