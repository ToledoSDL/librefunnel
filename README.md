<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/banner-dark.svg">
    <img alt="LibreFunnel" src="docs/banner-light.svg" width="100%">
  </picture>
</p>

<p align="center">
  <a href="https://github.com/ToledoSDL/librefunnel/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/ToledoSDL/librefunnel/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-254ccb"></a>
  <img alt="Next.js 16" src="https://img.shields.io/badge/Next.js-16-111827?logo=nextdotjs&logoColor=white">
</p>

# LibreFunnel

A free, self-hosted sales funnel for Brazilian infoproduct sellers: sales page, Pix checkout, members area, recovery and analytics in one app.

## Why

Selling a course online usually means paying monthly for a page builder, a checkout, a members area, a cart recovery tool and an attribution tracker, plus a fee on every sale. LibreFunnel does all of it in one app that runs on a free server. Pix goes straight to your own key, so there is no fee unless you turn on automatic confirmation.

## Features

- **Sales page (VSL)**: video with the buy button revealed at the second you choose, offer deadline, guarantee, testimonials and FAQ.
- **Pix checkout**: paid straight to your Pix key at zero fees, or confirmed automatically through Mercado Pago (0.99% per sale, CPF or CNPJ), Woovi or AbacatePay (from R$ 0.80 per Pix, CNPJ only).
- **Order bump**: an extra product offered on the checkout.
- **Members area**: modules, lessons and progress. Buyers sign in with a magic link sent by e-mail, no passwords.
- **Abandoned checkout recovery**: by e-mail (any SMTP, such as a free Gmail app password) and by WhatsApp (self-hosted Evolution API, optional). It stops when the buyer pays or opts out, and WhatsApp messages never go out between 21:00 and 09:00.
- **WhatsApp auto-replies**: keyword answers, with opt-out when the buyer replies `SAIR`.
- **Attribution**: UTMs with first and last touch, and sales sent to Meta through the Conversions API.
- **Admin dashboard**: revenue, funnel, sources, orders with release and refund, messages, connections and CSV export. Products, course content, automations, e-mail, Pix providers and Meta are set up there too, each connection with a **Testar** button, and changes apply instantly.

## Install

You need a Linux server (x64 or arm64) with a public IP and ports 80 and 443 open. The free [Oracle Cloud Always Free](https://www.oracle.com/cloud/free/) tier works well. Connect to it over SSH and run:

```sh
curl -fsSL https://librefunnel.com/install | sh
```

It installs Docker if needed, asks for the store address (or uses `<IP>.sslip.io`, which works with no DNS), an optional e-mail for the certificate, the dashboard password (or generates one) and whether the domain is on Cloudflare, protects a new server (firewall, automatic security updates, fail2ban, SSH by key only when you have one), downloads the latest release to `/opt/librefunnel` and starts it. At the end it prints the store and dashboard addresses and the password, once. With a Cloudflare API token it also points the DNS, sets HTTPS, locks ports 80 and 443 to Cloudflare and connects R2 for videos.

To try it on your own computer, run the same command on macOS or in Git Bash, or `irm https://librefunnel.com/install.ps1 | iex` in PowerShell on Windows: it installs a local store at `https://localhost` on Docker Desktop.

Every step is its own question with a matching option, such as `--no-cf-firewall`, `--no-r2` or `--no-updater`, and it prints a one-line summary before changing anything. `--plan` prints what it would do and changes nothing; `--yes` asks nothing. Running it again keeps your settings and your earlier answers. The [deployment guide](docs/deploy.md) walks through every click, from creating the server to the first sale, explains every option and the token permissions, and has the [manual install](docs/deploy.md#manual-install) without the script.

Then open `https://<your address>/admin`, create your first product with its Pix key, price and lessons, and set up e-mail in **Conexões** so buyers receive their access link.

## Configuration

Server settings live in `.env`. Each line in [`.env.example`](.env.example) explains itself. The minimum to sell:

| Variable            | What it is                                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `BASE_URL`          | Public address of the store, such as `https://yourstore.duckdns.org` (no trailing slash).                                                 |
| `DOMAIN`            | The same hostname without `https://`. Caddy uses it to get the certificate.                                                               |
| `ADMIN_PASSWORD`    | Dashboard password, at least 16 characters. Generate with `openssl rand -base64 24`.                                                      |
| `SECRET`            | Signs cookies and access links and encrypts the keys saved in **Conexões**, at least 32 characters. Generate with `openssl rand -hex 32`. |
| `POSTGRES_PASSWORD` | Password of the PostgreSQL database that runs next to the app. Generate with `openssl rand -hex 24`.                                      |

Optional: `EVOLUTION_KEY` for the WhatsApp server bundled with the app. The app refuses to start when a required value is missing and says which one in `docker compose logs app`.

After editing `.env`, apply it with:

```sh
docker compose up -d
```

Everything else is managed in `/admin`, with no restart:

- **Products**: name, price, Pix key, offer deadline, guarantee, order bump, sales video, FAQ, testimonials, modules and lessons with video and cover uploads.
- **Automations**: recovery steps (channel, delay and text) and WhatsApp keyword replies.
- **Settings**: brand, your own e-mail and WhatsApp for sale notices, terms URL and how long a Pix order stays valid.
- **Conexões**: e-mail (Gmail, Brevo, Mailjet or any SMTP), Pix provider, generic payment webhook, Meta Conversions API and WhatsApp. Passwords and keys are stored encrypted and never shown again; **Testar** checks each one. Without e-mail, buyers pay and receive nothing.

## How Pix confirmation works

**Manual mode (free, the default).** The buyer pays straight to your Pix key. Open your **bank statement**, find a Pix with the order amount and identifier, then click **Release** on the order in `/admin`. Never release based on a screenshot sent by the buyer: receipts are easy to fake. Release sends the access link right away.

**Automatic mode (Mercado Pago, Woovi or AbacatePay).** In **Conexões** > **Recebimento do Pix**, paste the provider's keys, click **Salvar e usar este provedor** and register the webhook URL shown there in the provider's dashboard. Each order gets its own Pix from the provider; the webhook only makes the store ask the provider again, and access is released when the amount received covers the order. Refunds, chargebacks and lost MED claims revoke it. Orders keep the provider that issued them when you switch. See [the guide](docs/deploy.md#pix-providers-automatic-confirmation).

## Development

Requires [Bun](https://bun.sh) and Node.js 24.

```sh
bun install
cp .env.example .env   # set BASE_URL=http://localhost:3000, DATA_DIR=data, SECRET and ADMIN_PASSWORD
bun run dev            # http://localhost:3000
```

Without `DATABASE_URL`, development and tests run on [PGlite](https://pglite.dev), PostgreSQL compiled to WebAssembly: the dev database lives in `DATA_DIR/pglite` and tests use one in memory, so no Docker or database server is needed. Migrations apply on startup. After changing `src/lib/schema.ts`, run `bun run migration` to write the next migration.

Before opening a pull request, run the same checks as CI:

```sh
bun run check
```

Stack: Next.js 16 (App Router, standalone output), React 19, PostgreSQL with Drizzle ORM, nodemailer, Docker Compose and Caddy. Business rules live in `src/lib`, pages in `src/app`. See [CONTRIBUTING.md](CONTRIBUTING.md).

### Website

[librefunnel.com](https://librefunnel.com) lives in `site/`, a separate [Fumadocs](https://fumadocs.dev) app with its own dependencies. Docs pages are MDX files in `site/content/docs`.

```sh
cd site
bun install
bun run dev     # http://localhost:3000
bun run build   # static export in site/out, with deploy/install.sh and install.ps1 copied to site/out/install and install.ps1
```

The site is the Cloudflare Pages project `librefunnel` (direct upload, not linked to GitHub), with `librefunnel.com` and `www.librefunnel.com` as custom domains. Publish it after changing `site/` or either installer: `bunx wrangler@4.162.0 login` once, then `bun run build` and `bunx wrangler@4.162.0 pages deploy out --project-name librefunnel --branch main` from `site/`. `site/public/_headers` serves `/install` and `/install.ps1` as plain text; check both with `curl -sI` after publishing.

## License

[MIT](LICENSE)
