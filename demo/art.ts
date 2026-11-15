import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OUT = join(import.meta.dirname, "media");
const SERIF = "Fraunces";
const SANS = "'Inter 18pt', Inter, sans-serif";
const HAND = "Caveat";

const INK = "#3a2219";
const SOFT_INK = "#7a4a3a";
const PAPER = "#fffaf1";
const CREAM = "#f7ecd7";
const CAKE = "#6e3d28";
const CRUMB = "#4f2a1b";
const BRIGADEIRO = "#4a2418";
const SPRINKLE = "#2c140c";
const NINHO = "#fbf3e2";
const STRAWBERRY = "#d6455d";
const SEED = "#f6d9a8";
const LEAF = "#5f8a4f";
const PEN = "#c8283f";
const ACCENT = "#a8324a";
const PINK = "#f2d4cc";
const PINK_TABLE = "#e8bfb4";
const SAGE = "#dde5d2";
const SAGE_TABLE = "#c9d5bb";
const BUTTER = "#f2e3b6";

let seed = 7;

function random(): number {
  seed = (seed * 16807) % 2147483647;
  return seed / 2147483647;
}

let ids = 0;

function svg(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;
}

function text(x: number, y: number, size: number, content: string, attrs = ""): string {
  return `<text x="${x}" y="${y}" font-size="${size}" ${attrs}>${content}</text>`;
}

function backdrop(width: number, height: number, wall: string, table: string, horizon: number): string {
  return `<rect width="${width}" height="${height}" fill="${wall}"/><rect y="${horizon}" width="${width}" height="${height - horizon}" fill="${table}"/>`;
}

function wavy(x0: number, x1: number, y: number, amp: number, waves: number): string {
  const step = (x1 - x0) / waves;
  let path = `M${x0} ${y}`;
  for (let index = 0; index < waves; index += 1) {
    const start = x0 + step * index;
    path += ` Q${start + step / 2} ${y + (index % 2 === 0 ? -amp : amp)} ${start + step} ${y}`;
  }
  return path;
}

type Layer = { kind: "cake" | "brigadeiro" | "ninho" | "morango"; height: number };

function jar(
  cx: number,
  bottom: number,
  width: number,
  height: number,
  layers: Layer[],
  topping: "sprinkles" | "strawberry",
  lid?: string,
): string {
  const id = `jar${(ids += 1)}`;
  const left = cx - width / 2;
  const top = bottom - height;
  const fillTop = bottom - height * layers.reduce((sum, layer) => sum + layer.height, 0);
  const radius = width * 0.14;
  const shapes: string[] = [];
  let y = fillTop;

  for (const layer of layers) {
    const layerHeight = height * layer.height;
    const color = { cake: CAKE, brigadeiro: BRIGADEIRO, ninho: NINHO, morango: NINHO }[layer.kind];
    shapes.push(`<path d="${wavy(left, left + width, y, height * 0.018, 6)} V${bottom} H${left} Z" fill="${color}"/>`);
    if (layer.kind === "cake")
      for (let index = 0; index < 22; index += 1)
        shapes.push(
          `<circle cx="${left + random() * width}" cy="${y + 8 + random() * (layerHeight - 14)}" r="${1.5 + random() * 2.5}" fill="${CRUMB}" opacity=".7"/>`,
        );
    if (layer.kind === "morango")
      for (let index = 0; index < 5; index += 1) {
        const px = left + width * (0.08 + index * 0.21) + random() * 10;
        const py = y + layerHeight * (0.35 + random() * 0.35);
        const size = width * 0.07;
        shapes.push(
          `<path d="M${px - size} ${py} a${size} ${size} 0 0 1 ${size * 2} 0 Z" fill="${STRAWBERRY}" transform="rotate(${random() * 40 - 20} ${px} ${py})"/>`,
        );
      }
    y += layerHeight;
  }

  if (topping === "sprinkles")
    for (let index = 0; index < 34; index += 1) {
      const sx = left + 10 + random() * (width - 20);
      const sy = fillTop + 4 + random() * height * 0.05;
      shapes.push(
        `<rect x="${sx}" y="${sy}" width="${width * 0.035}" height="${width * 0.012}" rx="${width * 0.006}" fill="${SPRINKLE}" transform="rotate(${random() * 180} ${sx} ${sy})"/>`,
      );
    }

  const berry = topping === "strawberry" ? strawberry(cx + width * 0.08, fillTop - width * 0.1, 160, width / 300) : "";

  return `<g>
    <ellipse cx="${cx}" cy="${bottom + 6}" rx="${width * 0.62}" ry="${width * 0.07}" fill="${INK}" opacity=".12"/>
    <clipPath id="${id}"><rect x="${left}" y="${top}" width="${width}" height="${height}" rx="${radius}"/></clipPath>
    <rect x="${left}" y="${top}" width="${width}" height="${height}" rx="${radius}" fill="#fff" opacity=".45"/>
    <g clip-path="url(#${id})">${shapes.join("")}</g>
    ${berry}
    <rect x="${left + width * 0.1}" y="${top + height * 0.16}" width="${width * 0.06}" height="${height * 0.62}" rx="${width * 0.03}" fill="#fff" opacity=".4"/>
    <rect x="${left}" y="${top}" width="${width}" height="${height}" rx="${radius}" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="3"/>
    ${
      lid
        ? `<rect x="${left - width * 0.04}" y="${top - height * 0.1}" width="${width * 1.08}" height="${height * 0.12}" rx="${width * 0.04}" fill="${lid}"/>
          <rect x="${left - width * 0.04}" y="${top - height * 0.015}" width="${width * 1.08}" height="${height * 0.035}" fill="${INK}" opacity=".15"/>`
        : ""
    }
  </g>`;
}

const BRIGADEIRO_JAR: Layer[] = [
  { kind: "brigadeiro", height: 0.14 },
  { kind: "cake", height: 0.2 },
  { kind: "brigadeiro", height: 0.14 },
  { kind: "cake", height: 0.42 },
];

const NINHO_JAR: Layer[] = [
  { kind: "ninho", height: 0.12 },
  { kind: "cake", height: 0.18 },
  { kind: "morango", height: 0.2 },
  { kind: "cake", height: 0.4 },
];

function spoon(x: number, y: number, angle: number, scale: number): string {
  return `<g transform="translate(${x} ${y}) rotate(${angle}) scale(${scale})" fill="#b9b2a8">
    <ellipse cx="0" cy="0" rx="34" ry="24"/>
    <rect x="26" y="-6" width="170" height="12" rx="6"/>
    <ellipse cx="-4" cy="-4" rx="20" ry="11" fill="#d9d4cc"/>
  </g>`;
}

function strawberry(x: number, y: number, angle: number, scale: number): string {
  return `<g transform="translate(${x} ${y}) rotate(${angle}) scale(${scale})">
    <path d="M-34 -10 C-34 -40 34 -40 34 -10 C30 22 8 44 0 46 C-8 44 -30 22 -34 -10Z" fill="${STRAWBERRY}"/>
    ${[
      [-14, -6],
      [6, -12],
      [18, 4],
      [-4, 10],
      [-18, 14],
      [8, 24],
    ]
      .map(([sx, sy]) => `<ellipse cx="${sx}" cy="${sy}" rx="2.4" ry="3.6" fill="${SEED}"/>`)
      .join("")}
    <path d="M-26 -30 L-12 -24 L-6 -40 L4 -26 L18 -36 L22 -22 L30 -26 L20 -14 H-18Z" fill="${LEAF}"/>
  </g>`;
}

function courseCover(): string {
  return svg(
    1280,
    720,
    `${backdrop(1280, 720, PINK, PINK_TABLE, 520)}
    ${jar(470, 560, 190, 270, NINHO_JAR, "strawberry", "#f4f0e8")}
    ${jar(700, 600, 250, 360, BRIGADEIRO_JAR, "sprinkles", ACCENT)}
    ${spoon(930, 600, -18, 1)}
    ${strawberry(340, 640, -24, 1.1)}
    ${strawberry(990, 520, 20, 0.9)}`,
  );
}

function courseBanner(): string {
  return svg(
    1280,
    400,
    `${backdrop(1280, 400, PINK, PINK_TABLE, 330)}
    <g font-family="${SERIF}" fill="${INK}">${text(96, 180, 104, "Bolo no pote", 'font-weight="600" letter-spacing="-0.5"')}</g>
    <g font-family="${SANS}" fill="${SOFT_INK}">${text(100, 246, 38, "da receita à primeira venda", 'font-weight="500"')}</g>
    ${jar(820, 350, 130, 190, NINHO_JAR, "strawberry", "#f4f0e8")}
    ${jar(990, 360, 160, 230, BRIGADEIRO_JAR, "sprinkles", ACCENT)}
    ${jar(1150, 350, 130, 190, NINHO_JAR, "strawberry", "#f4f0e8")}`,
  );
}

function courseModuleOne(): string {
  const crumbs = Array.from(
    { length: 120 },
    () =>
      `<circle cx="${110 + random() * 500}" cy="${130 + random() * 380}" r="${1.5 + random() * 3}" fill="${CRUMB}" opacity=".6"/>`,
  ).join("");

  const disc = (x: number, y: number) =>
    `<circle cx="${x + 6}" cy="${y + 10}" r="74" fill="${INK}" opacity=".14"/><circle cx="${x}" cy="${y}" r="74" fill="${CAKE}"/><circle cx="${x}" cy="${y}" r="70" fill="none" stroke="${CRUMB}" stroke-width="6" opacity=".5"/>`;

  return svg(
    720,
    1000,
    `<rect width="720" height="1000" fill="${CREAM}"/>
    <rect x="96" y="124" width="552" height="430" rx="26" fill="${INK}" opacity=".14"/>
    <rect x="84" y="104" width="552" height="430" rx="26" fill="#a7a097"/>
    <rect x="104" y="124" width="512" height="390" rx="12" fill="${CAKE}"/>
    ${crumbs}
    <circle cx="230" cy="250" r="74" fill="#8d867c"/>
    <circle cx="400" cy="250" r="74" fill="#8d867c"/>
    <circle cx="510" cy="400" r="80" fill="#fff" opacity=".3"/>
    <circle cx="510" cy="400" r="80" fill="none" stroke="#fff" stroke-width="10" opacity=".8"/>
    <circle cx="510" cy="400" r="68" fill="none" stroke="#fff" stroke-width="3" opacity=".6"/>
    ${disc(200, 650)}
    ${disc(370, 690)}`,
  );
}

function bowl(cx: number, cy: number, radius: number, filling: string, extras: string): string {
  return `<g>
    <circle cx="${cx + 8}" cy="${cy + 12}" r="${radius + 18}" fill="${INK}" opacity=".12"/>
    <circle cx="${cx}" cy="${cy}" r="${radius + 18}" fill="${PAPER}"/>
    <circle cx="${cx}" cy="${cy}" r="${radius + 4}" fill="#ece3d2"/>
    <circle cx="${cx}" cy="${cy}" r="${radius}" fill="${filling}"/>
    ${extras}
  </g>`;
}

function courseModuleTwo(): string {
  const sprinkles = Array.from({ length: 40 }, () => {
    const angle = random() * Math.PI * 2;
    const distance = Math.sqrt(random()) * 100;
    const sx = 230 + Math.cos(angle) * distance;
    const sy = 230 + Math.sin(angle) * distance;
    return `<rect x="${sx}" y="${sy}" width="12" height="4" rx="2" fill="${SPRINKLE}" transform="rotate(${random() * 180} ${sx} ${sy})"/>`;
  }).join("");

  const halves = [
    [450, 470, 0],
    [520, 440, 60],
    [500, 520, 140],
    [430, 540, 220],
    [560, 500, 300],
  ]
    .map(
      ([x = 0, y = 0, angle = 0]) =>
        `<g transform="translate(${x} ${y}) rotate(${angle})"><path d="M-26 0 C-26 -26 26 -26 26 0 C22 22 6 34 0 34 C-6 34 -22 22 -26 0Z" fill="${STRAWBERRY}"/><path d="M-16 0 C-16 -14 16 -14 16 0 C12 14 4 20 0 20 C-4 20 -12 14 -16 0Z" fill="#f08a9a"/></g>`,
    )
    .join("");

  const powder = Array.from({ length: 30 }, () => {
    const angle = random() * Math.PI * 2;
    const distance = Math.sqrt(random()) * 90;
    return `<circle cx="${250 + Math.cos(angle) * distance}" cy="${600 + Math.sin(angle) * distance}" r="${2 + random() * 3}" fill="#e8dcc4"/>`;
  }).join("");

  return svg(
    720,
    1000,
    `<rect width="720" height="1000" fill="${PINK}"/>
    ${bowl(230, 230, 120, BRIGADEIRO, sprinkles)}
    ${bowl(495, 495, 110, NINHO, halves)}
    ${bowl(250, 600, 100, NINHO, powder)}
    ${spoon(560, 200, 130, 0.9)}`,
  );
}

function phone(
  x: number,
  y: number,
  messages: { from: "buyer" | "seller"; lines: string[] }[],
  header: string,
): string {
  let cursor = 150;

  const bubbles = messages
    .map((message) => {
      const height = 26 + message.lines.length * 34;
      const width = Math.max(...message.lines.map((line) => line.length)) * 14.5 + 40;
      const bx = message.from === "buyer" ? 30 : 400 - 30 - width;

      const bubble = `<rect x="${bx}" y="${cursor}" width="${width}" height="${height}" rx="18" fill="${message.from === "buyer" ? "#ffffff" : "#d9f2cf"}"/>
        ${message.lines.map((line, index) => text(bx + 20, cursor + 42 + index * 34, 25, line, `fill="${INK}"`)).join("")}`;

      cursor += height + 20;
      return bubble;
    })
    .join("");

  return `<g transform="translate(${x} ${y})" font-family="${SANS}">
    <rect x="-14" y="-14" width="428" height="748" rx="58" fill="${INK}"/>
    <rect width="400" height="720" rx="46" fill="#efe7da"/>
    <rect width="400" height="110" rx="46" fill="#f9f4ec"/>
    <rect y="60" width="400" height="50" fill="#f9f4ec"/>
    <circle cx="60" cy="74" r="24" fill="${PINK_TABLE}"/>
    ${text(98, 84, 26, header, `font-weight="600" fill="${INK}"`)}
    ${bubbles}
  </g>`;
}

function courseModuleThree(): string {
  return svg(
    720,
    1000,
    `${backdrop(720, 1000, SAGE, SAGE_TABLE, 760)}
    ${phone(
      160,
      70,
      [
        { from: "buyer", lines: ["Oi! Tem bolo no", "pote hoje?"] },
        { from: "seller", lines: ["Tem sim: brigadeiro", "e ninho com morango.", "R$ 12 cada."] },
        { from: "buyer", lines: ["Quero 2 de ninho,", "busco às 18h"] },
      ],
      "Confeitaria da Lia",
    )}`,
  );
}

type Row = [string, string, string];

const COST_ROWS: Row[] = [
  ["Massa de chocolate", "80 g", "R$ 1,10"],
  ["Recheio de brigadeiro", "90 g", "R$ 1,85"],
  ["Pote, tampa e colher", "1", "R$ 1,20"],
  ["Gás e energia", "", "R$ 0,35"],
];

function sheet(x: number, y: number, scale: number): string {
  const rowHeight = 64;

  const rows = COST_ROWS.map(
    ([item, amount, cost], index) => `<g transform="translate(0 ${120 + index * rowHeight})">
      ${index % 2 ? `<rect width="840" height="${rowHeight}" fill="#f6f1e6"/>` : ""}
      ${text(32, 42, 26, item, `fill="${INK}"`)}
      ${text(560, 42, 26, amount, `fill="${SOFT_INK}" text-anchor="end"`)}
      ${text(808, 42, 26, cost, `fill="${INK}" text-anchor="end"`)}
    </g>`,
  ).join("");

  const totalY = 120 + COST_ROWS.length * rowHeight;

  return `<g transform="translate(${x} ${y}) scale(${scale})" font-family="${SANS}">
    <rect x="10" y="14" width="840" height="560" rx="20" fill="${INK}" opacity=".14"/>
    <rect width="840" height="560" rx="20" fill="${PAPER}"/>
    <path d="M0 20 a20 20 0 0 1 20 -20 H820 a20 20 0 0 1 20 20 V64 H0Z" fill="#2f6b46"/>
    ${text(32, 43, 24, "Custo por pote · brigadeiro 250 ml", 'fill="#fff" font-weight="600"')}
    <rect y="64" width="840" height="56" fill="#e3ecdd"/>
    ${text(32, 100, 20, "ITEM", `fill="#2f6b46" font-weight="700" letter-spacing="1.5"`)}
    ${text(560, 100, 20, "QTD.", `fill="#2f6b46" font-weight="700" letter-spacing="1.5" text-anchor="end"`)}
    ${text(808, 100, 20, "CUSTO", `fill="#2f6b46" font-weight="700" letter-spacing="1.5" text-anchor="end"`)}
    ${rows}
    <path d="M0 ${totalY} H840" stroke="${INK}" stroke-width="2"/>
    ${text(32, totalY + 44, 26, "Custo total", `fill="${INK}" font-weight="700"`)}
    ${text(808, totalY + 44, 26, "R$ 4,50", `fill="${INK}" font-weight="700" text-anchor="end"`)}
    <rect x="24" y="${totalY + 72}" width="380" height="96" rx="14" fill="#2f6b46"/>
    ${text(48, totalY + 106, 20, "PREÇO DO POTE", 'fill="#cfe5d4" font-weight="700" letter-spacing="1.5"')}
    ${text(48, totalY + 150, 40, "R$ 12,00", 'fill="#fff" font-weight="700"')}
    <g transform="translate(436 ${totalY + 72})">
      ${text(0, 34, 20, "LUCRO POR POTE", `fill="${SOFT_INK}" font-weight="700" letter-spacing="1.5"`)}
      ${text(0, 78, 40, "R$ 7,50", `fill="${INK}" font-weight="700"`)}
      ${text(372, 34, 20, "MARGEM", `fill="${SOFT_INK}" font-weight="700" letter-spacing="1.5" text-anchor="end"`)}
      ${text(372, 78, 40, "62,5%", `fill="${INK}" font-weight="700" text-anchor="end"`)}
    </g>
  </g>`;
}

function sheetCover(): string {
  return svg(1280, 720, `${backdrop(1280, 720, SAGE, SAGE_TABLE, 560)}${sheet(220, 80, 1)}`);
}

function sheetModule(): string {
  return svg(720, 1000, `${backdrop(720, 1000, SAGE, SAGE_TABLE, 640)}${sheet(40, 170, 0.76)}`);
}

const MENU = [
  { name: "Bolo no pote de brigadeiro", price: "R$ 8" },
  { name: "Ninho com morango", price: "R$ 9" },
  { name: "Prestígio", price: "R$ 8" },
];

function menu(x: number, y: number, scale: number, angle: number, notes: boolean): string {
  const items = MENU.map(
    (entry, index) => `<g transform="translate(0 ${200 + index * 92})">
      ${text(48, 0, 30, entry.name, `font-family="${SANS}" fill="${INK}"`)}
      <path d="M48 22 H552" stroke="${INK}" stroke-opacity=".15" stroke-width="2" stroke-dasharray="2 8" stroke-linecap="round"/>
      ${text(552, 0, 30, entry.price, `font-family="${SANS}" font-weight="700" fill="${INK}" text-anchor="end"`)}
    </g>`,
  ).join("");

  const pen = notes
    ? `<g fill="none" stroke="${PEN}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
        <ellipse cx="524" cy="190" rx="54" ry="34" transform="rotate(-6 524 190)"/>
        <ellipse cx="524" cy="282" rx="54" ry="34" transform="rotate(4 524 282)"/>
        <path d="M44 376 C160 372 250 380 330 372"/>
        <path d="M40 470 C140 478 230 476 300 470"/>
        <path d="M584 186 C620 170 640 160 668 150"/>
        <path d="M584 284 C624 290 648 296 672 302"/>
      </g>
      <g font-family="${HAND}" fill="${PEN}" font-weight="700">
        ${text(620, 130, 44, "custa 4,50!")}
        ${text(676, 186, 50, "R$ 12")}
        ${text(686, 318, 50, "R$ 13")}
        ${text(330, 420, 40, "tira: vende pouco")}
        ${text(320, 520, 40, "link do WhatsApp")}
      </g>`
    : "";

  return `<g transform="translate(${x} ${y}) rotate(${angle}) scale(${scale})">
    <rect x="12" y="16" width="600" height="560" rx="6" fill="${INK}" opacity=".14"/>
    <rect width="600" height="560" rx="6" fill="${PAPER}"/>
    <rect x="20" y="20" width="560" height="520" rx="2" fill="none" stroke="${ACCENT}" stroke-opacity=".35" stroke-width="2"/>
    ${text(300, 104, 54, "Doces da Carol", `font-family="${SERIF}" font-weight="600" fill="${INK}" text-anchor="middle"`)}
    ${text(300, 140, 20, "CARDÁPIO DA SEMANA", `font-family="${SANS}" font-weight="600" letter-spacing="3" fill="${SOFT_INK}" text-anchor="middle"`)}
    ${items}
    ${text(48, 470, 26, "Encomendas pelo direct", `font-family="${SANS}" fill="${SOFT_INK}"`)}
    ${pen}
  </g>`;
}

function marker(x: number, y: number, angle: number): string {
  return `<g transform="translate(${x} ${y}) rotate(${angle})">
    <rect x="12" y="8" width="300" height="40" rx="20" fill="${INK}" opacity=".12"/>
    <rect width="300" height="40" rx="20" fill="#f4f0e8"/>
    <rect x="200" width="100" height="40" rx="20" fill="${PEN}"/>
    <path d="M0 8 L-36 20 L0 32Z" fill="#f4f0e8"/>
    <path d="M-26 16 L-40 20 L-26 24Z" fill="${PEN}"/>
  </g>`;
}

function mentoringCover(): string {
  return svg(
    1280,
    720,
    `<rect width="1280" height="720" fill="${BUTTER}"/>
    ${menu(300, 80, 0.95, -2, true)}
    ${marker(1010, 600, -28)}`,
  );
}

function meetingOne(): string {
  return svg(
    720,
    1000,
    `<rect width="720" height="1000" fill="${BUTTER}"/>${menu(36, 110, 0.84, -3, true)}${marker(470, 720, -28)}`,
  );
}

function tag(x: number, y: number, angle: number, label: string, price: string, fix: string): string {
  return `<g transform="translate(${x} ${y}) rotate(${angle}) scale(1.1)">
    <path d="M14 14 H290 a16 16 0 0 1 16 16 V194 a16 16 0 0 1 -16 16 H14 L-60 112Z" fill="${INK}" opacity=".12"/>
    <path d="M0 0 H280 a16 16 0 0 1 16 16 V180 a16 16 0 0 1 -16 16 H0 L-74 98Z" fill="${PAPER}"/>
    <circle cx="-30" cy="98" r="12" fill="${BUTTER}"/>
    ${text(24, 60, 24, label, `font-family="${SANS}" font-weight="600" fill="${SOFT_INK}"`)}
    ${text(24, 140, 64, price, `font-family="${SANS}" font-weight="700" fill="${INK}"`)}
    <path d="M14 116 L196 132" stroke="${PEN}" stroke-width="7" stroke-linecap="round"/>
    ${text(150, 186, 62, fix, `font-family="${HAND}" font-weight="700" fill="${PEN}"`)}
  </g>`;
}

function meetingTwo(): string {
  return svg(
    720,
    1000,
    `<rect width="720" height="1000" fill="${BUTTER}"/>
    ${tag(190, 120, 8, "Brigadeiro", "R$ 8", "R$ 12")}
    ${tag(170, 400, -6, "Ninho com morango", "R$ 9", "R$ 13")}`,
  );
}

function meetingThree(): string {
  const orders = [
    ["Sex", "6 brigadeiro", "Ana"],
    ["Sex", "4 ninho com morango", "Bruno"],
    ["Sáb", "10 brigadeiro", "Festa da Clara"],
    ["Sáb", "3 ninho com morango", "Diego"],
  ]
    .map(
      ([day, order, buyer], index) => `<g transform="translate(0 ${190 + index * 82})">
        ${text(44, 0, 24, day ?? "", `font-weight="700" fill="${SOFT_INK}"`)}
        ${text(110, 0, 27, order ?? "", `fill="${INK}"`)}
        ${text(110, 34, 21, buyer ?? "", `fill="${SOFT_INK}"`)}
        <path d="M454 -16 l12 12 22 -24" fill="none" stroke="${PEN}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
      </g>`,
    )
    .join("");

  return svg(
    720,
    1000,
    `<rect width="720" height="1000" fill="${BUTTER}"/>
    <g transform="translate(90 70) rotate(2)" font-family="${SANS}">
      <rect x="12" y="16" width="540" height="560" rx="8" fill="${INK}" opacity=".12"/>
      <rect width="540" height="560" rx="8" fill="${PAPER}"/>
      <rect width="540" height="22" rx="8" fill="${ACCENT}"/>
      ${text(44, 104, 46, "Encomendas", `font-family="${SERIF}" font-weight="600" fill="${INK}"`)}
      ${text(46, 140, 20, "FECHA NA QUINTA, 20H", `font-weight="600" letter-spacing="2" fill="${SOFT_INK}"`)}
      ${orders}
    </g>`,
  );
}

type Slide = { name: string; seconds: number; art: string };

function slides(): Slide[] {
  const heading = (y: number, line: string, size = 76) =>
    text(
      640,
      y,
      size,
      line,
      `font-family="${SERIF}" font-weight="600" fill="${INK}" text-anchor="middle" letter-spacing="-0.5"`,
    );

  const sub = (y: number, line: string) =>
    text(640, y, 34, line, `font-family="${SANS}" font-weight="500" fill="${SOFT_INK}" text-anchor="middle"`);

  const thumb = (art: string, x: number, label: string) => {
    const id = `thumb${(ids += 1)}`;
    return `<g transform="translate(${x} 150)">
      <clipPath id="${id}"><rect width="288" height="400" rx="16"/></clipPath>
      <g clip-path="url(#${id})"><svg width="288" height="400" viewBox="0 0 720 1000">${inner(art)}</svg></g>
      ${text(144, 450, 28, label, `font-family="${SANS}" font-weight="600" fill="${INK}" text-anchor="middle"`)}
    </g>`;
  };

  return [
    {
      name: "hook",
      seconds: 5,
      art: svg(
        1280,
        720,
        `${backdrop(1280, 720, PINK, PINK_TABLE, 560)}
        ${text(96, 250, 80, "Bolo no pote", `font-family="${SERIF}" font-weight="600" fill="${INK}" letter-spacing="-0.5"`)}
        ${text(96, 340, 80, "que vende toda", `font-family="${SERIF}" font-weight="600" fill="${INK}" letter-spacing="-0.5"`)}
        ${text(96, 430, 80, "semana.", `font-family="${SERIF}" font-weight="600" fill="${INK}" letter-spacing="-0.5"`)}
        ${jar(900, 600, 250, 360, BRIGADEIRO_JAR, "sprinkles", ACCENT)}
        ${jar(1130, 590, 170, 250, NINHO_JAR, "strawberry", "#f4f0e8")}`,
      ),
    },
    {
      name: "title",
      seconds: 3.5,
      art: svg(
        1280,
        720,
        `${backdrop(1280, 720, PINK, PINK_TABLE, 490)}<g transform="translate(0 160)">${inner(courseBanner())}</g>`,
      ),
    },
    {
      name: "modules",
      seconds: 3.5,
      art: svg(
        1280,
        720,
        `<rect width="1280" height="720" fill="${CREAM}"/>
        ${heading(100, "Três módulos, acesso na hora", 56)}
        ${thumb(courseModuleOne(), 168, "Massa e montagem")}
        ${thumb(courseModuleTwo(), 496, "Recheios")}
        ${thumb(courseModuleThree(), 824, "Vender pelo WhatsApp")}`,
      ),
    },
    {
      name: "bump",
      seconds: 5,
      art: svg(
        1280,
        720,
        `${backdrop(1280, 720, SAGE, SAGE_TABLE, 600)}
        ${heading(100, "No checkout: a Planilha de Preço", 56)}
        ${sub(152, "por R$ 19,90")}
        ${sheet(350, 210, 0.69)}`,
      ),
    },
    {
      name: "guarantee",
      seconds: 3.5,
      art: svg(
        1280,
        720,
        `<rect width="1280" height="720" fill="${CREAM}"/>${heading(340, "7 dias de garantia", 96)}${sub(420, "Não serviu para você? Peça o reembolso.")}`,
      ),
    },
    {
      name: "cta",
      seconds: 3.5,
      art: svg(
        1280,
        720,
        `<rect width="1280" height="720" fill="${ACCENT}"/>
        ${text(640, 330, 120, "R$ 97 no Pix", `font-family="${SERIF}" font-weight="600" fill="#fff" text-anchor="middle" letter-spacing="-0.5"`)}
        ${text(640, 420, 36, "Clique no botão abaixo do vídeo.", `font-family="${SANS}" font-weight="500" fill="#f6d6dc" text-anchor="middle"`)}
        <path d="M640 480 V560 M610 530 L640 560 L670 530" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
      ),
    },
  ];
}

function inner(art: string): string {
  return art.replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
}

const IMAGES: Record<string, () => string> = {
  "course-cover": courseCover,
  "course-banner": courseBanner,
  "course-module-1": courseModuleOne,
  "course-module-2": courseModuleTwo,
  "course-module-3": courseModuleThree,
  "sheet-cover": sheetCover,
  "sheet-module": sheetModule,
  "mentoring-cover": mentoringCover,
  "mentoring-meeting-1": meetingOne,
  "mentoring-meeting-2": meetingTwo,
  "mentoring-meeting-3": meetingThree,
};

const work = mkdtempSync(join(tmpdir(), "librefunnel-art-"));

function png(name: string, art: string): string {
  const source = join(work, `${name}.svg`);
  const target = join(work, `${name}.png`);
  writeFileSync(source, art);
  execFileSync("rsvg-convert", ["-o", target, source]);
  return target;
}

try {
  for (const [name, draw] of Object.entries(IMAGES))
    execFileSync("ffmpeg", [
      "-loglevel",
      "error",
      "-y",
      "-i",
      png(name, draw()),
      "-c:v",
      "libwebp",
      "-quality",
      "86",
      join(OUT, `${name}.webp`),
    ]);

  const frames = slides();
  const fade = 0.4;

  const inputs = frames.flatMap((frame, index) => [
    "-loop",
    "1",
    "-t",
    String(frame.seconds + (index < frames.length - 1 ? fade : 0)),
    "-i",
    png(frame.name, frame.art),
  ]);

  let chain = "";
  let offset = 0;
  let last = "[0:v]";
  for (let index = 1; index < frames.length; index += 1) {
    offset += frames[index - 1]?.seconds ?? 0;
    chain += `${last}[${index}:v]xfade=transition=fade:duration=${fade}:offset=${offset}[v${index}];`;
    last = `[v${index}]`;
  }
  execFileSync("ffmpeg", [
    "-loglevel",
    "error",
    "-y",
    ...inputs,
    "-filter_complex",
    `${chain}${last}format=yuv420p[out]`,
    "-map",
    "[out]",
    "-r",
    "30",
    "-c:v",
    "libx264",
    "-tune",
    "stillimage",
    "-crf",
    "26",
    "-movflags",
    "+faststart",
    join(OUT, "vsl-demo.mp4"),
  ]);
} finally {
  rmSync(work, { recursive: true });
}
