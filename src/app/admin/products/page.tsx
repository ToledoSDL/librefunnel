import { pick, requireAdmin, type Query } from "../shared";
import { ProductsTab } from "./products-tab";

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Query> }) {
  await requireAdmin();

  const query = await searchParams;

  return (
    <>
      <ProductsTab slug={pick(query.product)} section={pick(query.section)} />
    </>
  );
}
