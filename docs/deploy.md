# Deployment guide

This guide takes you from nothing to a live store at `https://yourstore.duckdns.org`, on a free server, with no technical background. Plan for about an hour. Follow the steps in order and copy each command exactly.

**What you need**

- A credit or debit card. Oracle uses it to verify your identity and does not charge on the Always Free tier.
- A Google account, for DuckDNS and for sending e-mail through Gmail.
- A phone with WhatsApp, only if you want WhatsApp messages (optional).

**Contents**

1. [Create the server](#1-create-the-server)
2. [Open ports 80 and 443](#2-open-ports-80-and-443)
3. [Get a hostname](#3-get-a-hostname)
4. [Connect to the server](#4-connect-to-the-server)
5. [Install Docker](#5-install-docker)
6. [Download LibreFunnel](#6-download-librefunnel)
7. [Fill in the settings file](#7-fill-in-the-settings-file)
8. [Start the store](#8-start-the-store)
9. [Set up e-mail](#9-set-up-e-mail)
10. [Set up your store in the dashboard](#10-set-up-your-store-in-the-dashboard)

Optional: [WhatsApp](#whatsapp), [Pix providers](#pix-providers-automatic-confirmation), [other payment providers](#other-payment-providers), [Meta Conversions API](#meta-conversions-api), [video storage](#video-storage-cloudflare-r2-or-s3). Day to day: [updating](#updating), [logs](#logs), [backups and restore](#backups-and-restore), [troubleshooting](#troubleshooting).

## 1. Create the server

1. Create an account at [oracle.com/cloud/free](https://www.oracle.com/cloud/free/). Pick a home region close to Brazil, such as São Paulo. You cannot change it later.
2. In the Oracle Cloud console, open **Compute > Instances** and click **Create instance**.
3. Under **Image and shape**, click **Edit**:
   - **Image**: Canonical Ubuntu 24.04.
   - **Shape**: Ampere, `VM.Standard.A1.Flex`, with 1 OCPU and 6 GB of memory. That is plenty, and well inside the free limit.
4. Under **Networking**, keep the defaults and make sure **Assign a public IPv4 address** is on.
5. Under **Add SSH keys**, choose **Generate a key pair for me** and click **Save private key**. Keep this `.key` file safe: it is the only way into your server.
6. Click **Create**. When the instance shows **Running**, copy its **Public IP address** (for example `203.0.113.10`). You will use it several times.

> If Oracle says it is **out of capacity**, try another availability domain in step 4, or try again a few hours later. Free Ampere machines are popular.

## 2. Open ports 80 and 443

Visitors reach your store through ports 80 (HTTP) and 443 (HTTPS). Oracle blocks them by default.

1. On the instance page, click the **subnet** link under **Primary VNIC**.
2. Open the subnet's **Security List** (usually `Default Security List for ...`).
3. Click **Add Ingress Rules** and add two rules:

   | Source CIDR | IP protocol | Destination port range |
   | ----------- | ----------- | ---------------------- |
   | `0.0.0.0/0` | TCP         | `80`                   |
   | `0.0.0.0/0` | TCP         | `443`                  |

Oracle's Ubuntu image also has its own firewall. You open it in [step 5](#5-install-docker).

## 3. Get a hostname

Your store needs a name, and HTTPS needs one too.

**Free with DuckDNS**

1. Go to [duckdns.org](https://www.duckdns.org) and sign in with Google.
2. Type a subdomain, such as `yourstore`, and click **add domain**.
3. In the **current ip** field next to it, paste the server's public IP and click **update ip**.

Your address is now `yourstore.duckdns.org`.

**With your own domain**

At your domain registrar, create an `A` record pointing your chosen name (such as `store.yourdomain.com.br`) to the server's public IP.

## 4. Connect to the server

You control the server by typing commands over SSH.

**Windows 10 or 11**: open **Terminal** (or PowerShell) from the Start menu and run, replacing the key path and IP with yours:

```powershell
ssh -i "$HOME\Downloads\your-key.key" ubuntu@203.0.113.10
```

**macOS**: open **Terminal** and run:

```sh
chmod 600 ~/Downloads/your-key.key
ssh -i ~/Downloads/your-key.key ubuntu@203.0.113.10
```

Type `yes` when asked whether to continue connecting. When the prompt changes to `ubuntu@...`, you are on the server. Every command from here on runs there. To paste in the terminal, right-click (Windows) or press `Cmd+V` (macOS).

## 5. Install Docker

Open Oracle's server firewall for ports 80 and 443:

```sh
sudo iptables -I INPUT -p tcp -m multiport --dports 80,443 -j ACCEPT && sudo netfilter-persistent save
```

Install Docker and allow your user to run it:

```sh
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
exit
```

`exit` disconnects you. Connect again with the same `ssh` command from step 4 so the change takes effect.

## 6. Download LibreFunnel

```sh
git clone https://github.com/ToledoSDL/librefunnel.git
cd librefunnel
cp .env.example .env
```

The last line creates `.env`, your private settings file. It holds passwords: never share it or commit it.

## 7. Fill in the settings file

First generate three random secrets. Run each command and copy what it prints:

```sh
openssl rand -base64 24
openssl rand -hex 32
openssl rand -hex 24
```

Open the settings file:

```sh
nano .env
```

Move with the arrow keys and fill in these lines (use your own hostname):

```sh
BASE_URL=https://yourstore.duckdns.org
DOMAIN=yourstore.duckdns.org
ADMIN_PASSWORD=<the output of openssl rand -base64 24>
SECRET=<the output of openssl rand -hex 32>
POSTGRES_PASSWORD=<the output of openssl rand -hex 24>
```

- `BASE_URL` has `https://` and no slash at the end.
- `DOMAIN` is the same name without `https://`.
- `ADMIN_PASSWORD` is how you sign in to the dashboard. Save it in a password manager.
- `SECRET` signs logins and access links and encrypts the passwords and keys you save in the dashboard. If you change it later, everyone is signed out, WhatsApp must be reconnected and those passwords and keys must be typed again.
- `POSTGRES_PASSWORD` protects the database, which stays inside the server. Set it before the first start and do not change it afterwards.

Leave the other lines as they are for now. Keep `nano` open for the next step, or save with `Ctrl+O`, `Enter`, and exit with `Ctrl+X`.

## 8. Start the store

```sh
docker compose up -d --build
```

The first build takes a few minutes. Check that everything is up:

```sh
docker compose ps
```

`app`, `db`, `backup` and `caddy` should all show `Up`. If `app` shows `Restarting`, a setting is missing: run `docker compose logs app` and the log says which one.

Open `https://yourstore.duckdns.org` in your browser. Caddy gets the HTTPS certificate on its own within a minute or two.

## 9. Set up e-mail

Buyers receive their access link by e-mail, so this step is required. Oracle blocks outbound port 25, so use port 587, which every provider below supports.

Open `https://yourstore.duckdns.org/admin` and sign in with `ADMIN_PASSWORD`. In **Settings**, fill in your own e-mail first: the test message goes there. Then open **Conexões**.

**Gmail (free)**

1. Turn on [2-Step Verification](https://myaccount.google.com/signinoptions/two-step-verification) on your Google account.
2. Open [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords), create an app password named `LibreFunnel`, and copy the 16 letters it shows.
3. In the **E-mail** card, choose **Gmail** under **Provedor**, put your Gmail address in **Usuário** and the 16 letters, without spaces, in **Senha**. Leave **Remetente** blank. Click **Salvar e-mail**.
4. Click **Testar**. It signs in to Gmail and sends a message to your own e-mail. If it fails, the message says whether the password, the server or your e-mail in **Settings** is the problem.

Your normal Gmail password does not work here: it must be the app password.

**Alternatives**: [Brevo](https://www.brevo.com) and [Mailjet](https://www.mailjet.com) have free plans and are in the **Provedor** list. With Brevo, **Usuário** is the SMTP login and **Senha** is the SMTP key (not the API key). With Mailjet, they are the API Key and the Secret Key. For any other provider, choose **Outro** and fill in **Servidor SMTP** and **Porta** (587, or 465 only if the provider asks for it).

Passwords and keys saved in **Conexões** are stored encrypted with a key derived from `SECRET` and are never shown again. To change one, type the new value; leave the field blank to keep the saved one. Changes apply to the next message, without a restart.

## 10. Set up your store in the dashboard

Everything below is saved instantly, with no restart.

1. **Settings**: set your brand name, your own e-mail and WhatsApp (sale notices and test messages go there), your terms URL and how many hours a Pix order stays valid.
2. **Products**: a demo product is already there. Open it and set the name, price, your **Pix key** with the account holder name and city, the sales video and the second the buy button appears, the offer deadline, guarantee days, FAQ and testimonials. Add an order bump if you want one.
3. **Course content**: in the same product, add modules and lessons, reorder them, and upload each lesson's video and cover image.
4. **Automations**: review the recovery steps (channel, delay and text) and the WhatsApp keyword replies. Texts can use `{name}`, `{product}`, `{amount}`, `{link}` and `{pix}`.
5. **Conexões**: optionally pick a [Pix provider](#pix-providers-automatic-confirmation), connect [WhatsApp](#whatsapp) and [Meta](#meta-conversions-api).

Your sales page is at `/v/<product-slug>` and the checkout at `/c/<product-slug>`. Make a test purchase with your own e-mail, then release it in **Orders** to see the whole flow, including the access e-mail and the members area at `/m`.

**Confirming payments.** Without a Pix provider, each Pix lands straight in your account and you confirm it yourself. Open your **bank statement** (never a screenshot sent by the buyer), find a Pix with the order amount and identifier, then click **Release** on the order in **Orders** and enter the amount received. The access e-mail goes out right away. **Refund** ends access and subtracts the sale from revenue. Send the money back through your bank app: the dashboard does not move money.

## WhatsApp

WhatsApp sends cart recovery, payment confirmations and keyword replies from your own number, through a self-hosted [Evolution API](https://github.com/EvolutionAPI/evolution-api). It connects the way WhatsApp Web does, so use a number dedicated to sales, or use the [official API](#official-whatsapp-meta-cloud-api) instead.

Evolution runs on the same server as the store and starts with it: there is nothing to install or configure. It keeps its data in its own database on the store's PostgreSQL server and uses about 300 MB of memory.

1. In `/admin`, open **Conexões** and click **Conectar pelo QR Code**. On the sales phone, open WhatsApp, go to **Settings > Linked devices > Link a device**, and scan the QR code. The page updates when it connects. If your WhatsApp number is set in **Settings**, you can also link with a pairing code instead of the camera.
2. Click **Testar**: it checks the connection and sends a message to your own WhatsApp.

The app registers the Evolution webhook for incoming messages on its own. Evolution's port is never exposed to the internet.

Already running Evolution somewhere else? Set `EVOLUTION_URL` and `EVOLUTION_KEY` in `.env` to its address and API key and run `docker compose up -d`.

### Official WhatsApp (Meta Cloud API)

Prefer the official API? The store must be online with https at `BASE_URL`, since Meta calls it back.

1. Create a Meta app of type Business with WhatsApp and your sales number, and copy **App settings > Basic > App secret**.
2. In Business Manager, **Users > System users**: add an admin system user, assign it the app and the WhatsApp account with full control, and generate a token that never expires with `whatsapp_business_messaging` and `whatsapp_business_management`.
3. In **Conexões**, click **Conectar** on **WhatsApp oficial (Meta)**, paste both and click **Conectar**.

The store finds the WhatsApp account and number the token can use, subscribes the webhook (replies, `SAIR`, delivery receipts, checked against the app secret) and creates the message template `librefunnel_aviso`. Meta reviews the template in a few minutes; the card shows **Modelo em análise** until then. From that point every WhatsApp message goes through the official API instead of the QR Code number; removing it switches back.

- Meta only delivers free text within 24 hours of the buyer's last message, so keyword replies go as text and everything else (recovery, payment notices, tests) goes inside the template, with line breaks turned into spaces.
- Meta charges per template message, at its own prices.
- If the account has more than one number, the first one already active in the API is used; **Configurar** lets you switch without pasting the keys again.
- A number added in the Meta panel that is not yet active in the API is registered on connect. The window then asks for its two-step PIN: the existing one, or 6 new digits to keep.

How it behaves:

- Recovery messages on WhatsApp wait out quiet hours: anything due between 21:00 and 09:00 (São Paulo time) goes out at 09:00.
- A buyer who replies `SAIR` (or `PARAR`) stops receiving automatic messages. E-mail recovery has an unsubscribe link.
- At most 2 recovery messages per address per day and 300 automatic WhatsApp messages per day in total.
- Recovery stops as soon as the order is paid.

## Pix providers: automatic confirmation

By default each Pix goes straight to the key set on the product, with no fee, and you release each order by hand. With a provider, each order gets its own Pix code, access is released on its own once the provider confirms that the full amount arrived, and refunds or a lost MED (the Pix fraud claim) revoke it.

Choose the provider in **Conexões** > **Recebimento do Pix**. The card shows each provider's fee and whether it needs a CNPJ:

| Provider     | Fee (November 2026)                                                                | Account             |
| ------------ | ---------------------------------------------------------------------------------- | ------------------- |
| Mercado Pago | 0.99% per sale                                                                     | CPF or CNPJ         |
| Woovi        | 0.80% per Pix (min R$ 0.50, max R$ 5.00) or R$ 0.85 per Pix, depending on the plan | CNPJ (MEI accepted) |
| AbacatePay   | R$ 0.80 per Pix                                                                    | CNPJ (MEI accepted) |

Switching provider changes only new orders: an order is always confirmed through the provider that issued its Pix, as long as that provider's keys stay saved. If the provider cannot be reached when an order is created, that order keeps the direct Pix to your key and waits in **Orders** for a manual release. **Usar Pix direto na chave** goes back to manual confirmation.

Every webhook only tells the store to look: the store then asks the provider, with your key, how much was paid, and releases only when it covers the order.

### Mercado Pago

1. Go to [mercadopago.com.br/developers](https://www.mercadopago.com.br/developers), open **Your integrations** and create an application (or open an existing one).
2. Under **Production credentials**, copy the **Access Token**.
3. Under **Webhooks**, register the production URL shown in the dashboard, and select the **Order** event:

   ```text
   https://yourstore.duckdns.org/api/webhooks/payment?psp=mercadopago
   ```

4. Copy the **secret signature** shown on that screen.
5. In **Conexões** > **Recebimento do Pix** > **Mercado Pago**, paste them into **Access Token de produção** and **Assinatura secreta do webhook**, click **Salvar e usar este provedor**, then **Testar**.

### Woovi

1. In the Woovi dashboard, open **API/Plugins** > **Nova API/Plugin**, name it, choose **API**, save, confirm with your second factor and copy the **AppID**. It needs permission to create and read charges, list transactions and refunds, and read disputes.
2. In **API/Plugins** > **Novo webhook**, create one webhook for each event below, all with this URL:

   ```text
   https://yourstore.duckdns.org/api/webhooks/payment?psp=woovi
   ```

   Events: `OPENPIX:CHARGE_COMPLETED`, `PIX_TRANSACTION_REFUND_SENT_CONFIRMED` and `OPENPIX:DISPUTE_ACCEPTED`. Optionally, fill the webhook authorization with the output of `openssl rand -hex 32`.

3. In **Conexões** > **Recebimento do Pix** > **Woovi**, paste the **AppID** (and the same authorization in **Authorization do webhook (opcional)**, if you set one), click **Salvar e usar este provedor**, then **Testar**. The test also downloads the keys Woovi signs its webhooks with.

### AbacatePay

1. In the AbacatePay dashboard, open **Integração** > **API** > **Nova chave**, choose **API v2** with permission to create and read checkout transparente charges, and copy the key (it is shown once).
2. Generate a webhook secret with `openssl rand -hex 32`. In **Integração** > **Webhooks** > **Criar webhook**, choose version **v2**, paste this URL and the secret, and select `transparent.completed`, `transparent.refunded`, `transparent.disputed` and `transparent.lost`:

   ```text
   https://yourstore.duckdns.org/api/webhooks/payment?psp=abacatepay
   ```

3. In **Conexões** > **Recebimento do Pix** > **AbacatePay**, paste the key into **Chave da API (v2)** and the secret into **Segredo do webhook**, click **Salvar e usar este provedor**, then **Testar**.

A test key (starting with `abc_dev_`) only confirms test charges. Save the production key (`abc_prod_`) before selling.

## Other payment providers

To confirm payments from another gateway or your own automation, open **Conexões** > **Webhook genérico de pagamento** and click **Ativar e gerar segredo**. Copy the secret right away: it is shown only once. Then send a `POST` to `https://yourstore.duckdns.org/api/webhooks/payment` with this JSON body:

```json
{ "order": "<order id or Pix identifier>", "status": "paid", "amount": 9700, "id": "<unique payment id>" }
```

`status` is `paid` or `refunded`, and `amount` is in cents. Sign the request with an `X-Signature` header holding the HMAC-SHA256 of the raw body, in hex, using the secret as the key. **Gerar novo segredo** replaces it at once and the old one stops working. **Remover** turns the address off: it then answers 404.

## Meta Conversions API

The app sends `InitiateCheckout` (when a Pix is generated) and `Purchase` (when it is paid) to Meta from the server, so your ads optimize for sales instead of clicks.

1. In Meta **Events Manager**, open **Data sources**, select your pixel and copy its ID.
2. In the pixel's **Settings**, under Conversions API, click **Generate access token** and copy it.
3. To check the setup, open the pixel's **Test events** tab and copy the test code.
4. In `/admin` > **Conexões** > **Meta (API de Conversões)**, fill in **ID do Pixel**, **Token da API de Conversões** and, for now, **Código de teste (opcional)**. Click **Salvar Meta**.
5. Click **Testar** and confirm the event appears in **Test events**.
6. Clear **Código de teste (opcional)** and click **Salvar Meta** again. While it is set, sales do not count toward your campaigns.

Add UTMs to every ad link (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`) so the dashboard knows which ad sold. `fbclid`, `gclid` and `ttclid` are recognized too. The **Overview** tab shows sales by source with first-touch and last-touch attribution.

## Video storage (Cloudflare R2 or S3)

Without it, videos and images live in the `/data` volume and every view goes out through the server's bandwidth. With a bucket connected, uploads go straight from the browser to the bucket, viewers download from it, and files already on the server move there in the background (the local copy is deleted only after each upload succeeds). R2 is the recommended choice: it charges nothing for data going out. Amazon S3, Backblaze B2 and other S3-compatible services work too.

1. If R2 was never used on your Cloudflare account, open **R2** in the dashboard once and enable it (the free plan covers 10 GB).
2. In `/admin` > **Conexões** > **Cloudflare R2**, click **Conectar**, then **Crie um token na Cloudflare**. The token form opens with the R2 edit permission filled in: create it and copy its value.
3. Paste it and click **Conectar**. The store finds your account, creates a private bucket named after your store, allows uploads from your address (CORS), derives the S3 keys from the token and tests them. The token itself is not stored.

For Amazon S3, Backblaze B2 or another S3-compatible service, open **Usar Amazon S3, Backblaze ou outro serviço S3** in the same dialog: paste the S3 address with the bucket at the end and the two keys, and add the CORS policy shown there to the bucket. Keep the bucket private: lesson videos are protected by links that expire, and a public bucket would bypass that.

The sales video and images get signed links valid for a week, renewed daily so browsers can cache them. Lesson files are checked against the buyer's access on every request and get links valid for 15 minutes; HLS playlists pass through the store, so each segment is checked too. **Remover** keeps every file in the bucket, but they stop opening in the store until you connect it again. The daily backup covers the database only, not the files in the bucket.

## Google and AI assistants

The store already publishes what search engines and AI assistants read, built from your products: `/robots.txt`, `/sitemap.xml`, `/llms.txt` (the store in plain text, with prices and FAQ), and on each sales page a canonical address without UTMs, a link preview for WhatsApp and social networks, and Product and FAQ data for Google.

1. Open [Google Search Console](https://search.google.com/search-console), add your domain as a **Domain** property and verify it with the DNS record it shows, at the place where you manage your domain.
2. Under **Sitemaps**, submit `sitemap.xml`.
3. Fill in **Frase de apresentação**, the FAQ and the **Banner** of every product: they become the Google snippet, the AI answer and the WhatsApp preview. Use JPG, PNG or WebP for the banner, since WhatsApp and Facebook do not show SVG previews.

## Updating

Updates come from the releases published on GitHub, as a ready-made image, so the server never compiles anything. Everything you configured stays: products, orders, buyers and settings live in the `postgres` volume, uploads in `data`, the WhatsApp session in `evolution_instances`, and your passwords and keys in `.env`. An update only swaps the store container, and the app applies database changes on its own when it starts.

In the dashboard, the version sits at the bottom of the sidebar. When a new release exists it turns into **Atualizar para vX.Y.Z**:

- **Atualizar** shows what changed, backs up the database to `backups/antes-vX.Y.Z.sql`, downloads the new version and restarts the store. It is out for about a minute and the page reloads by itself.
- **Atualizar sozinha** picks an hour of the day for the same thing to happen automatically, always with a backup first.
- **Reiniciar agora** restarts the store without changing the version.

This runs through the `updater` service in `compose.yaml`. It is the only part with access to Docker, it has no public port, it needs the same key as the store (`UPDATER_TOKEN`, which defaults to `POSTGRES_PASSWORD`) and it can only restart, update to a published version and back up.

The installed version is pinned in `.env` as `LIBREFUNNEL_VERSION`. To go back to an earlier one, set it there and run:

```sh
docker compose up -d
```

If the newer version had already changed the database, restore the backup made before the update (see [Backups and restore](#backups-and-restore)).

Updating by hand from the terminal still works:

```sh
cd librefunnel
git pull && docker compose pull app && docker compose up -d
```

### Publishing a release

For maintainers: push a tag and the **Release** workflow checks the code, publishes the image to GitHub Packages (`ghcr.io/toledosdl/librefunnel`) and creates the release with its notes.

```sh
git tag v0.3.0 && git push origin v0.3.0
```

After the first release, open the package on GitHub (**Packages > librefunnel > Package settings**) and set its visibility to **Public**, so servers can download it without logging in.

Coming from a version that kept e-mail, Mercado Pago, Meta or the payment webhook in `.env`? Those lines (`SMTP_`, `MP_`, `META_`, `WEBHOOK_SECRET`) are no longer read. Type the same values in **Conexões**, click **Testar** on each, then delete the lines from `.env`. The generic webhook gets a new secret: update it in the system that calls it.

## Logs

```sh
docker compose logs -f app      # the store
docker compose logs -f caddy    # HTTPS and certificates
```

Press `Ctrl+C` to stop following. For WhatsApp, run `docker compose logs -f evolution`.

## Backups and restore

The database (orders, buyers, products, messages) lives in the `postgres` volume. Your uploaded videos and images live in the `data` volume, mounted at `/data`.

Once a day the `backup` service saves the whole database with `pg_dump` to `librefunnel-1.sql` (Monday) through `librefunnel-7.sql` (Sunday) in the `backups` volume, so the last 7 days are always kept. These copies live on the same server, so also keep a copy elsewhere.

**Download a backup to your computer**

On the server, copy the daily dumps and the uploads out of the containers:

```sh
cd librefunnel
rm -rf backup && mkdir backup
docker compose cp backup:/backups ./backup/database
docker compose cp app:/data ./backup/files
```

Then, from your own computer (a new terminal, not the SSH session), using the same key path as in [step 4](#4-connect-to-the-server):

```sh
scp -r -i ~/Downloads/your-key.key ubuntu@203.0.113.10:librefunnel/backup .
```

The `backup` folder holds buyer data. Store it somewhere private.

**Restore a daily copy**

List the copies and their dates:

```sh
docker compose exec backup ls -l /backups
```

Pick one (here, `librefunnel-3.sql`) and restore it. The dump replaces every table, so anything saved after it was taken is lost:

```sh
docker compose stop app
docker compose exec backup sh -c "psql -v ON_ERROR_STOP=1 -f /backups/librefunnel-3.sql"
docker compose start app
```

**Restore on a new server**

Set the new server up through [step 9](#9-start-the-store). From your computer, upload the `backup` folder:

```sh
scp -r -i ~/Downloads/your-key.key backup ubuntu@203.0.113.10:librefunnel/
```

On the server, load the most recent dump (here, `librefunnel-3.sql`) and copy the uploads into the `data` volume:

```sh
cd librefunnel
docker compose stop app
docker compose cp backup/database/librefunnel-3.sql backup:/backups/restore.sql
docker compose exec backup sh -c "psql -v ON_ERROR_STOP=1 -f /backups/restore.sql && rm /backups/restore.sql"
docker compose run --rm --no-deps -v "$PWD/backup/files:/restore:ro" --entrypoint sh app -c "cp -r /restore/. /data/"
docker compose start app
```

## Troubleshooting

### The site does not open

1. Run `docker compose ps`. If `app` shows `Restarting`, run `docker compose logs app`: it names the missing or invalid setting. Fix it in `.env` and run `docker compose up -d`.
2. Check that both ports 80 and 443 are open in the Oracle Security List ([step 2](#2-open-ports-80-and-443)) and that you ran the `iptables` command ([step 5](#5-install-docker)).
3. Check that DuckDNS (or your `A` record) points to the server's current public IP.

### No HTTPS certificate

Run `docker compose logs caddy` and look for errors. Caddy can only get a certificate when:

- `DOMAIN` in `.env` matches your hostname exactly, without `https://`.
- The hostname points to this server's IP. New DNS records can take a few minutes.
- Ports 80 and 443 are reachable from the internet.

After fixing `.env`, run `docker compose up -d` and wait a couple of minutes.

### E-mails do not arrive

1. In `/admin` > **Messages**, failed messages show the reason. Fix the cause and click **Resend**.
2. In **Conexões**, click **Testar** under E-mail and check the spam folder of the e-mail set in **Settings**. The error names the cause: password refused, server unreachable, or your e-mail missing in **Settings**.
3. With Gmail, **Senha** must be an app password, and **Remetente** should be blank or the same Gmail address.
4. Use port 587. Oracle blocks port 25.

A buyer who lost the access e-mail can request a new link at `/m`, or you can click **Resend access** on the order.

### WhatsApp disconnected

The dashboard shows a warning when WhatsApp is not connected, and recovery and payment messages on WhatsApp pause until it is back.

1. Check the services are running: `docker compose ps`. If `evolution` is missing, run `docker compose up -d`.
2. In `/admin` > **Conexões**, generate a new QR code and scan it again from **Linked devices**.
3. If you changed `SECRET`, reconnect WhatsApp the same way.

### Forgot the dashboard password

Set a new `ADMIN_PASSWORD` in `.env` and run `docker compose up -d`.
