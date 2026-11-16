import { writeFileSync } from "node:fs";
import { icons as logos } from "@iconify-json/logos";
import { icons as lucide } from "@iconify-json/lucide";
import { icons as simpleIcons } from "@iconify-json/simple-icons";
import type { IconifyJSON } from "@iconify/types";

// The icons the store draws. A name missing here fails the typecheck where it is used: add it and run `bun run icons`.
const LUCIDE = [
  "arrow-down",
  "arrow-left",
  "arrow-right",
  "arrow-up",
  "arrow-up-down",
  "arrow-up-circle",
  "badge-check",
  "captions",
  "check",
  "check-check",
  "chevron-down",
  "chevron-left",
  "chevron-right",
  "circle",
  "circle-alert",
  "circle-check",
  "clock",
  "copy",
  "download",
  "ellipsis",
  "external-link",
  "eye",
  "inbox",
  "info",
  "layout-dashboard",
  "lock",
  "log-out",
  "mail",
  "maximize",
  "menu",
  "monitor",
  "moon",
  "package",
  "pencil",
  "play",
  "plug",
  "plus",
  "qr-code",
  "receipt",
  "rotate-ccw",
  "send-horizontal",
  "settings",
  "shield-check",
  "sun",
  "tag",
  "trash-2",
  "triangle-alert",
  "user-round",
  "volume-2",
  "volume-x",
  "workflow",
  "x",
  "zap",
];

// Brands without a full-color logo, drawn in one color.
const BRANDS = ["pix", "brevo"];

// Full-color brand logos, drawn in their own colors on a light tile.
const LOGOS = [
  "google-gmail",
  "whatsapp-icon",
  "meta-icon",
  "cloudflare-icon",
  "tiktok-icon",
  "google-ads",
  "google-analytics",
  "google-search-console",
  "mailjet-icon",
];

function bodies(set: IconifyJSON, names: string[]): Record<string, string> {
  const body = (name: string): string => {
    const icon = set.icons[name];
    if (icon) return icon.body;
    const parent = set.aliases?.[name]?.parent;
    if (!parent) throw new Error(`${set.prefix} has no icon named ${name}`);
    return body(parent);
  };

  return Object.fromEntries(names.map((name) => [name, body(name)]));
}

// Logos keep their own proportions, so each carries its box for the viewBox.
function sized(set: IconifyJSON, names: string[]): Record<string, { body: string; width: number; height: number }> {
  const drawn = bodies(set, names);

  return Object.fromEntries(
    names.map((name) => [
      name,
      {
        body: drawn[name] ?? "",
        width: set.icons[name]?.width ?? set.width ?? 24,
        height: set.icons[name]?.height ?? set.height ?? 24,
      },
    ]),
  );
}

writeFileSync(
  "src/components/media/icon-set.ts",
  `// Written by \`bun run icons\` (docs/icons.ts): only the Lucide icons, Simple Icons and full-color logos the store draws.
export const LUCIDE = ${JSON.stringify(bodies(lucide, LUCIDE))} as const;

export const SIMPLE_ICONS = ${JSON.stringify(bodies(simpleIcons, BRANDS))} as const;

export const LOGOS = ${JSON.stringify(sized(logos, LOGOS))} as const;
`,
);
