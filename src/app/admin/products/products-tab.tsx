import { products } from "@/lib/catalog";
import { ProductEditor } from "./product-editor";
import { ProductList } from "./product-list";

export async function ProductsTab({ slug, section }: { slug: string; section: string }) {
  const items = await products(true);
  const index = items.findIndex((item) => item.slug === slug);
  const product = items[index];

  if (!product) return <ProductList items={items} />;

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
