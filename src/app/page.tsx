import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Button } from "@/components/action/button";
import { EmptyState } from "@/components/feedback/empty-state";
import { Icon } from "@/components/media/icon";
import { products, settings } from "@/lib/catalog";
import type { Product } from "@/lib/catalog";
import { baseUrl } from "@/lib/guard";
import { Footer, JsonLd, StoreHeader } from "./buyer";
import styles from "./page.module.css";
import { Money } from "./format";
import { TrackClick, Tracker } from "./track";

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
        url: `${base}${pageOf(product)}`,
        name: product.name,
      })),
    },
  ];

  const [featured, ...others] = items;

  return (
    <div className={`surface-experience ${styles.page}`}>
      <Tracker product="" />
      <JsonLd schema={schema} />
      <StoreHeader>
        <Button href="/m" size="sm" variant="ghost">
          Área de membros
        </Button>
      </StoreHeader>
      <main className={styles.main}>
        <h1 className="sr-only">{brand}</h1>
        {featured ? (
          <>
            <TrackClick event="store_click" product={featured.slug}>
              <section className={styles.hero}>
                {imageOf(featured) ? (
                  <a href={pageOf(featured)} className={styles.media} tabIndex={-1} aria-hidden="true">
                    <img src={imageOf(featured)} alt="" width={800} height={450} fetchPriority="high" />
                  </a>
                ) : null}
                <div className={styles.offer}>
                  <h2 className={styles.title}>{featured.name}</h2>
                  <p className={styles.price}>
                    <Money cents={featured.price} />
                  </p>
                  <Button href={pageOf(featured)} variant="solid" tone="store" size="lg" block>
                    {featured.vsl ? "Quero conhecer" : "Comprar agora"}
                  </Button>
                  {featured.guaranteeDays ? (
                    <p className={styles.trust}>
                      <Icon name="shield-check" size={16} />
                      Garantia de {featured.guaranteeDays} dias
                    </p>
                  ) : null}
                </div>
              </section>
            </TrackClick>
            {others.length ? (
              <section className={styles.more}>
                <h2 className={styles.moreTitle}>Veja também</h2>
                <ul className={styles.products}>
                  {others.map((product) => (
                    <li key={product.slug}>
                      <TrackClick event="store_click" product={product.slug}>
                        <a href={pageOf(product)} className={styles.product}>
                          {imageOf(product) ? (
                            <img
                              className={styles.thumb}
                              src={imageOf(product)}
                              alt=""
                              width={800}
                              height={450}
                              loading="lazy"
                            />
                          ) : (
                            <span className={styles.thumb} aria-hidden="true" />
                          )}
                          <span className={styles.info}>
                            <span className={styles.name}>{product.name}</span>
                            <strong className={styles.cost}>
                              <Money cents={product.price} />
                            </strong>
                          </span>
                        </a>
                      </TrackClick>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : (
          <EmptyState title="Nenhum produto à venda agora" description="Volte mais tarde ou fale com o vendedor." />
        )}
      </main>
      <Footer />
    </div>
  );
}

function pageOf(product: Product) {
  return product.vsl ? `/v/${product.slug}` : `/c/${product.slug}`;
}

function imageOf(product: Product) {
  return product.cover ?? product.banner;
}
