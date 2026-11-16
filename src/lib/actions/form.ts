import "server-only";
import { revalidatePath } from "next/cache";
import * as catalog from "../catalog/products";
import type { CatalogCode } from "../catalog/products";
import type { CouponCode } from "../coupons";
import type { GuardCode } from "../guard";
import { parsePixKey, parsePixText } from "../input";
import type { InvoiceCode } from "../invoices";
import type { MediaCode } from "../media/uploads";
import type { StorageCode } from "../media/storage";
import type { MemberCode } from "../members";
import type { AutomationCode, MessageCode } from "../messages";
import type { OrderCode } from "../orders/checkout";
import { company } from "../registry";
import * as config from "../settings";
import type { ConversionCode } from "../tracking/meta";
import type { TrackCode } from "../tracking/funnel";
import type { UpdateCode } from "../updates";

export type Code =
  | UpdateCode
  | OrderCode
  | MemberCode
  | GuardCode
  | TrackCode
  | ConversionCode
  | MessageCode
  | CatalogCode
  | AutomationCode
  | MediaCode
  | StorageCode
  | InvoiceCode
  | CouponCode;

// secret is set only by rotateWebhookSecret: the one time the generated value reaches the browser.
export type ActionState = { code: Code | null; ok?: boolean; secret?: string };

export type FormArgs = [state: ActionState, form: FormData];

export type Pix = catalog.Product["pix"];

export function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export function column(form: FormData, name: string): string[] {
  return form.getAll(name).map((value) => (typeof value === "string" ? value : ""));
}

export function done(code: Code | null): ActionState {
  revalidatePath("/", "layout");
  return code ? { code } : { code: null, ok: true };
}

// Name and city only label the payment in the payer's bank app, so blank ones come from the CNPJ registry (the key's own
// CNPJ, or the store's) and the store's legal name.
export async function pixFields(form: FormData): Promise<Pix | { code: Code }> {
  const key = parsePixKey(field(form, "pixKey"));
  if (!key) return { code: "INVALID_PIX_KEY" };
  const typedName = field(form, "pixName").trim();
  const typedCity = field(form, "pixCity").trim();
  const store = await config.settings();
  const cnpj = [key, store.document].find((value) => value && /^\d{14}$/.test(value));
  const found = (!typedName || !typedCity) && cnpj ? await company(cnpj) : undefined;
  const name = parsePixText(typedName || (cnpj === key ? found?.name : "") || store.legalName || store.brand, 25);
  const city = parsePixText(typedCity || found?.town || "", 15);
  if (!name || !city) return { code: "INVALID_PIX_HOLDER" };
  return { key, name, city };
}
