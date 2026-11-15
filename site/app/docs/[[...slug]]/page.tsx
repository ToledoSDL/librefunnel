import defaultMdxComponents, { createRelativeLink } from "fumadocs-ui/mdx";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/layouts/docs/page";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { JsonLd } from "@/components/json-ld";
import { source } from "@/lib/source";

export default async function Page(props: PageProps<"/docs/[[...slug]]">) {
  const { slug } = await props.params;
  const page = source.getPage(slug);
  if (!page) notFound();

  const MDX = page.data.body;

  const url = `https://librefunnel.com${page.url}/`;

  return (
    <DocsPage toc={page.data.toc}>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "TechArticle",
              headline: page.data.title,
              description: page.data.description,
              url,
              inLanguage: "pt-BR",
              about: { "@type": "SoftwareApplication", name: "LibreFunnel", url: "https://librefunnel.com/" },
              publisher: { "@type": "Organization", name: "LibreFunnel", url: "https://librefunnel.com/" },
            },
            {
              "@type": "BreadcrumbList",
              itemListElement: [
                { "@type": "ListItem", position: 1, name: "LibreFunnel", item: "https://librefunnel.com/" },
                { "@type": "ListItem", position: 2, name: "Docs", item: "https://librefunnel.com/docs/" },
                { "@type": "ListItem", position: 3, name: page.data.title, item: url },
              ],
            },
          ],
        }}
      />
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX components={{ ...defaultMdxComponents, a: createRelativeLink(source, page) }} />
      </DocsBody>
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: PageProps<"/docs/[[...slug]]">): Promise<Metadata> {
  const { slug } = await props.params;
  const page = source.getPage(slug);
  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
    alternates: { canonical: `${page.url}/` },
    openGraph: {
      type: "article",
      siteName: "LibreFunnel",
      locale: "pt_BR",
      title: `${page.data.title}: LibreFunnel`,
      description: page.data.description,
      url: `${page.url}/`,
      images: [{ url: "/og.png", width: 1200, height: 630 }],
    },
  };
}
