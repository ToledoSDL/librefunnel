import { credentials, products, storePix } from "@/lib/catalog";
import { PIX_PROVIDERS, pixProvider } from "@/lib/orders/psp";
import { ProductEditor } from "./product-editor";
import { ProductList } from "./product-list";

export async function ProductsTab({ slug, section }: { slug: string; section: string }) {
  const [items, account, stored] = await Promise.all([products(true), storePix(), credentials("pix")]);
  const provider = pixProvider(stored("pix")("provider")) ?? "static";
  const name = PIX_PROVIDERS.find((entry) => entry.id === provider)?.name ?? "";
  const index = items.findIndex((item) => item.slug === slug);
  const product = items[index];

  if (!product) return <ProductList items={items} payment={{ provider, name, account }} />;

  return (
    <ProductEditor
      product={product}
      others={items.filter((item) => item.slug !== slug && !item.archived)}
      section={section}
      first={index === 0}
      last={index === items.length - 1}
    />
  );
}
