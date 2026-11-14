# Design system

How LibreFunnel screens are built. Read sections 1 to 4 before building or changing a screen and run the checklist in section 8 before you hand it over. Read sections 5 to 7 before creating or changing a component. Where this file and `AGENTS.md` disagree, `AGENTS.md` wins.

## 1. Thesis

LibreFunnel has two audiences and they want opposite things.

- **The buyer** is on a phone, came from an ad, and is deciding whether to trust a stranger with a Pix. Their screens are calm, roomy and single-purpose: one decision per screen, the price and the action always visible, nothing that looks like a template.
- **The seller** opens the dashboard several times a day to answer three questions: did I sell, is anything broken, who do I need to release. Their screens are dense and quiet: the number, the state and the action readable in one glance.

Both share one rule: **every pixel has to carry information.** Decoration (gradients on UI, glows, colored shadows, oversized empty headers, cards inside cards) is not part of this product.

**Controls adapt to the input, not to the viewport.** A finger needs a 44 px target and a mouse is fine with 32 px; that difference comes from `--tap-min` and `--density`, which switch on `(pointer: coarse)`. Breakpoints only change page layout (how many columns), at `480 / 640 / 768 / 1024 / 1280`. Nothing important exists only on hover.

## 2. Building a screen

Screens compose components from `src/components`. A screen never styles a component from outside; when a screen needs something no component expresses (a hand-drawn chart, a fixed media size), it gets a CSS Module next to the page, using tokens only.

### 2.1 Skeleton

| Need               | Use                                                 | Note                                           |
| ------------------ | --------------------------------------------------- | ---------------------------------------------- |
| page title         | `PageHeader` with `title`, `description`, `actions` | exactly one per screen                         |
| vertical rhythm    | `Stack` with `gap`                                  | spacing comes from the gap, never from margins |
| horizontal line-up | `Row` (`justify="between"` for title plus action)   |                                                |
| panel              | `Card` with `title`, `actions` props                | do not hand-write card headers                 |
| text               | `Text` with `variant` and `tone`                    | no bare `p`, `span`, `h2` in screens           |
| list of records    | `Table`, or rows inside a `Card`                    |                                                |
| loading            | a placeholder in the shape of the content           | never a blank area or a lone spinner           |
| nothing yet        | `EmptyState` with the action that fills it          |                                                |

Reading width is capped with `--measure`; admin content is capped at `--content-max` and centered. Wide content scrolls inside its own box. The page never scrolls sideways.

### 2.2 Text hierarchy

| Content                                                    | `Text` variant          |
| ---------------------------------------------------------- | ----------------------- |
| the number a panel exists for (net revenue, amount to pay) | `metric`                |
| card title                                                 | `Card` `title` prop     |
| names, messages, descriptions                              | `body`                  |
| label of a number, supporting line                         | `body-sm`, tone `muted` |
| dates, counts, ids                                         | `caption`, tone `muted` |

Anything the person must read to act (the Pix expiry, why an order cannot be released) is never `caption`.

### 2.3 Color means something

| Tone                         | Means                           | Examples here                             |
| ---------------------------- | ------------------------------- | ----------------------------------------- |
| `primary`                    | the action, or what is selected | Comprar agora, active tab, links          |
| `success`                    | done, money in                  | Pago, connected channel, revenue delta up |
| `warning`                    | needs the person now            | Aguardando Pix, WhatsApp disconnected     |
| `danger`                     | failed, money out, destructive  | Reembolsado, message failed, Archive      |
| neutral (`default`, `muted`) | plain data                      | visitors, counts, dates, product names    |

The test: if this color disappeared, would someone miss a state? If not, it is neutral. Metrics are never colored to stand out ("37 visitantes" in green reads like a success state); emphasis comes from size and weight. `primary` belongs to the main action of a block, so it keeps its pull.

### 2.4 Buttons by role

`Button` has `variant` (`solid`, `soft`, `outline`, `ghost`) and `tone` (`primary`, `neutral`, `danger`).

| Role                                             | Variant and tone                         |
| ------------------------------------------------ | ---------------------------------------- |
| the action this block exists for (one per block) | `solid primary`                          |
| secondary action with text                       | `outline neutral`                        |
| destructive (archive, refund)                    | `soft danger`, confirmed in a `Dialog`   |
| icon-only action in a dense row                  | `ghost` with `iconOnly` and `aria-label` |

`soft neutral` and `ghost` with text disappear on `--surface`; inside a `Card`, a secondary text button is `outline`. A label says what happens right away: a button that only opens a picker is "Escolher produto", not "Adicionar". Async buttons show progress and stay disabled until the server answers.

### 2.5 Navigation inside a screen

- Admin sections are routes in the sidebar. `Tabs` switch between panels inside one screen. One level only.
- `SegmentedControl` switches a mode or a small filter of 2 to 5 options (7, 30, 90 dias).
- `Select` for longer choices.
- One way to filter a list. If the tab already splits it, the filter does not repeat it. "Todos" is first and the default. A filter option exists only when there is data behind it, and shows its count.
- Controls that sit side by side share the same `size`.

### 2.6 Rows and records

- Type and state are a `Badge` with text, never a gray word next to the name and never a colored dot alone.
- The leading avatar or icon identifies the record (buyer initials, channel icon). An icon that repeats on every row is noise: drop it.
- Money aligns right, with tabular numbers; the date goes under it as `caption`.
- A row shows what helps decide and the action. Everything else lives in the detail view.
- The state most records have (a paid order in a list of paid orders) is not a badge; the badge marks the exception.

### 2.7 Real data, not the mock

- Build against what a new store actually has: zero orders, zero visitors, no WhatsApp. A row of eight KPIs that are all R$ 0,00 is the default experience, so design that first.
- Zero counts disappear instead of saying "0 mensagens". A panel with nothing in it collapses to one line or to its `EmptyState`.
- A number appears once per screen.
- No metric acronyms in visible text ("conversão", not "CR"; "Meta", not "CAPI").
- A number always has its label ("12 pedidos aguardando", not "12").

### 2.8 Phones

Every screen is checked at 390 px before it ships.

- Grids that collapse to one column become rows: a full-width cover per item makes every item a whole screen.
- Text buttons in dense rows become `iconOnly` on coarse pointers.
- Check the narrowest card with the longest content (long product name, every badge, the button). Nothing leaves its box.
- Buyer inputs are 16 px so iOS Safari does not zoom.

### 2.9 Charts

All charts are the `Chart` component: inline SVG, no chart library. Bars for revenue per day, a line for the share of plays still watching the sales video, a horizontal funnel for steps. The screen passes data and formatters; the component draws axis, grid, tooltip and a table fallback for screen readers. Series colors come from `--chart-1` to `--chart-6` in order; status colors never paint a series. A single number is not a chart: it is a `Stat`.

### 2.10 Errors, blocks and feedback

- Never hide a feature because it is empty. If something is blocked, the reason sits next to the control with the action that unblocks it.
- Error text names the concrete cause and the fix (from `ERROR_TEXT`), never a generic "Algo deu errado".
- Confirmation only after the server confirms. Queued work says it is queued ("Na fila de envio").
- Long forms get a `SaveBar` that appears only with unsaved changes. Settings are `SettingRow` lines, not one card per setting.
- At most one `Alert` on a screen, and only for something broken right now. Setup tasks live in the overview `Checklist`, not in banners.

## 3. Surfaces

| Surface    | Screens                   | Theme                                                                        |
| ---------- | ------------------------- | ---------------------------------------------------------------------------- |
| Buyer      | checkout, Pix page        | light by default; the seller picks dark or the buyer's device setting        |
| Experience | VSL, members area         | dark, always                                                                 |
| Admin      | everything under `/admin` | light by default, dark through `prefers-color-scheme` or `data-theme="dark"` |

**Checkout.** One column on phones; form plus a sticky order summary from 768 px. Order: product, an optional one-line notice, contact (name, e-mail, WhatsApp, prefilled from `?name=&email=&phone=`), payment, order bump, total, buy button, a quiet trust line, the implicit terms sentence, then the guarantee box and testimonials. Field errors inline. Every block after the form, the countdown, the buy button text and the appearance are store settings in Configurações > Checkout, which edits them next to a live preview.

**Pix page.** Status, amount and expiry first. On phones the copy-and-paste code comes before the QR (people pay from the same phone); on desktop the QR comes first. Three short steps. The page updates by itself; when paid, the main action is entering the members area, with at most one extra button the seller configures (group, next offer).

**VSL.** The video is the page, edge to edge on phones, in the store color only. An optional top bar (text and color per product) shows a countdown only to the real `offerEndsAt`; no countdowns that are not real. Headline above the video and nothing else until the offer opens. The player has no seeking and pauses on tap; each product turns on in `/admin` the smart autoplay ("Seu vídeo já começou", a tap restarts from zero with sound), continue or restart on a return visit, the buy button inside the video, the floating player while scrolling, speed control, captions (.vtt), timed texts and buttons over the video, and a front-loaded progress bar (off by default). The offer opens at the configured second of listened video and then stays: an offer card listing what is included, then guarantee, testimonials, FAQ and a closing price with the button. The sticky bar on phones shows only after the first offer scrolls past. The admin shows the per-second retention curve of the video.

**Members area.** A shelf per product with module covers and progress, "Continuar" to the next lesson, a lesson page with the player, the lesson list and the next step.

**Admin overview.** While setup is incomplete, a `Checklist` card is first: ordered steps (store identity, delivery e-mail, Pix, first product, archiving the demo products, then WhatsApp as recommended and Meta as optional). The first unfinished required step is open with why it matters and the form or connection row that completes it in place; finished steps collapse with a check. Progress counts required steps only. Once those are done it shrinks to a "Loja pronta para vender" line with the remaining steps, and it disappears when everything is done. Then net revenue as the lead `Stat` with at most three supporting stats, the revenue chart, the funnel, sales by source and the orders that need release.

## 4. Writing on screen

- pt-BR, sentence case, second person ("Você").
- Buttons name the effect ("Liberar pedido", "Enviar teste").
- Money as `R$ 1.234,56`, dates as `14/11, 15:30`, in America/Sao_Paulo.
- No environment variable names, provider jargon or acronyms in the UI: "provedor de Pix", "e-mail", "Meta".
- Demo content is labeled as demo. No invented testimonials or numbers.

## 5. Tokens

Closed set: use them, do not add raw values. No hex, `rgb()`, raw `px` font sizes or external fonts in components or screens. A missing token is a design system change, made here first.

```
surface   --bg --surface --surface-2 --hover-surface --scrim
border    --border --border-strong
text      --text --text-muted --text-faint
tones     --primary --success --warning --danger, each with -hover -fg -soft
media     --media-bg --media-fg (VSL and lessons, any theme)
chart     --chart-1 .. --chart-6
shadow    --shadow-1 (cards, light theme only) --shadow-2 (overlays) --focus-ring
space     --space-1 .. --space-8 (4 px steps up to 48 px) --gutter
radius    --radius-sm 6px --radius-md 8px --radius-lg 12px --radius-full
type      --text-xs 12 --text-sm 14 --text-md 16 --text-lg 18 --text-xl 20 --text-2xl 24 --text-3xl 30 --text-4xl 40
          --leading-tight --leading-normal --font-sans --font-mono
width     --content-max 1200px --measure 68ch
motion    --dur-fast 120ms --dur-med 200ms --ease-out
input     --tap-min --density
```

| Token                          | Light                         | Dark                              |
| ------------------------------ | ----------------------------- | --------------------------------- |
| `--bg`                         | `#f5f4f0`                     | `#141513`                         |
| `--surface`                    | `#ffffff`                     | `#1c1d1a`                         |
| `--surface-2`                  | `#ecebe7`                     | `#252722`                         |
| `--border`                     | `#dedcd6`                     | `#343630`                         |
| `--text`                       | `#181917`                     | `#f0f0eb`                         |
| `--text-muted`                 | `#686b64`                     | `#a1a49b`                         |
| `--primary` / `-hover` / `-fg` | `#254ccb` / `#1d3da8` / white | `#8ca5ff` / `#a8baff` / `#141513` |
| `--success` / `-soft`          | `#1f7a4d` / `#e5f2ea`         | `#7ccf9f` / `#1d2a21`             |
| `--warning` / `-soft`          | `#94580a` / `#f7eedc`         | `#e2b35c` / `#2c2619`             |
| `--danger` / `-soft`           | `#b42d22` / `#f9e7e4`         | `#f08a7e` / `#2e1d1a`             |

Neutrals are warm off-whites and warm darks (no pure black): white surfaces are reserved for content, forms and tables on the off-white canvas. Blue is the logo's color and is reserved for the action; green is money in. Warning is ochre and danger is brick, so no stock framework color is used. Chart series share one lightness. Tokens are written with `light-dark()` in `src/app/globals.css`.

| Input-driven token | Mouse         | Finger        |
| ------------------ | ------------- | ------------- |
| `--tap-min`        | 32px          | 44px          |
| `--density`        | 1             | 1.15          |
| `--hover-surface`  | `--surface-2` | `transparent` |

Text pairs meet WCAG AA in both themes. Fonts: Inter and JetBrains Mono through `next/font` (self-hosted at build time).

## 6. Components

Inventory, grouped by file. Before creating one, look here; an insufficient component is extended, not duplicated.

One component per file, grouped by responsibility: `src/components/<group>/<name>.tsx` with a sibling `<name>.module.css`.

| Folder in `src/components` | Components                                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `layout/`                  | `PageHeader`, `Stack`, `Row`, `Card`, `Disclosure`                                                          |
| `text/`                    | `Text`, `TextLink`, `Badge`, `Stat`                                                                         |
| `action/`                  | `Button`, `Menu`, `CopyField`, `ThemeMenu`                                                                  |
| `form/`                    | `Field`, `Input`, `MoneyInput`, `Textarea`, `Select`, `Switch`, `SegmentedControl`, `SaveBar`, `SettingRow` |
| `overlay/`                 | `Dialog`                                                                                                    |
| `data/`                    | `Table`, `Chart`, `Pagination`, `Tabs`                                                                      |
| `feedback/`                | `Alert`, `EmptyState`, `Progress`, `Checklist`, `Avatar`                                                    |
| `media/`                   | `Icon`, `BrandLogo`, `VideoPlayer`, `Cover`                                                                 |

Interactive components (`Dialog`, `Menu`, `Select`, `Switch`) are built on Ariakit. A client component never imports `media/icon.tsx` or `media/brand-logo.tsx` (they load whole icon sets): the server side renders icons and button looks and passes them in as props. Icons come from the Iconify Lucide set by name (`<Icon name="chevron-right" />`), 16 px in rows, 20 px in buttons, always next to text or with an `aria-label`. Platform logos come from `BrandLogo` (Simple Icons, or the official file in `public/brands/`). Components exist only while a screen uses them; add one back to its folder when a screen needs it.

## 7. CSS

- Layer order declared once in `src/app/globals.css`: `@layer reset, tokens, base, components, screens;`. Every CSS Module wraps its rules in `@layer components` (components) or `@layer screens` (page modules).
- Nest rules inside their parent (`&:hover`, `& .icon`, media queries inside the rule).
- Hover only inside `@media (any-hover: hover)`, painting `--hover-surface`.
- Every clickable thing: `min-height: max(var(--tap-min), 2.25rem)` and padding scaled by `--density`.
- Focus: `:focus-visible` with `--focus-ring`. State through ARIA (`aria-current`, `aria-selected`, `aria-expanded`), not color only.
- Motion uses `--dur-*` and `--ease-out`, and everything respects `prefers-reduced-motion`.

## 8. Checklist before handing over a screen

- [ ] At most one `solid primary` button per block.
- [ ] Every color passes the 2.3 test; metrics are neutral.
- [ ] Type and state are `Badge`s with text; the majority state has no badge.
- [ ] Zeros and empty panels handled for a brand-new store; no number repeated.
- [ ] Loading has a placeholder in the shape of the content; empty has an `EmptyState` with an action.
- [ ] At most one `Alert`; setup lives in the `Checklist`.
- [ ] Checked at 390 px: nothing leaves its box, dense rows use icon buttons.
- [ ] No raw color, size or spacing values; all text through `Text`.
- [ ] Nothing from "What this product does not look like" below.

## What this product does not look like

The reference is a tool people use every day and trust with money, not a landing page template.

- No gradients on UI, gradient text, glassmorphism, glows, blurred blobs, emoji icons or sparkle icons. The logo is flat blue: an open ring with a dot entering it. Its shape lives in `src/components/media/logo.tsx` and its colors in `globals.css`; `bun run brand` (`docs/brand.ts`) writes every logo file from those two, so no logo SVG is edited by hand.
- Not everything is a card. Tables and lists sit on the page; a card groups one topic.
- No decorative badges, pills or icons. No three-column "icon, title, description" grids. No stock illustrations or placeholder copy.
- Hierarchy through size, weight and position before color.
