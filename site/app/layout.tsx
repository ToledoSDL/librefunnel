import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Provider } from "@/components/provider";
import "@fontsource-variable/inter/wght.css";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "./global.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://librefunnel.com"),
  title: {
    default: "LibreFunnel: funil de vendas com Pix no seu servidor, sem taxa por venda",
    template: "%s: LibreFunnel",
  },
  description:
    "Página de vendas com vídeo, checkout Pix, área de membros e recuperação de carrinho num app de código aberto que você instala no seu servidor. Sem taxa por venda.",
  applicationName: "LibreFunnel",
  icons: { icon: "/icon.svg" },
  robots: { index: true, follow: true, googleBot: { "max-image-preview": "large", "max-snippet": -1 } },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "LibreFunnel",
    locale: "pt_BR",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
  },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f4f0" },
    { media: "(prefers-color-scheme: dark)", color: "#141513" },
  ],
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
