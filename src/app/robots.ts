import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";
import { sellsAt } from "@/lib/catalog/products";
import { baseUrl, hostOf } from "@/lib/guard";

// Checkout and members pages stay crawlable so search engines can read their noindex tag.
export default async function robots(): Promise<MetadataRoute.Robots> {
  await connection();
  const host = hostOf(await headers());
  const site = (await sellsAt(host)) ? `https://${host}` : baseUrl();

  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/api/", "/t"] },
    sitemap: `${site}/sitemap.xml`,
  };
}
