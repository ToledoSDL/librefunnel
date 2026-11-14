import { Avatar } from "@/components/feedback/avatar";
import { Card } from "@/components/layout/card";
import { Row } from "@/components/layout/row";
import { Stack } from "@/components/layout/stack";
import { Text } from "@/components/text/text";
import { settings } from "@/lib/catalog";
import type { Testimonial } from "@/lib/catalog";
import { Logo } from "@/components/media/logo";
import styles from "./buyer.module.css";

// Escaping "<" keeps a product name like "</script>" from closing the tag.
export function JsonLd({ schema }: { schema: object[] }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, "\\u003c") }}
    />
  );
}

export async function StoreMark() {
  const { brand, logo } = await settings();

  if (logo) return <img className={styles.logo} src={logo} alt={brand} height={32} />;

  return (
    <span className={styles.mark}>
      <Logo />
      <span>{brand}</span>
    </span>
  );
}

export async function Footer() {
  const store = await settings();
  const whatsapp = store.supportWhatsapp?.replace(/\D/g, "");
  const seller = [store.legalName, store.document ? documentLabel(store.document) : undefined].filter(Boolean);

  return (
    <footer className={styles.footer}>
      <Stack gap={2}>
        {store.supportEmail || whatsapp ? (
          <Row gap={3}>
            {store.supportEmail ? <a href={`mailto:${store.supportEmail}`}>{store.supportEmail}</a> : null}
            {whatsapp ? (
              <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener noreferrer">
                Suporte no WhatsApp
              </a>
            ) : null}
          </Row>
        ) : null}
        <Text variant="caption" tone="muted">
          {seller.length ? seller.join(" · ") : store.brand} · pagamento por Pix
        </Text>
        <Text variant="caption" tone="muted">
          Seus dados servem só para entregar o seu acesso. Direito de arrependimento: art. 49 do CDC.
          {store.privacyUrl ? (
            <>
              {" "}
              <a href={store.privacyUrl} target="_blank" rel="noopener noreferrer">
                Política de privacidade
              </a>
            </>
          ) : null}
        </Text>
        {store.poweredBy ? (
          <Text variant="caption" tone="muted">
            Feito com{" "}
            <a href="https://github.com/ToledoSDL/librefunnel" target="_blank" rel="noopener noreferrer">
              LibreFunnel
            </a>
          </Text>
        ) : null}
      </Stack>
    </footer>
  );
}

function documentLabel(digits: string) {
  return digits.length === 14
    ? `CNPJ ${digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")}`
    : `CPF ${digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4")}`;
}
export function Testimonials({ items }: { items: Testimonial[] }) {
  return items.map((item) => (
    <Card key={`${item.name}${item.text}`}>
      <Row gap={3}>
        <Avatar name={item.name} />
        <Stack gap={1}>
          <Text weight="semibold">{item.name}</Text>
          <Text variant="caption" tone="muted">
            Nota {Math.max(0, Math.min(5, Math.round(item.stars)))} de 5
          </Text>
        </Stack>
      </Row>
      <Text>{item.text}</Text>
    </Card>
  ));
}
