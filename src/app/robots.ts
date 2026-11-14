import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { baseUrl } from "@/lib/guard";

// Checkout and members pages stay crawlable so search engines can read their noindex tag.
export default async function robots(): Promise<MetadataRoute.Robots> {
  await connection();
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/api/", "/t"] },
    sitemap: `${baseUrl()}/sitemap.xml`,
  };
}
