import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";
import { products } from "@/lib/catalog/products";
import { baseUrl, hostOf, siteOf } from "@/lib/guard";

// Search engines take only the sitemap's own host, so each product domain lists its product and the store the rest.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  const [items, request] = await Promise.all([products(), headers()]);
  const host = hostOf(request);
  const own = items.filter((product) => product.domain === host);
  const listed = own.length ? own : items.filter((product) => !product.domain);

  const pages = listed.map((product) => {
    const base = siteOf(product);
    const image = product.banner ?? product.cover;

    return { url: `${base}/v/${product.slug}`, images: image ? [new URL(image, base).href] : undefined };
  });

  return own.length ? pages : [{ url: baseUrl() }, ...pages];
}
