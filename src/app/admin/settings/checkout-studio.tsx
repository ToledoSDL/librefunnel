"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ButtonAttributes } from "@/components/action/button";
import segmentedStyles from "@/components/form/segmented-control.module.css";
import { Badge } from "@/components/text/badge";
import { Text } from "@/components/text/text";
import { Money } from "@/app/format";
import styles from "./checkout-studio.module.css";

type Look = {
  phone: string;
  confirmEmail: boolean;
  theme: string;
  button: string;
  notice: string;
  countdown: boolean;
  trust: boolean;
  guarantee: boolean;
  testimonials: boolean;
  thanksUrl: string;
  thanksLabel: string;
};

type IconSet = Record<"lock" | "clock" | "info" | "pix" | "shield" | "seal" | "zap" | "eye", ReactNode>;

type View = "checkout" | "paid";

const AFTER_PAYMENT = ["thanksUrl", "thanksLabel"];

const VIEWS: { value: View; label: string }[] = [
  { value: "checkout", label: "Checkout" },
  { value: "paid", label: "Pago" },
];

function read(form: HTMLFormElement): Look {
  const data = new FormData(form);

  const text = (name: string) => {
    const value = data.get(name);
    return typeof value === "string" ? value.trim() : "";
  };

  const on = (name: string) => data.getAll(name).includes("1");

  return {
    phone: text("checkoutPhone"),
    confirmEmail: on("confirmEmail"),
    theme: text("checkoutTheme"),
    button: text("checkoutButton"),
    notice: text("checkoutNotice"),
    countdown: on("checkoutCountdown"),
    trust: on("checkoutTrust"),
    guarantee: on("checkoutGuarantee"),
    testimonials: on("checkoutTestimonials"),
    thanksUrl: text("thanksUrl"),
    thanksLabel: text("thanksLabel"),
  };
}

function Field({ label }: { label: string }) {
  return (
    <span className={styles.field}>
      <span>{label}</span>
      <span className={styles.input} />
    </span>
  );
}

function CheckoutMock({
  look,
  labels,
  product,
  accent,
  icons,
}: {
  look: Look;
  labels: { button: string };
  product: { name: string; price: number; cover?: string; guaranteeDays: number; testimonials: number };
  accent: { background: string; color: string };
  icons: IconSet;
}) {
  const button = look.button || labels.button;

  return (
    <>
      {look.countdown ? (
        <div className={styles.countdown}>
          {icons.clock}
          Esta oferta termina em 23:59:59
        </div>
      ) : null}
      <div className={styles.body}>
        <div className={styles.product}>
          {product.cover ? <img src={product.cover} alt="" width={40} height={40} /> : null}
          <span>
            <strong>{product.name}</strong>
            <Money cents={product.price} />
          </span>
        </div>
        {look.notice ? (
          <p className={styles.notice}>
            {icons.info}
            {look.notice}
          </p>
        ) : null}
        <div className={styles.panel}>
          <strong className={styles.step}>
            <span>1</span>Seus dados
          </strong>
          <Field label="Nome completo" />
          <Field label="E-mail" />
          {look.confirmEmail ? <Field label="Confirme seu e-mail" /> : null}
          {look.phone === "hidden" ? null : (
            <Field label={look.phone === "required" ? "WhatsApp" : "WhatsApp (opcional)"} />
          )}
        </div>
        <div className={styles.panel}>
          <strong className={styles.step}>
            <span>2</span>Pagamento
          </strong>
          <span className={styles.method} style={{ borderColor: accent.background }}>
            <span className={styles.icon} style={{ color: accent.background }}>
              {icons.pix}
            </span>
            Pix
          </span>
          <span className={styles.total}>
            Total
            <Money cents={product.price} />
          </span>
          <span className={styles.buy} style={accent}>
            {icons.lock}
            {button}
          </span>
          {look.trust ? (
            <span className={styles.trust}>
              <span>
                <span className={styles.icon} style={{ color: accent.background }}>
                  {icons.shield}
                </span>
                Compra 100% segura
              </span>
              {look.guarantee ? null : (
                <span>
                  <span className={styles.icon} style={{ color: accent.background }}>
                    {icons.seal}
                  </span>
                  Garantia de {product.guaranteeDays} dias
                </span>
              )}
              <span>
                <span className={styles.icon} style={{ color: accent.background }}>
                  {icons.zap}
                </span>
                Acesso imediato
              </span>
            </span>
          ) : null}
          <span className={styles.legal}>Ao clicar em {button}, você concorda com os termos de compra.</span>
        </div>
        {look.guarantee ? (
          <div className={styles.guarantee}>
            <span className={styles.icon} style={{ color: accent.background }}>
              {icons.shield}
            </span>
            <strong>Garantia de {product.guaranteeDays} dias</strong>
          </div>
        ) : null}
        {look.testimonials ? (
          <div className={styles.placeholder}>
            {product.testimonials
              ? `${product.testimonials} ${product.testimonials === 1 ? "depoimento" : "depoimentos"} deste produto`
              : "Os depoimentos do produto aparecem aqui"}
          </div>
        ) : null}
      </div>
    </>
  );
}

function PaidMock({ look, labels }: { look: Look; labels: { thanks: string } }) {
  return (
    <div className={styles.body}>
      <div className={styles.panel}>
        <span>
          <Badge tone="success">Pago</Badge>
        </span>
        <strong className={styles.step}>Pagamento confirmado!</strong>
        <span className={styles.legal}>Obrigado. A sua compra está liberada.</span>
        <span className={styles.members}>Entrar na área de membros</span>
        {look.thanksUrl ? <span className={styles.extra}>{look.thanksLabel || labels.thanks}</span> : null}
        <span className={styles.legal}>O link de acesso também vai para o e-mail.</span>
      </div>
    </div>
  );
}

// The preview reads the form itself, so every field in the groups updates it without wiring each control.
export function CheckoutStudio({
  initial,
  labels,
  store,
  product,
  toggle,
  icons,
  children,
}: {
  initial: Look;
  labels: { button: string; thanks: string };
  store: { brand: string; logo?: string; accent: string; accentInk: string };
  product: { name: string; price: number; cover?: string; guaranteeDays: number; testimonials: number };
  toggle: ButtonAttributes;
  icons: IconSet;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [look, setLook] = useState(initial);
  const [view, setView] = useState<View>("checkout");
  const [open, setOpen] = useState(false);
  const accent = { background: store.accent, color: store.accentInk };

  useEffect(() => {
    const form = root.current?.closest("form");

    if (!form) return;

    const update = () => setLook(read(form));
    const afterReset = () => setTimeout(update);

    form.addEventListener("input", update);
    form.addEventListener("change", update);
    form.addEventListener("reset", afterReset);

    return () => {
      form.removeEventListener("input", update);
      form.removeEventListener("change", update);
      form.removeEventListener("reset", afterReset);
    };
  }, []);

  return (
    <div
      ref={root}
      className={styles.studio}
      onFocus={(event) => {
        const target = event.target;
        if (target instanceof HTMLInputElement && target.name)
          setView(AFTER_PAYMENT.includes(target.name) ? "paid" : "checkout");
      }}
    >
      <div className={styles.groups}>{children}</div>
      <aside className={styles.pane} aria-label="Prévia do checkout">
        <button
          type="button"
          {...toggle}
          className={`${toggle.className} ${styles.toggle}`}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {icons.eye}
          {open ? "Esconder prévia" : "Ver prévia"}
        </button>
        <div className={styles.preview} data-open={open}>
          <div className={styles.head}>
            <Text variant="body-sm" weight="semibold">
              Prévia
            </Text>
            <div className={segmentedStyles.segmented} role="radiogroup" aria-label="Tela da prévia">
              {VIEWS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={view === option.value}
                  className={segmentedStyles.segment}
                  onClick={() => setView(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.device} data-theme={look.theme === "auto" ? undefined : look.theme}>
            <div className={styles.top}>
              {store.logo ? <img src={store.logo} alt="" height={20} /> : <strong>{store.brand}</strong>}
              <span style={{ color: store.accent }}>
                {icons.lock}
                Pagamento seguro
              </span>
            </div>
            {view === "checkout" ? (
              <CheckoutMock look={look} labels={labels} product={product} accent={accent} icons={icons} />
            ) : (
              <PaidMock look={look} labels={labels} />
            )}
          </div>
          {look.theme === "auto" ? (
            <Text variant="caption" tone="muted">
              No modo automático, a prévia segue o modo deste painel.
            </Text>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
