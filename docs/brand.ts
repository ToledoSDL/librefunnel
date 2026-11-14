import { readFileSync, writeFileSync } from "node:fs";
import { LOGO } from "../src/components/media/logo";

const css = readFileSync("src/app/globals.css", "utf8");

function token(name: string): { light: string; dark: string } {
  const match = css.match(new RegExp(`--${name}: light-dark\\((#[0-9a-f]{6}), (#[0-9a-f]{6})\\)`));

  if (!match?.[1] || !match[2]) throw new Error(`globals.css has no hex light-dark() for --${name}`);

  return { light: match[1], dark: match[2] };
}

const primary = token("primary");
const bg = token("bg");
const surface = token("surface");
const border = token("border");
const text = token("text");
const muted = token("text-muted");
const font = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const tagline = "Your whole online sales funnel, self-hosted and fee-free.";
const features = ["VSL", "Pix checkout", "Order bump", "Members area", "Cart recovery", "Attribution", "Dashboard"];

function mark(color = "", transform = ""): string {
  const { cx, cy, r } = LOGO.dot;

  return [
    `<g${transform ? ` transform="${transform}"` : ""}${color ? ` fill="${color}" stroke="${color}"` : ""}>`,
    `  <path d="${LOGO.ring}" fill="none" stroke-width="${LOGO.stroke}" stroke-linecap="round"/>`,
    `  <circle cx="${cx}" cy="${cy}" r="${r}" stroke="none"/>`,
    `</g>`,
  ].join("\n");
}

// Follows the OS theme where the SVG is shown (browser tab, GitHub, an <img>).
function adaptive(size: number, label: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${LOGO.viewBox}" role="img" aria-label="${label}">
<title>LibreFunnel</title>
<style>g { fill: ${primary.light}; stroke: ${primary.light}; } @media (prefers-color-scheme: dark) { g { fill: ${primary.dark}; stroke: ${primary.dark}; } }</style>
${mark()}
</svg>
`;
}

function avatar(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 64 64" role="img" aria-label="LibreFunnel">
<title>LibreFunnel</title>
<rect width="64" height="64" fill="${primary.light}"/>
${mark("#ffffff", "translate(10 10) scale(0.8462) translate(-6 -5)")}
</svg>
`;
}

function wordmark(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="340" height="80" viewBox="0 0 340 80" role="img" aria-label="LibreFunnel">
<title>LibreFunnel</title>
<style>g { fill: ${primary.light}; stroke: ${primary.light}; } text { fill: ${text.light}; } @media (prefers-color-scheme: dark) { g { fill: ${primary.dark}; stroke: ${primary.dark}; } text { fill: ${text.dark}; } }</style>
${mark("", "translate(2 10) scale(1.1538) translate(-6 -5)")}
<text x="78" y="55" font-family="${font}" font-size="42" font-weight="700" letter-spacing="-1.2">LibreFunnel</text>
</svg>
`;
}

function banner(theme: "light" | "dark"): string {
  const widths = features.map((feature) => Math.round(feature.length * 9 + 40));
  const gap = 12;
  let x = (1280 - (widths.reduce((sum, width) => sum + width, 0) + gap * (features.length - 1))) / 2;

  const pills = features.map((feature, index) => {
    const width = widths[index] ?? 0;
    const pill = `<rect x="${x + 0.5}" y="296.5" width="${width}" height="40" rx="20"/><text x="${x + width / 2 + 0.5}" y="322" stroke="none" fill="${text[theme]}">${feature}</text>`;

    x += width + gap;

    return pill;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="400" viewBox="0 0 1280 400" role="img" aria-labelledby="lf-t lf-d">
<title id="lf-t">LibreFunnel</title>
<desc id="lf-d">${tagline} ${features.join(", ")}.</desc>
<rect width="1280" height="400" rx="24" fill="${bg[theme]}"/>
<rect x=".5" y=".5" width="1279" height="399" rx="23.5" fill="none" stroke="${border[theme]}"/>
${mark(primary[theme], "translate(608 62) scale(1.2308) translate(-6 -5)")}
<g font-family="${font}" text-anchor="middle">
<text x="640" y="202" font-size="60" font-weight="700" letter-spacing="-1.8" fill="${text[theme]}">LibreFunnel</text>
<text x="640" y="254" font-size="25" fill="${muted[theme]}">${tagline}</text>
<g font-size="17" font-weight="600" fill="${surface[theme]}" stroke="${border[theme]}">
${pills.join("\n")}
</g>
</g>
</svg>
`;
}

const files = {
  "src/app/icon.svg": adaptive(32, "LibreFunnel"),
  "docs/site/icon.svg": adaptive(32, "LibreFunnel"),
  "docs/logo.svg": adaptive(64, "LibreFunnel logo"),
  "docs/avatar.svg": avatar(),
  "docs/wordmark.svg": wordmark(),
  "docs/banner-light.svg": banner("light"),
  "docs/banner-dark.svg": banner("dark"),
};

for (const [path, svg] of Object.entries(files)) writeFileSync(path, svg);
