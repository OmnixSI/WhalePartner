import { msg } from "../i18n/index.ts";
import { ChatInputError } from "../chat/service.ts";

export function text(value: unknown, max: number, field: string, required = true): string | undefined {
  if (value === undefined || value === null || value === "") {
    if (required) throw new ChatInputError(msg().core.routes.input.required(field));
    return undefined;
  }
  if (typeof value !== "string" || value.length > max) throw new ChatInputError(msg().core.routes.input.tooLong(field, max));
  return value.trim();
}
