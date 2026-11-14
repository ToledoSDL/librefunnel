import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { products } from "@/lib/catalog";
import { baseUrl } from "@/lib/guard";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  const base = baseUrl();

  const pages = (await products()).map((product) => {
    const image = product.banner ?? product.cover;

    return { url: `${base}/v/${product.slug}`, images: image ? [new URL(image, base).href] : undefined };
  });

  return [{ url: base }, ...pages];
}
