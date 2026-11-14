import type { ReactNode } from "react";
import { saveProduct } from "@/lib/actions";
import type { Product } from "@/lib/catalog";
import { SaveForm } from "../ui";

export type FormSection = "general" | "sales" | "checkout" | "reviews";

export const PLAYER_FIELDS = {
  playerAutoplay: "autoplay",
  playerResume: "resume",
  playerFastBar: "fastBar",
  playerFloating: "floating",
  playerButton: "button",
  playerSpeed: "speed",
} as const satisfies Record<string, keyof Product["player"]>;

function storedFields(product: Product): Record<FormSection, [string, string][]> {
  const bump = product.orderBump;

  return {
    general: [
      ["name", product.name],
      ["price", (product.price / 100).toFixed(2)],
      ["tagline", product.tagline ?? ""],
      ["pixKey", product.pix.key],
      ["pixName", product.pix.name],
      ["pixCity", product.pix.city],
    ],
    sales: [
      ["vslVideo", product.vsl?.video ?? ""],
      ["ctaSeconds", String(product.vsl?.ctaSeconds ?? 0)],
      ["ctaText", product.vsl?.ctaText ?? ""],
      ["captions", product.vsl?.captions ?? ""],
      ["barText", product.bar?.text ?? ""],
      ["barColor", product.bar?.color ?? ""],
      ...product.triggers.flatMap((trigger): [string, string][] => [
        ["trigger_text", trigger.text],
        ["trigger_at", String(trigger.at)],
        ["trigger_until", String(trigger.until)],
        ["trigger_kind", trigger.button ? "button" : "text"],
      ]),
      ...Object.entries(PLAYER_FIELDS).map(([name, key]): [string, string] => [name, product.player[key] ? "1" : ""]),
      ["banner", product.banner ?? ""],
      ["cover", product.cover ?? ""],
    ],
    checkout: [
      ["offerEndsAt", product.offerEndsAt?.toISOString() ?? ""],
      ["guaranteeDays", String(product.guaranteeDays)],
      ["bumpProduct", bump?.product ?? ""],
      ["bumpPrice", bump?.price ? (bump.price / 100).toFixed(2) : ""],
      ["bumpHeadline", bump?.headline ?? ""],
    ],
    reviews: [
      ...product.faq.flatMap((item): [string, string][] => [
        ["faq_q", item.q],
        ["faq_a", item.a],
      ]),
      ...product.testimonials.flatMap((item): [string, string][] => [
        ["testimonial_name", item.name],
        ["testimonial_text", item.text],
        ["testimonial_stars", String(item.stars)],
      ]),
    ],
  };
}

// saveProduct rewrites every product field, so each section posts the stored values of the other sections.
export function ProductForm({
  product,
  section,
  children,
}: {
  product: Product;
  section: FormSection;
  children: ReactNode;
}) {
  const kept = Object.entries(storedFields(product))
    .filter(([key]) => key !== section)
    .flatMap(([, fields]) => fields);

  return (
    <SaveForm
      action={saveProduct}
      bar
      label="Salvar produto"
      pendingLabel="Salvando"
      done="Produto salvo. As páginas já mostram a nova versão; pedidos já feitos mantêm o preço da compra."
    >
      <input type="hidden" name="slug" value={product.slug} />
      {kept.map(([name, value], index) => (
        <input key={index} type="hidden" name={name} value={value} />
      ))}
      {children}
    </SaveForm>
  );
}
