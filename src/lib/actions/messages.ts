"use server";

import { isAdmin } from "../sessions";
import { parseInteger, parsePrintable, parseRowId, parseText } from "../input";
import * as messages from "../messages";
import * as config from "../settings";
import { done, field } from "./form";
import type { ActionState, FormArgs } from "./form";

export async function optOut(...[, form]: FormArgs): Promise<ActionState> {
  return (await messages.optOutByLink(field(form, "token"))) ? { code: null, ok: true } : { code: "LINK_INVALID" };
}

export async function resendMessage(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  const id = Number(field(form, "messageId"));
  return done(Number.isSafeInteger(id) && (await messages.resendMessage(id)) ? null : "INVALID_TRANSITION");
}

export async function sendReply(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  const address = field(form, "address");
  if (!/^\d{10,15}$/.test(address)) return { code: "INVALID_ADDRESS" };
  const body = parseText(field(form, "text"), 2000);
  if (!body) return { code: "INVALID_TEXT" };
  return done(await messages.sendManual(address, body));
}

export async function saveRecoveryStep(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  const unit = parseInteger(field(form, "unit"), 1, 1440) ?? 1;
  const afterMinutes = (parseInteger(field(form, "delay"), 1, 43_200) ?? 0) * unit;
  if (afterMinutes < 1 || afterMinutes >= (await config.settings()).orderHours * 60) return { code: "INVALID_DELAY" };
  const channel = field(form, "channel");
  if (channel !== "email" && channel !== "whatsapp") return { code: "INVALID_PAYLOAD" };
  const body = parseText(field(form, "text"), 2000);
  if (!body) return { code: "INVALID_TEXT" };
  if (!messages.validTemplate(body, messages.RECOVERY_FIELDS)) return { code: "INVALID_TEMPLATE" };

  const saved = await messages.saveRecoveryStep(parseRowId(field(form, "id")) ?? null, {
    afterMinutes,
    channel,
    text: body,
  });

  return done(saved ? null : "INVALID_TRANSITION");
}

export async function deleteRecoveryStep(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  return done((await messages.deleteRecoveryStep(parseRowId(field(form, "id")) ?? 0)) ? null : "INVALID_TRANSITION");
}

export async function saveReply(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };

  const keywords = field(form, "keywords")
    .split(/[,\n]/)
    .map((word) => word.trim())
    .filter(Boolean);

  if (keywords.length === 0 || keywords.some((word) => !parsePrintable(word, 60))) return { code: "INVALID_KEYWORDS" };
  const body = parseText(field(form, "text"), 1000);
  if (!body) return { code: "INVALID_TEXT" };
  if (!messages.validTemplate(body, messages.REPLY_FIELDS)) return { code: "INVALID_TEMPLATE" };
  return done(
    (await messages.saveReply(parseRowId(field(form, "id")) ?? null, keywords, body)) ? null : "INVALID_TRANSITION",
  );
}

export async function deleteReply(...[, form]: FormArgs): Promise<ActionState> {
  if (!(await isAdmin())) return { code: "NOT_SIGNED_IN" };
  return done((await messages.deleteReply(parseRowId(field(form, "id")) ?? 0)) ? null : "INVALID_TRANSITION");
}
