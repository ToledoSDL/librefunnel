import { notFound } from "next/navigation";
import { docMarkdown, docSlugs } from "@/lib/llms";

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return docSlugs().map((slug) => ({ file: `${slug}.md` }));
}

export async function GET(...[, { params }]: [Request, RouteContext<"/md/[file]">]) {
  const markdown = await docMarkdown((await params).file.replace(/\.md$/, ""));
  if (!markdown) notFound();

  return new Response(markdown, { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
}
