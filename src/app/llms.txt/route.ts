import { connection } from "next/server";
import { products, settings } from "@/lib/catalog";
import { baseUrl } from "@/lib/guard";
import { offerOpen } from "@/lib/orders/checkout";
import { formatMoney } from "@/format";

// The store as plain Markdown, the format AI assistants read best when they answer about it (https://llmstxt.org).
export async function GET() {
  await connection();
  const [{ brand }, items] = await Promise.all([settings(), products()]);
  const base = baseUrl();

  const lines = [
    `# ${brand}`,
    "",
    `> Loja de ${brand}: produtos digitais com pagamento único por Pix, acesso imediato pela área de membros (${base}/m) e garantia de reembolso.`,
    "",
    "## Produtos",
    "",
    ...items.map(
      (product) =>
        `- [${product.name}](${base}/v/${product.slug}): ${formatMoney(product.price)} no Pix, garantia de ${product.guaranteeDays} dias${offerOpen(product) ? "" : ", inscrições encerradas"}.${product.tagline ? ` ${product.tagline}` : ""}`,
    ),
    ...items
      .filter((product) => product.faq.length)
      .flatMap((product) => [
        "",
        `## Perguntas frequentes: ${product.name}`,
        ...product.faq.flatMap((item) => ["", `### ${item.q}`, "", item.a]),
      ]),
  ];

  return new Response(`${lines.join("\n")}\n`, { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
}
