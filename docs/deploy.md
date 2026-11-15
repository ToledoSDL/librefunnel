# Deployment guide

This guide takes you from nothing to a live store on a free server, with no technical background. Plan for about half an hour. Follow the steps in order and copy each command exactly.

Already connected to a Linux server (x64 or arm64, Ubuntu or Debian for the server protection)? Run this and answer the questions; [step 5](#5-run-the-installer) explains each one:

```sh
curl -fsSL https://librefunnel.com/install | sh
```

To try the store on your own computer instead (only that computer sees it, at `https://localhost`): the same command on macOS or in Git Bash, or `irm https://librefunnel.com/install.ps1 | iex` in PowerShell on Windows. It uses Docker Desktop (or OrbStack or Colima on a Mac) and asks before installing one.

**What you need**

- A credit or debit card. Oracle uses it to verify your identity and does not charge on the Always Free tier.
- A Google account, for DuckDNS and for sending e-mail through Gmail.
- A phone with WhatsApp, only if you want WhatsApp messages (optional).

**Contents**

1. [Create the server](#1-create-the-server)
2. [Open ports 80 and 443](#2-open-ports-80-and-443)
3. [Choose the address](#3-choose-the-address)
4. [Connect to the server](#4-connect-to-the-server)
5. [Run the installer](#5-run-the-installer)
6. [Set up e-mail](#6-set-up-e-mail)
7. [Set up your store in the dashboard](#7-set-up-your-store-in-the-dashboard)

Optional: [Cloudflare](#cloudflare), [WhatsApp](#whatsapp), [Pix providers](#pix-providers-automatic-confirmation), [other payment providers](#other-payment-providers), [Meta Conversions API](#meta-conversions-api), [video storage](#video-storage-cloudflare-r2-or-s3). Without the installer: [manual install](#manual-install). Day to day: [updating](#updating), [logs](#logs), [backups and restore](#backups-and-restore), [troubleshooting](#troubleshooting).

## 1. Create the server

1. Create an account at [oracle.com/cloud/free](https://www.oracle.com/cloud/free/). Pick a home region close to Brazil, such as São Paulo. You cannot change it later.
2. In the Oracle Cloud console, open **Compute > Instances** and click **Create instance**.
3. Under **Image and shape**, click **Edit**:
   - **Image**: Canonical Ubuntu 24.04.
   - **Shape**: Ampere, `VM.Standard.A1.Flex`, with 1 OCPU and 6 GB of memory. That is plenty, and well inside the free limit.
4. Under **Networking**, keep the defaults and make sure **Assign a public IPv4 address** is on.
5. Under **Add SSH keys**, choose **Generate a key pair for me** and click **Save private key**. Keep this `.key` file safe: it is the only way into your server.
6. Click **Create**. When the instance shows **Running**, copy its **Public IP address** (for example `203.0.113.10`). You will use it several times.

> Another provider works too. The smallest that runs the store is 1 vCPU and 1 GB of memory with a 2 GB swap file, which covers the few seconds of an update when two copies of the store run at once. Create the swap once, after step 4:
>
> ```sh
> sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
> echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
> ```
>
> With WhatsApp by QR Code (Evolution) on, use 2 GB of memory.

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

Oracle's Ubuntu image also has its own firewall. The installer replaces it with its own in [step 5](#5-run-the-installer); if you say no to the server protection there, run the `iptables` command from [the manual install](#install-docker).

## 3. Choose the address

Your store needs a name, and HTTPS needs one too. Pick one:

**None yet**: skip this step. The installer offers `203-0-113-10.sslip.io` (your server's IP with dashes), which already points to the server. To move to your own domain later, run the installer again with `--domain`.

**Your own domain on Cloudflare**: skip this step too. The installer creates the record, see [Cloudflare](#cloudflare).

**Free with DuckDNS**

1. Go to [duckdns.org](https://www.duckdns.org) and sign in with Google.
2. Type a subdomain, such as `yourstore`, and click **add domain**.
3. In the **current ip** field next to it, paste the server's public IP and click **update ip**.

Your address is now `yourstore.duckdns.org`.

**Your own domain elsewhere**

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

## 5. Run the installer

```sh
curl -fsSL https://librefunnel.com/install | sh
```

To read it before it runs: `curl -fsSLo install.sh https://librefunnel.com/install`, then `less install.sh` and `sh install.sh`. With `--plan` it prints everything it would do and changes nothing.

It runs as root (it calls `sudo` by itself) and:

1. Installs Docker with Docker's official script, after asking, when the server has none.
2. Asks one question per step; Enter takes the default:
   - **Domínio da loja**: the address from step 3. Enter takes `<IP>.sslip.io`.
   - **E-mail para o certificado HTTPS**: optional.
   - **Senha do painel**: Enter generates a strong one, shown once at the end.
   - **O domínio está na Cloudflare?** (no): then one question for each part, see [Cloudflare](#cloudflare).
   - **Ligar já o WhatsApp por QR Code?** (no): Evolution takes about 300 MB of memory, and **Conexões** turns it on later.
   - **Atualizar e reiniciar a loja pelo painel?** (yes): runs the `updater` service. Without it, the dashboard cannot update or restart the store, and updates are the installer run again (see [Updating](#updating)).
   - **Proteger o servidor?** (yes on a new install): see below.
3. Prints one line with every choice and asks to continue, then installs Docker with Docker's official script if the server has none.
4. Downloads `compose.yaml`, `deploy/Caddyfile` and `deploy/evolution.sql` of the latest release into `/opt/librefunnel` and writes `.env` there, readable by root only, with a random `SECRET` and `POSTGRES_PASSWORD`. Nothing else goes on the server: the store and the updater come as ready-made images.
5. Starts the store and waits until `https://<your address>` answers. If the address does not point to the server yet, it prints the exact DNS record to create.

At the end it prints the store and dashboard addresses and the dashboard password. The password is shown this once only; it also stays in `/opt/librefunnel/.env`.

Running it again is safe: what is in `.env` stays, only what is missing is filled in, and the three files are downloaded again for the installed version. The choices are stored in `.env` as `INSTALL_*` keys, so a re-run never flips one: to change a choice, run it again with that choice's option, such as `--updater` or `--no-cf-firewall`.

**Server protection** (yes by default on a new install, Debian and Ubuntu only): the ufw firewall with SSH (port 22 and the port you are connected on), 80 and 443 open; automatic security updates (unattended-upgrades); fail2ban for SSH; and SSH password login turned off, only when your user already has a key in `~/.ssh/authorized_keys`, so it never locks you out.

**Options** go after `sh -s --`, as in `curl -fsSL https://librefunnel.com/install | sh -s -- --plan`:

| Option                              | What it does                                                                                  |
| ----------------------------------- | --------------------------------------------------------------------------------------------- |
| `--plan`                            | Prints what it would do and does nothing (`--dry-run` too).                                   |
| `--yes`                             | Asks nothing: takes the options given, the earlier choices and the defaults.                  |
| `--domain <name>`                   | The store address, such as `loja.seudominio.com.br`.                                          |
| `--email <address>`                 | E-mail for the HTTPS certificate.                                                             |
| `--cloudflare`, `--no-cloudflare`   | Use Cloudflare, or not.                                                                       |
| `--cf-dns`, `--no-cf-dns`           | Cloudflare: point the address at the server, proxied.                                         |
| `--cf-ssl`, `--no-cf-ssl`           | Cloudflare: SSL Full (strict), minimum TLS 1.2, Always Use HTTPS off (zone-wide).             |
| `--cf-firewall`, `--no-cf-firewall` | Cloudflare: ports 80 and 443 only from Cloudflare. Never with `--no-cf-dns`.                  |
| `--r2`, `--no-r2`                   | Cloudflare: R2 for videos and images.                                                         |
| `--whatsapp`, `--no-whatsapp`       | Start WhatsApp by QR Code now, or leave it for **Conexões**.                                  |
| `--updater`, `--no-updater`         | Updates and restarts from the dashboard, or only from the terminal.                           |
| `--harden`, `--no-harden`           | Protect the server, or not.                                                                   |
| `--ssh-from <ip>`                   | With the firewall, SSH accepts only this IP. Refused when you are connected from another one. |
| `--dir <folder>`                    | Where the store lives, `/opt/librefunnel` by default.                                         |

Secrets go in environment variables, so they stay out of the shell history: `LIBREFUNNEL_ADMIN_PASSWORD` and `CLOUDFLARE_API_TOKEN`. With no questions at all:

```sh
export CLOUDFLARE_API_TOKEN=<your token>
curl -fsSL https://librefunnel.com/install | sh -s -- --yes --domain loja.seudominio.com.br --cloudflare
```

Commands in the rest of this guide run in the store folder as root: start with `cd /opt/librefunnel` and put `sudo` before `docker compose`.

### Cloudflare

With the domain on Cloudflare, one API token lets the installer do the rest.

1. Open [the token form with the permissions filled in](https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22zone%22%2C%22type%22%3A%22read%22%7D%2C%7B%22key%22%3A%22dns%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22zone_settings%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_r2%22%2C%22type%22%3A%22edit%22%7D%5D&name=LibreFunnel) (the installer prints the same link), or create a custom token at [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) with exactly these permissions:

   | Type    | Permission         | Access | Used for                   |
   | ------- | ------------------ | ------ | -------------------------- |
   | Zone    | Zone               | Read   | finding the domain         |
   | Zone    | DNS                | Edit   | the `A` and `AAAA` records |
   | Zone    | Zone Settings      | Edit   | SSL mode and minimum TLS   |
   | Account | Workers R2 Storage | Edit   | the video bucket           |

   Under **Zone Resources**, choose only your domain.

2. If R2 was never used on the account, open **R2** in the Cloudflare dashboard once and enable it (the free plan covers 10 GB).
3. Answer yes to **O domínio está na Cloudflare?** and paste the token. It is typed without showing. Enter without a token skips the DNS, SSL and R2 parts and leaves them as they are.

Each part below is its own question (yes by default) with an option to skip it: `--no-cf-dns`, `--no-cf-ssl`, `--no-cf-firewall` and `--no-r2`. The firewall part is offered only with the DNS part, since without the proxy visitors reach the server directly and the lock would take the store offline. The token is needed only for DNS, SSL and R2.

The installer then:

- creates or updates the `A` record (and `AAAA` when the server has a public IPv6) for the address, proxied (orange cloud);
- sets SSL to **Full (strict)**, minimum TLS to 1.2 and **Always Use HTTPS** off, since Caddy redirects to HTTPS itself and Let's Encrypt validates over plain HTTP through Cloudflare. These are zone settings, so they apply to every name on the domain; the installer prints each one it changes;
- writes Cloudflare's current IP ranges to `TRUSTED_PROXIES`, so the store sees each visitor's real IP;
- accepts ports 80 and 443 only from those ranges, in ufw and in Docker's `DOCKER-USER` chain (Docker's published ports skip ufw's own rules);
- connects [video storage](#video-storage-cloudflare-r2-or-s3) the same way **Conexões** > **Cloudflare R2** does: a private bucket named after the store, uploads allowed from your address, and S3 keys derived from the token. The token is not saved in `.env`: only the first start of the store receives it, and that container is replaced right after.

The R2 keys come from this token, so keep it: deleting or rolling it disconnects video storage until you connect R2 again in **Conexões**. Run the installer again with the token to refresh the IP ranges or redo any step.

## 6. Set up e-mail

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

## 7. Set up your store in the dashboard

Everything below is saved instantly, with no restart.

1. **Settings**: set your brand name, your own e-mail and WhatsApp (sale notices and test messages go there), your terms URL and how many hours a Pix order stays valid.
2. **Products**: the store starts empty. Create your first product and set the name, price, your **Pix key** with the account holder name and city, the sales video and the second the buy button appears, the offer deadline, guarantee days, FAQ and testimonials. Add an order bump if you want one.
3. **Course content**: in the same product, add modules and lessons, reorder them, and upload each lesson's video and cover image.
4. **Automations**: review the recovery steps (channel, delay and text) and the WhatsApp keyword replies. Texts can use `{name}`, `{product}`, `{amount}`, `{link}` and `{pix}`.
5. **Conexões**: optionally pick a [Pix provider](#pix-providers-automatic-confirmation), connect [WhatsApp](#whatsapp) and [Meta](#meta-conversions-api).

Your sales page is at `/v/<product-slug>` and the checkout at `/c/<product-slug>`. Make a test purchase with your own e-mail, then release it in **Orders** to see the whole flow, including the access e-mail and the members area at `/m`.

**Confirming payments.** Without a Pix provider, each Pix lands straight in your account and you confirm it yourself. Open your **bank statement** (never a screenshot sent by the buyer), find a Pix with the order amount and identifier, then click **Release** on the order in **Orders** and enter the amount received. The access e-mail goes out right away. **Refund** ends access and subtracts the sale from revenue. Send the money back through your bank app: the dashboard does not move money.

## Manual install

Without the installer, these steps replace [step 5](#5-run-the-installer). They build the store from the source code on the server.

### Install Docker

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

`exit` disconnects you. Connect again with the same `ssh` command from [step 4](#4-connect-to-the-server) so the change takes effect.

### Download LibreFunnel

```sh
git clone https://github.com/ToledoSDL/librefunnel.git
cd librefunnel
cp .env.example .env
```

The last line creates `.env`, your private settings file. It holds passwords: never share it or commit it.

### Fill in the settings file

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

### Start the store

```sh
docker compose up -d --build
```

The first build takes a few minutes. Check that everything is up:

```sh
docker compose ps
```

`app`, `db`, `backup` and `caddy` should all show `Up`. If `app` shows `Restarting`, a setting is missing: run `docker compose logs app` and the log says which one.

Open `https://yourstore.duckdns.org` in your browser. Caddy gets the HTTPS certificate on its own within a minute or two.

## WhatsApp

WhatsApp sends cart recovery, payment confirmations and keyword replies from your own number, through a self-hosted [Evolution API](https://github.com/EvolutionAPI/evolution-api). It connects the way WhatsApp Web does, so use a number dedicated to sales, or use the [official API](#official-whatsapp-meta-cloud-api) instead.

Evolution runs on the same server as the store, with nothing to install or configure. It stays off until the first **Conectar pelo QR Code**, which turns it on (the first time it downloads for a few minutes), and **Desconectar** turns it off again. It keeps its data in its own database on the store's PostgreSQL server and uses about 300 MB of memory while on.

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
| DePix        | Set by Eulen                                                                       | Eulen partner       |
| NoxPay       | Set by NoxPay                                                                      | NoxPay account      |

DePix and NoxPay pay you in crypto instead of reais. Both are third parties holding or issuing what you receive: DePix is a BRL token issued by Eulen on the Liquid network, with no published proof of reserves, and NoxPay keeps the converted balance in your NoxPay account until you withdraw it. Neither has a documented Banco Central authorization. Move what you receive to your own custody or exchange it promptly if you do not want that exposure. Woovi can also convert what it receives into USDT or USDC, sent to your own wallet (see [Woovi to crypto](#woovi-to-crypto)).

Switching provider changes only new orders: an order is always confirmed through the provider that issued its Pix, as long as that provider's keys stay saved. If the provider cannot be reached when an order is created, that order keeps the direct Pix to your key and waits in **Orders** for a manual release. **Usar Pix direto na chave** goes back to manual confirmation.

Every webhook only tells the store to look: the store then asks the provider, with your key, how much was paid, and releases only when it covers the order. So a repeated, forged or out-of-order webhook changes nothing: the provider's current state decides, each payment, refund and MED is recorded once by its own id, and a refunded order is never released again.

Webhooks can also get lost, so the store checks each order on its own too: 5, 30 and 120 minutes after it is created and 10 minutes after it expires, then 1, 7, 30 and 85 days after a paid sale, to catch a MED (a payer can claim a Pix back for up to 80 days). When a provider answers that it is busy or rate limiting, every check of that provider waits the time it asked for.

### Mercado Pago

1. Go to [mercadopago.com.br/developers](https://www.mercadopago.com.br/developers), open **Your integrations** and create an application (or open an existing one).
2. Under **Production credentials**, copy the **Access Token**.
3. Under **Webhooks**, register the production URL shown in the dashboard, and select the **Order** and **Chargebacks** events:

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

   Events: `OPENPIX:CHARGE_COMPLETED`, `OPENPIX:CHARGE_COMPLETED_NOT_SAME_CUSTOMER_PAYER`, `PIX_TRANSACTION_REFUND_SENT_CONFIRMED` and `OPENPIX:DISPUTE_ACCEPTED`. Optionally, fill the webhook authorization with the output of `openssl rand -hex 32`.

3. In **Conexões** > **Recebimento do Pix** > **Woovi**, paste the **AppID** (and the same authorization in **Authorization do webhook (opcional)**, if you set one), click **Salvar e usar este provedor**, then **Testar**. The test also downloads the keys Woovi signs its webhooks with.

#### Woovi to crypto

The buyer pays the Woovi Pix as usual. The store then asks Woovi to convert reais from your Woovi balance into USDT or USDC and send it to your wallet. Woovi does not hold the crypto: a virtual asset provider it partners with makes the conversion.

1. Ask Woovi support for a stablecoin subaccount (a review of your company) and give the AppID the `STABLECOIN_DEPOSIT_CREATE` permission.
2. In **Conexões** > **Receber em cripto pela Woovi**, choose the coin and network, paste your wallet address on that network and choose how to convert:
   - **Converter o saldo disponível**: once an hour, everything available in the Woovi account above R$ 50 is converted, including money that did not come from the store.
   - **Converter cada venda**: each Woovi sale paid after you turn this on is converted, minus the Pix fee shown on the charge (R$ 5 stays in reais when the charge does not show it).
3. Click **Salvar**. The store checks the AppID with a Woovi quote before saving.

If Woovi refuses a conversion (subaccount not approved yet, not enough balance), the card shows why and the store tries again every 10 minutes. A refund after a sale was converted is debited from your reais balance: the crypto already sent does not come back.

### AbacatePay

1. In the AbacatePay dashboard, open **Integração** > **API** > **Nova chave**, choose **API v2** with permission to create and read checkout transparente charges, and copy the key (it is shown once).
2. Generate a webhook secret with `openssl rand -hex 32`. In **Integração** > **Webhooks** > **Criar webhook**, choose version **v2**, paste this URL and the secret, and select `transparent.completed`, `transparent.refunded`, `transparent.disputed` and `transparent.lost`:

   ```text
   https://yourstore.duckdns.org/api/webhooks/payment?psp=abacatepay
   ```

3. In **Conexões** > **Recebimento do Pix** > **AbacatePay**, paste the key into **Chave da API (v2)** and the secret into **Segredo do webhook**, click **Salvar e usar este provedor**, then **Testar**.

A test key (starting with `abc_dev_`) only confirms test charges. Save the production key (`abc_prod_`) before selling.

### DePix (Eulen)

The buyer pays an ordinary Pix on the order page, and Eulen sends the same amount in DePix to the default Liquid address of your Eulen account.

1. Request partner access at [depix.info](https://depix.info/#partners). Eulen gives you a private Telegram channel.
2. In that channel, under **#Bot**, send `/addclientcredentials librefunnel` and copy the **Client ID** and **Client Secret**.
3. Generate a webhook secret with `openssl rand -hex 32` and register it for both events:

   ```text
   /registerwebhook deposit https://yourstore.duckdns.org/api/webhooks/payment?psp=depix <secret>
   /registerwebhook med https://yourstore.duckdns.org/api/webhooks/payment?psp=depix <secret>
   ```

4. In **Conexões** > **Recebimento do Pix** > **DePix**, paste the Client ID, the Client Secret and the webhook secret, click **Salvar e usar este provedor**, then **Testar**.

Eulen does not retry webhooks, so the store also checks every open DePix order once a minute until it is paid or its code expires. A Pix code lasts at most 24 hours, even if the order lasts longer. Eulen caps each payment by the payer's daily limit: when it refuses a charge, that order keeps the direct Pix to your key.

### NoxPay

The buyer leaves the order page for NoxPay's checkout, enters their CPF there and pays the Pix. NoxPay converts it and credits the chosen currency to your NoxPay balance; withdrawals to your wallet are made in the NoxPay dashboard.

1. In the NoxPay dashboard, open **Settings** > **API Keys**, create a key and copy the **API Key** and the **Webhook Secret**.
2. In **Conexões** > **Recebimento do Pix** > **NoxPay**, choose the currency you want to receive, paste both values, click **Salvar e usar este provedor**, then **Testar**. There is no webhook to register: the store sends its address with each checkout.

NoxPay documents no refund or MED status, so a reversed NoxPay payment does not revoke access on its own: refund it in **Orders**.

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

Without it, videos and images live in the `/data` volume and every view goes out through the server's bandwidth. With a bucket connected, uploads go straight from the browser to the bucket, viewers download from it, and files already on the server move there in the background (the local copy is deleted only after each upload succeeds). R2 is the recommended choice: it charges nothing for data going out. Amazon S3, Backblaze B2 and other S3-compatible services work too. With [Cloudflare in the installer](#cloudflare), R2 is already connected.

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

- **Atualizar** shows what changed, backs up the database to `backups/antes-vX.Y.Z.sql` (the last three are kept), downloads the new version and starts it next to the running one. The old one stops only after the new one answers, so the store stays online the whole time. If the new version does not start within 3 minutes it is removed and the store keeps running the previous one.
- **Atualizar sozinha** picks an hour of the day for the same thing to happen automatically, always with a backup first.
- **Reiniciar agora** swaps the store container the same way, without changing the version. It also picks up changes made to `.env`.

This runs through the `updater` service in `compose.yaml`. It is the only part with access to Docker, it has no public port, it needs the same key as the store (`UPDATER_TOKEN`, which defaults to `POSTGRES_PASSWORD`) and it can only restart, update to a published version and back up.

The installed version is pinned in `.env` as `LIBREFUNNEL_VERSION`. To go back to an earlier one, set it there and run:

```sh
docker compose up -d
```

If the newer version had already changed the database, restore the backup made before the update (see [Backups and restore](#backups-and-restore)).

Updating by hand from the terminal still works, and it is the only way on a store installed with `--no-updater`. On a store set up by the installer, set `LIBREFUNNEL_VERSION` in `/opt/librefunnel/.env` to the new version and run the installer again: it downloads that version's files and images and keeps everything else. On a manual install:

```sh
cd librefunnel
git pull && docker compose pull app && docker compose up -d
```

### Publishing a release

For maintainers: push a tag and the **Release** workflow checks the code, publishes the store and updater images for x64 and arm64 to GitHub Packages (`ghcr.io/toledosdl/librefunnel` and `ghcr.io/toledosdl/librefunnel-updater`) and creates the release with its notes. The installer installs the latest release, so it refuses to run until the first one exists.

```sh
git tag v0.3.0 && git push origin v0.3.0
```

After the first release, open both packages on GitHub (**Packages > librefunnel > Package settings**, then the same for **librefunnel-updater**) and set their visibility to **Public**, so servers can download them without logging in.

Coming from a version that kept e-mail, Mercado Pago, Meta or the payment webhook in `.env`? Those lines (`SMTP_`, `MP_`, `META_`, `WEBHOOK_SECRET`) are no longer read. Type the same values in **Conexões**, click **Testar** on each, then delete the lines from `.env`. The generic webhook gets a new secret: update it in the system that calls it.

## Demo

The public demo at `demo.librefunnel.com` is an install with `DEMO_MODE=1` in `.env`, built from the image's `demo` target. Never set it on a store that sells. The released image has no demo content: a fresh store starts with no products.

- Every page shows a line saying it is a demonstration, with a link to install your own store.
- The dashboard sign-in shows the `ADMIN_PASSWORD` already filled in, so use a password made only for the demo.
- Nothing leaves the server: queued e-mails and WhatsApp messages are marked as sent without being delivered, Meta events are skipped, and no Pix provider is called. **Conexões** refuses to save, test or remove connections, and **Atualizar** and **Reiniciar** are refused too. Leave `AUTO_UPDATE_HOUR` empty.
- The Pix page gets a **Simular pagamento** button that pays the order the same way a confirmed Pix does, so visitors can reach the members area.
- The demo store (the `demo/` folder, which only the `demo` target copies into the image) is filled in: three products using every page option, automations, settings, and 30 days of example orders, visits and messages, all dated relative to when it was loaded. It loads on the first start with `DEMO_MODE=1`. Its video and images are served at `/demo/...` only in demo mode.
- Every day at 04:00 (Sao Paulo time) the database goes back to the demo store: orders, buyers, messages, settings and edited products are erased and the seed runs again. Uploaded files stay in `data`.

- Uploads are refused: the password is public and files would survive the reset.
- Build and run it with the demo override, without the updater, Evolution or backups: `docker compose -f compose.yaml -f compose.demo.yaml up -d --build app db caddy`. Nothing in the demo needs Docker access or WhatsApp, and the privacy page promises no copies of what visitors type. Without the override the image has no `demo/` folder and the log says so.
- To update it, copy the repository at the new commit to the server's install folder (keep its `.env`, never copy a local one) and run the same command. The demo store reloads only on an empty database or at the nightly reset; to apply a changed `demo/*.sql` right away, run `docker compose exec db psql -U librefunnel -d librefunnel` with the changed statements, or wait for 04:00.

DNS: create an `A` record named `demo` pointing to the server's IP. With Cloudflare, keep the proxy on (orange cloud) to hide the server's IP, set SSL to **Full (strict)**, leave **Always Use HTTPS** off (Caddy redirects by itself and Let's Encrypt validates through Cloudflare), set `TRUSTED_PROXIES` to Cloudflare's ranges, and in the server's firewall open ports 80 and 443 only to those ranges. Then set `DOMAIN=demo.yourdomain.com` and `BASE_URL=https://demo.yourdomain.com`.

## Logs

```sh
docker compose logs -f app      # the store
docker compose logs -f caddy    # HTTPS and certificates
```

Press `Ctrl+C` to stop following. For WhatsApp, run `docker compose logs -f evolution`.

## Backups and restore

The database (orders, buyers, products, messages) lives in the `postgres` volume. Your uploaded videos and images live in the `data` volume, mounted at `/data`.

Once a day the `backup` service saves the whole database with `pg_dump` to `librefunnel-1.sql` (Monday) through `librefunnel-7.sql` (Sunday) in the `backups` volume, so the last 7 days are always kept. With [video storage](#video-storage-cloudflare-r2-or-s3) connected, the store also copies each new dump to the bucket under `backups/`, with the same 7 names, so losing the server does not lose the sales. Without a bucket the copies live only on this server: download one now and then as below.

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

Set the new server up with [the installer](#5-run-the-installer). From your computer, upload the `backup` folder:

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
2. Check that both ports 80 and 443 are open in the Oracle Security List ([step 2](#2-open-ports-80-and-443)) and, without the installer's firewall, that you ran the `iptables` command ([manual install](#install-docker)).
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
