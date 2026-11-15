import type { ReactNode } from "react";
import { Avatar } from "@/components/feedback/avatar";
import { Card } from "@/components/layout/card";
import { Row } from "@/components/layout/row";
import { Stack } from "@/components/layout/stack";
import { Text } from "@/components/text/text";
import { settings } from "@/lib/catalog";
import type { Testimonial } from "@/lib/catalog";
import { Logo } from "@/components/media/logo";
import styles from "./buyer.module.css";
import { formatDocument } from "@/format";

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

// Buyer pages show the seller's own mark, never LibreFunnel's.
export async function StoreHeader({ href = "/", children }: { href?: string; children?: ReactNode }) {
  const { brand, logo } = await settings();

  return (
    <header className={styles.header}>
      <a href={href} className={styles.home}>
        {logo ? (
          <img className={styles.logo} src={logo} alt={brand} height={32} />
        ) : (
          <span className={styles.name}>{brand}</span>
        )}
      </a>
      {children}
    </header>
  );
}

export async function Footer() {
  const store = await settings();
  const whatsapp = store.supportWhatsapp?.replace(/\D/g, "");

  const seller = [
    store.legalName ?? store.brand,
    store.document ? `${store.document.length === 14 ? "CNPJ" : "CPF"} ${formatDocument(store.document)}` : undefined,
  ];

  const links = [
    store.supportEmail ? { label: "Suporte", href: `mailto:${store.supportEmail}` } : undefined,
    whatsapp ? { label: "WhatsApp", href: `https://wa.me/${whatsapp}` } : undefined,
    store.privacyUrl ? { label: "Privacidade", href: store.privacyUrl } : undefined,
    store.termsUrl ? { label: "Termos", href: store.termsUrl } : undefined,
  ].filter((link) => link !== undefined);

  return (
    <footer className={styles.footer}>
      <div className={styles.footerRow}>
        <Text variant="body-sm" weight="semibold">
          {seller.filter(Boolean).join(" · ")}
        </Text>
        {links.length ? (
          <nav className={styles.links} aria-label="Contato e políticas">
            {links.map((link) => (
              <a
                key={link.label}
                href={link.href}
                target={link.href.startsWith("mailto:") ? undefined : "_blank"}
                rel="noopener noreferrer"
              >
                {link.label}
              </a>
            ))}
          </nav>
        ) : null}
      </div>
      <Text variant="caption" tone="muted">
        Direito de arrependimento em até 7 dias (CDC, art. 49).
        {store.poweredBy ? (
          <>
            {" "}
            Feito com{" "}
            <a href="https://librefunnel.com" target="_blank" rel="noopener noreferrer">
              LibreFunnel
            </a>
            .
          </>
        ) : null}
      </Text>
    </footer>
  );
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
