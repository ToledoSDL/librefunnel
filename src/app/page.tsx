import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Button } from "@/components/action/button";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { Row } from "@/components/layout/row";
import { Stack } from "@/components/layout/stack";
import { Text } from "@/components/text/text";
import { products, settings } from "@/lib/catalog";
import { baseUrl } from "@/lib/guard";
import { Footer, JsonLd } from "./buyer";
import styles from "./page.module.css";
import { Money } from "./format";
import { Tracker } from "./track";

export async function generateMetadata(): Promise<Metadata> {
  await connection();
  const store = await settings();
  const brand = store.brand;

  const description =
    store.description ?? `Produtos de ${brand} com pagamento por Pix, acesso imediato e garantia em todos.`;

  return {
    title: brand,
    description,
    alternates: { canonical: "/" },
    openGraph: { type: "website", locale: "pt_BR", siteName: brand, url: "/", title: brand, description },
  };
}

export default async function Home() {
  await connection();
  const [{ brand, home }, items] = await Promise.all([settings(), products()]);
  const start = items.find((product) => product.slug === home);

  if (start) redirect(start.vsl ? `/v/${start.slug}` : `/c/${start.slug}`);

  const base = baseUrl();

  const schema = [
    { "@context": "https://schema.org", "@type": "WebSite", name: brand, url: base, inLanguage: "pt-BR" },
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      itemListElement: items.map((product, index) => ({
        "@type": "ListItem",
        position: index + 1,
        url: `${base}/v/${product.slug}`,
        name: product.name,
      })),
    },
  ];

  return (
    <div className={`surface-experience ${styles.page}`}>
      <Tracker product="" />
      <JsonLd schema={schema} />
      <header className={styles.bar}>
        <Row justify="between" gap={3}>
          <Text as="span" weight="bold">
            {brand}
          </Text>
          <Button href="/m" size="sm">
            Área de membros
          </Button>
        </Row>
      </header>
      <main className={styles.main}>
        <Stack gap={6}>
          <PageHeader title="Nossos produtos" description="Pagamento por Pix, acesso imediato e garantia em todos." />
          {items.length ? (
            <ul className={styles.products}>
              {items.map((product) => {
                const image = product.cover ?? product.banner;
                return (
                  <li key={product.slug}>
                    <a href={product.vsl ? `/v/${product.slug}` : `/c/${product.slug}`} className={styles.product}>
                      {image ? (
                        <img className={styles.thumb} src={image} alt="" width={72} height={72} loading="lazy" />
                      ) : (
                        <span className={styles.thumb} aria-hidden="true" />
                      )}
                      <Stack gap={1}>
                        <Text weight="semibold">{product.name}</Text>
                        {product.tagline ? (
                          <Text variant="body-sm" tone="muted">
                            {product.tagline}
                          </Text>
                        ) : null}
                        <Text weight="semibold">
                          <Money cents={product.price} />
                        </Text>
                      </Stack>
                    </a>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState title="Nenhum produto à venda agora" description="Volte mais tarde ou fale com o vendedor." />
          )}
        </Stack>
      </main>
      <Footer />
    </div>
  );
}
