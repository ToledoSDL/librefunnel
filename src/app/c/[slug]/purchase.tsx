import { Field } from "@/components/form/field";
import { Input } from "@/components/form/input";
import { Icon } from "@/components/media/icon";
import type { OrderBump } from "@/lib/catalog";
import { Money } from "@/app/format";
import { CheckoutForm, CheckoutTotal, FieldMessage, FormMessage, SubmitLabel } from "@/app/ui";
import { ConfirmEmail } from "./confirm";
import styles from "./page.module.css";

function Step({ number, title }: { number: number; title: string }) {
  return (
    <h2 className={styles.step}>
      <span aria-hidden>{number}</span>
      {title}
    </h2>
  );
}

export function Purchase({
  slug,
  touch,
  price,
  bump,
  bumpDefault,
  termsUrl,
  guaranteeDays,
  phone,
  document,
  confirmEmail,
  button,
  trust,
  seal,
  prefill,
}: {
  slug: string;
  touch: string;
  price: number;
  bump?: OrderBump;
  bumpDefault: boolean;
  termsUrl?: string;
  guaranteeDays: number;
  phone: "optional" | "required" | "hidden";
  document: boolean;
  confirmEmail: boolean;
  button: string;
  trust: boolean;
  seal: boolean;
  prefill: { name: string; email: string; phone: string };
}) {
  return (
    <CheckoutForm slug={slug} touch={touch} bumpDefault={bumpDefault}>
      <div className={styles.panel}>
        <Step number={1} title="Seus dados" />
        <Field label="Nome completo" hint={<FieldMessage code="INVALID_NAME" />}>
          {(control) => (
            <Input
              {...control}
              name="name"
              required
              minLength={2}
              maxLength={120}
              autoComplete="name"
              defaultValue={prefill.name}
              placeholder="Digite seu nome completo"
            />
          )}
        </Field>
        <Field label="E-mail" hint={<FieldMessage code="INVALID_EMAIL" />}>
          {(control) => (
            <Input
              {...control}
              name="email"
              type="email"
              required
              maxLength={200}
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              inputMode="email"
              placeholder="seu@email.com"
              defaultValue={prefill.email}
            />
          )}
        </Field>
        {confirmEmail ? (
          <Field label="Confirme seu e-mail">
            {(control) => (
              <ConfirmEmail
                {...control}
                name="emailConfirm"
                required
                maxLength={200}
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                inputMode="email"
                placeholder="Digite o e-mail de novo"
                defaultValue={prefill.email}
              />
            )}
          </Field>
        ) : null}
        {phone === "hidden" ? null : (
          <Field
            label={phone === "required" ? "WhatsApp" : "WhatsApp (opcional)"}
            hint={<FieldMessage code="INVALID_PHONE" />}
          >
            {(control) => (
              <Input
                {...control}
                name="phone"
                type="tel"
                inputMode="tel"
                required={phone === "required"}
                maxLength={20}
                autoComplete="tel"
                placeholder="(11) 98765-4321"
                defaultValue={prefill.phone}
              />
            )}
          </Field>
        )}
        {document ? (
          <Field label="CPF ou CNPJ para a nota fiscal (opcional)" hint={<FieldMessage code="INVALID_DOCUMENT" />}>
            {(control) => (
              <Input
                {...control}
                name="document"
                inputMode="numeric"
                maxLength={18}
                autoComplete="off"
                placeholder="000.000.000-00"
              />
            )}
          </Field>
        ) : null}
      </div>

      <div className={styles.panel}>
        <Step number={2} title="Pagamento" />
        <div className={styles.method} aria-current="true">
          <Icon name="qr-code" />
          <strong className={styles.methodText}>Pix</strong>
          <Icon name="circle-check" />
        </div>

        {bump ? (
          <label className={styles.bump}>
            <span className={styles.bumpHead}>
              <Icon name="arrow-right" size={16} />
              Sim, eu quero levar junto!
            </span>
            <span className={styles.bumpBody}>
              <input type="checkbox" name="bump" value="1" defaultChecked={bumpDefault} className={styles.bumpCheck} />
              {bump.cover ? (
                <img className={styles.bumpCover} src={bump.cover} alt="" width={64} height={64} loading="lazy" />
              ) : null}
              <span className={styles.bumpText}>
                <strong>{bump.headline ?? bump.name}</strong>
                {bump.tagline ? <span>{bump.tagline}</span> : null}
                <span className={styles.bumpPrice}>
                  {bump.price > bump.bumpPrice ? (
                    <s>
                      <Money cents={bump.price} />
                    </s>
                  ) : null}
                  <strong>
                    + <Money cents={bump.bumpPrice} />
                  </strong>
                </span>
              </span>
            </span>
          </label>
        ) : null}

        <div className={styles.total}>
          <span>Total</span>
          <CheckoutTotal price={price} bump={bump ? { name: bump.name, price: bump.bumpPrice } : undefined} />
        </div>
        <FormMessage />
        <button type="submit" className={styles.buy}>
          <Icon name="lock" />
          <SubmitLabel idle={button} pending="Gerando seu Pix" />
        </button>
        {trust ? (
          <ul className={styles.trust}>
            <li>
              <Icon name="shield-check" size={16} />
              Compra 100% segura
            </li>
            {seal ? null : (
              <li>
                <Icon name="badge-check" size={16} />
                Garantia de {guaranteeDays} dias
              </li>
            )}
            <li>
              <Icon name="zap" size={16} />
              Acesso imediato
            </li>
          </ul>
        ) : null}
        <p className={styles.legal}>
          Ao clicar em {button}, você concorda com os{" "}
          {termsUrl ? (
            <a href={termsUrl} target="_blank" rel="noopener noreferrer">
              termos de compra
            </a>
          ) : (
            "termos de compra"
          )}
          .
        </p>
      </div>
    </CheckoutForm>
  );
}
