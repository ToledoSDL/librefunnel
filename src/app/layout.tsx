import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { settings } from "@/lib/catalog";
import { DemoBanner } from "@/components/feedback/demo-banner";
import { baseUrl, demoMode } from "@/lib/guard";
import { inkFor } from "./color";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
// Only the Pix code and admin fields use it, so it never competes with the first paint.
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", preload: false });

export async function generateMetadata(): Promise<Metadata> {
  const store = await settings();

  return {
    metadataBase: new URL(baseUrl()),
    title: store.brand,
    description: store.description,
    openGraph: store.shareImage ? { images: store.shareImage } : undefined,
    icons: store.icon ? { icon: store.icon } : undefined,
    formatDetection: { telephone: false, email: false, address: false },
    twitter: { card: "summary_large_image" },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f4f0" },
    { media: "(prefers-color-scheme: dark)", color: "#141513" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const theme = (await cookies()).get("lf_theme")?.value;
  const { accent } = await settings();

  return (
    <html
      lang="pt-BR"
      className={`${inter.variable} ${jetbrains.variable}`}
      data-theme={theme === "light" || theme === "dark" ? theme : undefined}
    >
      <head>
        {accent ? <style>{`:root{--store-accent:${accent};--store-accent-ink:${inkFor(accent)}}`}</style> : null}
      </head>
      <body>
        {demoMode() ? <DemoBanner /> : null}
        {children}
      </body>
    </html>
  );
}
