import { Button } from "@/components/action/button";
import { Tabs } from "@/components/data/tabs";
import { PageHeader } from "@/components/layout/page-header";
import { Icon } from "@/components/media/icon";
import { Badge } from "@/components/text/badge";
import type { Product } from "@/lib/catalog/products";
import { href } from "../shared";
import { CheckoutSection } from "./checkout-section";
import { GeneralSection } from "./general-section";
import { ItemActions } from "./item-actions";
import { ModulesEditor } from "./modules-editor";
import type { FormSection } from "./product-form";
import styles from "./products.module.css";
import { ReviewsSection } from "./reviews-section";
import { SalesSection } from "./sales-section";

type Section = FormSection | "content";

const SECTIONS: { key: Section; label: string }[] = [
  { key: "general", label: "Geral" },
  { key: "sales", label: "Página de vendas" },
  { key: "checkout", label: "Checkout" },
  { key: "content", label: "Conteúdo" },
  { key: "reviews", label: "Perguntas e depoimentos" },
];

export function ProductEditor({
  product,
  others,
  section,
  first,
  last,
}: {
  product: Product;
  others: Product[];
  section: string;
  first: boolean;
  last: boolean;
}) {
  const current = SECTIONS.find((entry) => entry.key === section)?.key ?? "general";
  const page = product.domain ? `https://${product.domain}` : `/v/${product.slug}`;

  const counts: Partial<Record<Section, number>> = {
    content: product.modules.length,
    reviews: product.faq.length + product.testimonials.length,
  };

  return (
    <>
      <div className={styles.head}>
        <div>
          <Button href={href("products")} variant="ghost" size="sm" icon="arrow-left">
            Produtos
          </Button>
        </div>
        <PageHeader
          title={
            <span className={styles.title}>
              {product.cover ? (
                <img className={styles.cover} src={product.cover} alt="" width={48} height={48} />
              ) : (
                <span className={styles.cover} aria-hidden>
                  <Icon name="package" />
                </span>
              )}
              {product.name}
              {product.archived ? <Badge>Arquivado</Badge> : null}
            </span>
          }
          description={
            product.archived
              ? "Fora da loja e do checkout. Para voltar a vender, use Restaurar no menu."
              : `Página em ${page}`
          }
          actions={
            <>
              {product.archived ? null : (
                <span className={styles.wide}>
                  <Button href={page} newTab icon="external-link">
                    Ver página
                  </Button>
                </span>
              )}
              <ItemActions
                kind="product"
                id={product.slug}
                first={first}
                last={last}
                archived={product.archived}
                page={page}
              />
            </>
          }
        />
        <Tabs
          label="Partes do produto"
          items={SECTIONS.map((entry) => ({
            label: entry.label,
            href: href("products", {
              product: product.slug,
              ...(entry.key === "general" ? {} : { section: entry.key }),
            }),
            current: entry.key === current,
            count: counts[entry.key],
          }))}
        />
      </div>
      {current === "general" ? <GeneralSection product={product} /> : null}
      {current === "sales" ? <SalesSection product={product} /> : null}
      {current === "checkout" ? <CheckoutSection product={product} others={others} /> : null}
      {current === "content" ? <ModulesEditor product={product} /> : null}
      {current === "reviews" ? <ReviewsSection product={product} /> : null}
    </>
  );
}
