"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientIp } from "../guard";
import { parseEmail } from "../input";
import * as members from "../members";
import { field } from "./form";
import type { ActionState, FormArgs } from "./form";

export async function requestLogin(...[, form]: FormArgs): Promise<ActionState> {
  const email = parseEmail(field(form, "email"));
  if (!email) return { code: "INVALID_EMAIL" };
  const code = await members.requestLogin(email, clientIp(await headers()));
  return code ? { code } : { code: null, ok: true };
}

export async function confirmLogin(...[, form]: FormArgs): Promise<ActionState> {
  const code = await members.confirmLogin(field(form, "token"));
  if (code) return { code };
  redirect("/m");
}

export async function enterFromOrder(): Promise<ActionState> {
  const code = await members.enterFromOrder();
  if (code) return { code };
  redirect("/m");
}

export async function completeLesson(...[, form]: FormArgs): Promise<ActionState> {
  const code = await members.completeLesson(field(form, "product"), field(form, "lesson"));
  if (code) return { code };
  revalidatePath("/m", "layout");
  return { code: null, ok: true };
}

export async function signOut(): Promise<ActionState> {
  await members.signOut();
  redirect("/m");
}
