import { mkdir } from "node:fs/promises";
import { type Page, chromium } from "playwright-core";

const DEMO = "https://demo.librefunnel.com";
const OUT = `${import.meta.dir}/public/shots`;
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: "pt-BR" };
const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: "pt-BR" };

async function save(page: Page, name: string, width: number) {
  await page.evaluate(() => {
    const hidden = /^(Demonstração do LibreFunnel|\d+ mensage(m|ns) falh|Prepare a loja para vender)/;
    const anchor = document.querySelector("h1, main");
    const matches = [...document.querySelectorAll<HTMLElement>("body *")].filter(
      (el) =>
        hidden.test(el.textContent ?? "") && ![...el.children].some((child) => hidden.test(child.textContent ?? "")),
    );
    for (let el of matches) {
      while (el.parentElement && anchor && !el.parentElement.contains(anchor)) el = el.parentElement;
      el.style.display = "none";
    }
  });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(500);
  const png = `${OUT}/${name}.png`;
  await page.screenshot({ path: png });
  await Bun.$`cwebp -quiet -q 82 -resize ${width} 0 ${png} -o ${OUT}/${name}.webp && rm ${png}`;
}

async function buy(page: Page, product: string, bump: boolean) {
  await page.goto(`${DEMO}/c/${product}`, { waitUntil: "networkidle" });
  await page.fill("input[name=name]", "Ana Souza");
  await page.fill("input[name=email]", "ana@exemplo.com.br");
  const confirm = page.locator("input[name=emailConfirm]");
  if (await confirm.count()) await confirm.fill("ana@exemplo.com.br");
  await page.fill("input[name=phone]", "11987654321");
  if (bump) await page.check("input[name=bump]");
}

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });

const loginContext = await browser.newContext(DESKTOP);
const login = await loginContext.newPage();
await login.goto(`${DEMO}/admin`, { waitUntil: "networkidle" });
await login.getByRole("button", { name: "Entrar na demonstração" }).click();
await login.getByRole("heading", { name: "Resumo" }).waitFor({ timeout: 60000 });
const session = await loginContext.storageState();
await loginContext.close();

for (const colorScheme of ["light", "dark"] as const) {
  const adminContext = await browser.newContext({ ...DESKTOP, colorScheme, storageState: session });
  const admin = await adminContext.newPage();
  for (const [name, path] of [
    ["summary", "/admin"],
    ["orders", "/admin/orders"],
    ["automations", "/admin/automations"],
  ]) {
    await admin.goto(`${DEMO}${path}`, { waitUntil: "networkidle" });
    await save(admin, `${name}-${colorScheme}`, 1600);
  }
  await adminContext.close();
}

const phoneContext = await browser.newContext(PHONE);
const phone = await phoneContext.newPage();
await phone.goto(`${DEMO}/v/bolo-no-pote`, { waitUntil: "networkidle" });
await save(phone, "sales", 780);
await buy(phone, "bolo-no-pote", true);
await save(phone, "checkout", 780);
await phone.click("button[type=submit]");
await phone.waitForURL((url) => url.searchParams.has("order"));
await phone.waitForLoadState("networkidle");
await save(phone, "pix", 780);
await phone.getByRole("button", { name: "Simular pagamento" }).click();
await phone.getByText("Entrar na área de membros").waitFor();
await save(phone, "paid", 780);
await phone.getByText("Entrar na área de membros").click();
await phone.waitForURL(`${DEMO}/m`);
await phone.waitForLoadState("networkidle");
await save(phone, "members", 780);
await phoneContext.close();

const inline = async (path: string, type: string) =>
  `data:${type};base64,${Buffer.from(await Bun.file(path).arrayBuffer()).toString("base64")}`;
const image = (name: string) => inline(`${OUT}/${name}.webp`, "image/webp");
const inter = await inline(
  `${import.meta.dir}/node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2`,
  "font/woff2",
);

const og = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await og.setContent(`<!doctype html>
<style>
  @font-face { font-family: Inter; font-weight: 100 900; src: url(${inter}); }
  body { margin: 0; width: 1200px; height: 630px; overflow: hidden; position: relative; font-family: Inter; color: #fff;
    background: #254ccb radial-gradient(rgb(255 255 255 / 0.14) 1px, transparent 1.4px) 0 0 / 18px 18px; }
  .logo { position: absolute; left: 72px; top: 64px; display: flex; gap: 14px; align-items: center; font: 600 34px Inter; letter-spacing: -0.02em; }
  h1 { position: absolute; left: 72px; top: 170px; width: 500px; margin: 0; font: 500 62px/1.02 Inter; letter-spacing: -0.045em; }
  p { position: absolute; left: 72px; bottom: 64px; margin: 0; font: 400 20px Inter; opacity: 0.85; }
  .admin { position: absolute; left: 700px; top: 90px; width: 760px; border-radius: 14px; box-shadow: 0 30px 60px -20px rgb(0 0 0 / 0.5); }
  .phone { position: absolute; left: 610px; top: 230px; width: 200px; border: 8px solid #181917; border-radius: 30px; box-shadow: 0 30px 60px -20px rgb(0 0 0 / 0.6); }
</style>
<div class="logo"><svg viewBox="6 5 52 52" width="44" height="44"><path d="M41.2 20.9A16 16 0 1 1 22.8 20.9" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round"/><circle cx="32" cy="13" r="5" fill="#fff"/></svg>LibreFunnel</div>
<h1>Funil de vendas com Pix, sem taxa por venda.</h1>
<p>Código aberto · no seu servidor · librefunnel.com</p>
<img class="admin" src="${await image("summary-light")}">
<img class="phone" src="${await image("paid")}">`);
await og.evaluate(() => document.fonts.ready);
await og.screenshot({ path: `${import.meta.dir}/public/og.png` });
await og.close();

await browser.close();
