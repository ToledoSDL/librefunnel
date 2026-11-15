import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { preload } from "react-dom";
import { Disclosure } from "@/components/layout/disclosure";
import { Icon } from "@/components/media/icon";
import { DEFAULT_BAR, getProduct, settings } from "@/lib/catalog";
import type { Product } from "@/lib/catalog";
import { baseUrl } from "@/lib/guard";
import { streamFor } from "@/lib/media";
import { offerOpen } from "@/lib/orders/checkout";
import { Footer, JsonLd, Testimonials } from "@/app/buyer";
import { DateTime, Money } from "@/app/format";
import { TrackClick, Tracker } from "@/app/track";
import { inkFor } from "@/app/color";
import { Countdown } from "./countdown";
import styles from "./page.module.css";
import { VslPlayer } from "./player";
import { StickyOffer } from "./sticky";
import { formatMoney } from "@/format";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function description(product: Product): string {
  return (
    product.tagline ??
    `${product.name}: pagamento único de ${formatMoney(product.price)} no Pix, acesso imediato e garantia de ${product.guaranteeDays} dias.`
  );
}

// Ads add utm and fbclid to this URL, so the canonical drops the query to keep one indexed page per product.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProduct(slug);

  if (!product || product.archived) return {};

  const { brand } = await settings();
  const text = description(product);

  return {
    title: `${product.name} | ${brand}`,
    description: text,
    alternates: { canonical: `/v/${slug}` },
    openGraph: {
      type: "website",
      locale: "pt_BR",
      siteName: brand,
      url: `/v/${slug}`,
      title: product.name,
      description: text,
      images: product.banner ?? product.cover,
    },
  };
}

function schema(product: Product, brand: string, open: boolean): object[] {
  const base = baseUrl();
  const url = `${base}/v/${product.slug}`;
  const image = product.banner ?? product.cover;

  const offer = {
    "@type": "Offer",
    url,
    price: (product.price / 100).toFixed(2),
    priceCurrency: "BRL",
    availability: open ? "https://schema.org/InStock" : "https://schema.org/SoldOut",
    priceValidUntil: product.offerEndsAt?.toISOString().slice(0, 10),
    seller: { "@type": "Organization", name: brand, url: base },
    hasMerchantReturnPolicy: {
      "@type": "MerchantReturnPolicy",
      applicableCountry: "BR",
      returnPolicyCategory: "https://schema.org/MerchantReturnFiniteReturnWindow",
      merchantReturnDays: product.guaranteeDays,
      returnFees: "https://schema.org/FreeReturn",
    },
  };

  const faq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: product.faq.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };

  return [
    {
      "@context": "https://schema.org",
      "@type": "Product",
      name: product.name,
      description: description(product),
      url,
      image: image ? new URL(image, base).href : undefined,
      brand: { "@type": "Brand", name: brand },
      offers: offer,
    },
    ...(open && product.faq.length ? [faq] : []),
  ];
}

function ctaText(product: Product) {
  return product.vsl?.ctaText ?? "Sim, quero começar agora";
}

function Buy({ product, href }: { product: Product; href: string }) {
  return (
    <>
      <p className={styles.price}>
        <span className={styles.priceLabel}>Pagamento único de</span>
        <strong>
          <Money cents={product.price} />
        </strong>
        <span className={styles.priceLabel}>à vista no Pix, sem mensalidade</span>
      </p>

      <TrackClick event="cta_click" product={product.slug}>
        <a className={styles.cta} href={href}>
          <span>
            {ctaText(product)}
            <small>Acesso liberado assim que o Pix cai</small>
          </span>
          <Icon name="arrow-right" />
        </a>
      </TrackClick>

      <p className={styles.reassure}>
        <Icon name="lock" size={16} />
        Pagamento seguro por Pix · Garantia de {product.guaranteeDays} dias
      </p>
    </>
  );
}

function Offer({ product, href }: { product: Product; href: string }) {
  const days = product.guaranteeDays;

  return (
    <div className={styles.offer} id="oferta">
      <div className={styles.offerHead}>
        {product.cover ? <img src={product.cover} alt="" width={64} height={64} /> : null}
        <p>
          <span>Você vai receber</span>
          <strong>{product.name}</strong>
        </p>
      </div>

      <ul className={styles.includes}>
        {product.modules.map((module) => (
          <li key={module.id}>
            <Icon name="check" size={16} />
            <span>
              {module.title}
              <small>
                {module.lessons.length} {module.lessons.length === 1 ? "aula" : "aulas"}
              </small>
            </span>
          </li>
        ))}
        <li>
          <Icon name="check" size={16} />
          <span>Acesso à área de membros, com o link no seu e-mail</span>
        </li>
        <li>
          <Icon name="check" size={16} />
          <span>Garantia de {days} dias com o valor inteiro de volta</span>
        </li>
      </ul>

      <Buy product={product} href={href} />

      {product.offerEndsAt ? (
        <p className={styles.deadline}>
          Esta condição vale até <DateTime at={product.offerEndsAt} />
        </p>
      ) : null}
    </div>
  );
}

export default async function SalesPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const product = await getProduct(slug);

  if (!product || product.archived) notFound();

  const query = new URLSearchParams(
    Object.entries(await searchParams).flatMap(([key, value]) =>
      (Array.isArray(value) ? value : value === undefined ? [] : [value]).map((item) => [key, item]),
    ),
  ).toString();

  const href = `/c/${slug}${query ? `?${query}` : ""}`;
  const { brand } = await settings();
  const open = offerOpen(product);
  const days = product.guaranteeDays;
  const video = product.vsl?.video;
  const ctaSeconds = product.vsl?.ctaSeconds ?? 0;
  const delayed = Boolean(video) && ctaSeconds > 0;

  const poster = product.banner ?? product.cover;
  // The poster is the largest paint, and the browser only finds it once the player's markup is parsed.
  if (video && poster) preload(poster, { as: "image", fetchPriority: "high" });

  const bar = open ? product.bar : undefined;
  const barColor = bar?.color ?? DEFAULT_BAR;

  return (
    <div className={`surface-experience ${styles.page}`}>
      <Tracker product={slug} />
      <JsonLd schema={schema(product, brand, open)} />
      {bar ? (
        <div className={styles.bar} style={{ background: barColor, color: inkFor(barColor) }}>
          <p>{bar.text}</p>
          {product.offerEndsAt ? (
            <Countdown
              endsAt={product.offerEndsAt.toISOString()}
              seconds={Math.max(0, Math.ceil((product.offerEndsAt.getTime() - Date.now()) / 1000))}
            />
          ) : null}
        </div>
      ) : null}
      <main className={styles.main}>
        <header className={styles.hero}>
          <h1 className={styles.headline}>{product.name}</h1>
          {product.tagline ? <p className={styles.sub}>{product.tagline}</p> : null}
        </header>

        {video ? (
          <VslPlayer
            product={slug}
            src={video}
            stream={await streamFor(video)}
            poster={poster}
            title={product.name}
            captions={product.vsl?.captions}
            ctaSeconds={ctaSeconds}
            ctaText={ctaText(product)}
            href={href}
            options={product.player}
            triggers={product.triggers}
            icons={{
              sound: <Icon name="volume-x" />,
              play: <Icon name="play" />,
              restart: <Icon name="rotate-ccw" />,
              expand: <Icon name="maximize" />,
              close: <Icon name="x" />,
              captions: <Icon name="captions" />,
            }}
          />
        ) : product.banner ? (
          <img className={styles.poster} src={product.banner} alt="" width={880} height={495} fetchPriority="high" />
        ) : null}

        {open ? null : (
          <p className={styles.closed} role="status">
            As inscrições para {product.name} estão encerradas. Fale com o vendedor para saber da próxima turma.
          </p>
        )}

        {open ? (
          <div className={`${styles.below} ${delayed ? styles.later : ""}`}>
            <Offer product={product} href={href} />

            <section className={styles.guarantee}>
              <div className={styles.seal} aria-hidden>
                <strong>{days}</strong>
                <span>dias</span>
              </div>
              <div>
                <h2 className={styles.guaranteeTitle}>Garantia incondicional de {days} dias</h2>
                <p className={styles.text}>
                  Entre, assista e aplique. Se não for para você, peça o reembolso em até {days} dias e o valor volta
                  inteiro, sem perguntas.
                </p>
              </div>
            </section>

            {product.testimonials.length ? (
              <section className={styles.section}>
                <h2 className={styles.title}>Quem já fez</h2>
                <div className={styles.testimonials}>
                  <Testimonials items={product.testimonials} />
                </div>
              </section>
            ) : null}

            {product.faq.length ? (
              <section className={styles.section}>
                <h2 className={styles.title}>Perguntas frequentes</h2>
                <div className={styles.faq}>
                  {product.faq.map((item) => (
                    <Disclosure key={item.q} label={item.q}>
                      <p className={styles.text}>{item.a}</p>
                    </Disclosure>
                  ))}
                </div>
              </section>
            ) : null}

            <section className={`${styles.section} ${styles.closing}`}>
              <h2 className={styles.title}>Comece hoje</h2>
              <Buy product={product} href={href} />
            </section>

            <StickyOffer product={slug}>
              <span className={styles.stickyPrice}>
                <Money cents={product.price} />
                <small>no Pix</small>
              </span>
              <TrackClick event="cta_click" product={slug}>
                <a className={styles.stickyCta} href={href}>
                  Quero agora
                </a>
              </TrackClick>
            </StickyOffer>
          </div>
        ) : null}
      </main>
      <Footer />
    </div>
  );
}
