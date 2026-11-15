import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { BrowserFrame, PhoneFrame, Shot, ThemedShot } from "@/components/frames";
import { InstallCommand } from "@/components/install";
import { JsonLd } from "@/components/json-ld";
import { PanelTabs } from "@/components/panel-tabs";
import { Story } from "@/components/story";
import { DEMO, GITHUB } from "@/lib/layout";

export const metadata: Metadata = { alternates: { canonical: "/" } };

const SITE = "https://librefunnel.com";

const SALE = [
  {
    time: "21:04",
    title: "Do anúncio à página de vendas",
    text: "Ana toca no seu anúncio no Instagram. A loja guarda a campanha e o clique, o vídeo começa e o botão de compra aparece no segundo que você escolheu.",
    shot: "sales",
    alt: "Página de vendas com vídeo e contagem regressiva da oferta, no celular",
  },
  {
    time: "21:09",
    title: "Checkout com order bump",
    text: "Nome, e-mail e WhatsApp. Ana marca a oferta extra e o total muda na hora.",
    shot: "checkout",
    alt: "Checkout com order bump marcado e total de R$ 116,90",
  },
  {
    time: "21:10",
    title: "Pix na tela",
    text: "QR Code e copia e cola, com o prazo de pagamento. A página espera sozinha pela confirmação.",
    shot: "pix",
    alt: "Página do Pix com QR Code, código copia e cola e status aguardando pagamento",
  },
  {
    time: "21:11",
    title: "Pago",
    text: "O provedor confirma o valor inteiro e a página muda para Pago. A Meta recebe a compra pela API de Conversões.",
    shot: "paid",
    alt: "Página de pagamento confirmado com botão para entrar na área de membros",
  },
  {
    time: "21:11",
    title: "Primeira aula",
    text: "O link de entrada chega por e-mail, sem senha. Ana já está na área de membros.",
    shot: "members",
    alt: "Área de membros com cursos, módulos e progresso das aulas",
  },
];

const RECOVERY = [
  { time: "21:20", title: "Pix gerado", text: "Bruno gera o Pix e fecha o app do banco antes de pagar." },
  { time: "21:50", title: "E-mail", text: "O primeiro passo da recuperação manda o Pix de novo." },
  { time: "09:00", title: "WhatsApp", text: "O passo das 22:20 esperou: nada automático sai entre 21h e 9h." },
  { time: "09:06", title: "Pago", text: "Bruno paga. A recuperação para na hora e o acesso chega por e-mail." },
];

const PANEL = [
  {
    shot: "summary",
    label: "Resumo",
    path: "/admin",
    text: "Receita líquida, vendas, ticket médio, order bump e vendas recuperadas, com os Pix que esperam liberação.",
  },
  {
    shot: "orders",
    label: "Pedidos",
    path: "/admin/orders",
    text: "Busca por nome, e-mail, WhatsApp ou Pix. Liberar, reembolsar e exportar em CSV.",
  },
  {
    shot: "automations",
    label: "Automações",
    path: "/admin/automations",
    text: "Os passos da recuperação por e-mail e WhatsApp, e as respostas automáticas por palavra-chave.",
  },
];

const PRICE = 9700;

const FEES = [
  { name: "Pix direto na sua chave", rule: "sem tarifa, liberação manual", fee: () => 0 },
  { name: "Woovi", rule: "0,80% (mínimo R$ 0,50)", fee: (price: number) => Math.max(50, Math.round(price * 0.008)) },
  { name: "AbacatePay", rule: "R$ 0,80 por Pix", fee: () => 80 },
  { name: "Mercado Pago", rule: "0,99%", fee: (price: number) => Math.round(price * 0.0099) },
];

const PLATFORMS = [
  { name: "Kiwify", rule: "8,99% + R$ 2,49", fee: (price: number) => Math.round(price * 0.0899) + 249 },
  { name: "Hotmart", rule: "9,9% + R$ 2,49", fee: (price: number) => Math.round(price * 0.099) + 249 },
];

const INCLUDED = [
  [
    "Página de vendas",
    "Vídeo com a oferta no segundo escolhido, prazo real, garantia, depoimentos, perguntas e legendas.",
  ],
  ["Checkout Pix", "QR Code, copia e cola, order bump e aparência configurável."],
  ["Área de membros", "Módulos, aulas, progresso e entrada por link enviado por e-mail."],
  ["Recuperação", "E-mail por qualquer SMTP e WhatsApp pelo QR Code ou pela API oficial da Meta."],
  ["Atribuição", "UTMs com primeiro e último toque, e vendas enviadas à Meta pela API de Conversões."],
  ["Nota fiscal", "NFS-e de cada venda pelo Emissor Nacional, com o certificado A1 da empresa. Opcional."],
  ["Painel", "Faturamento, funil, origens, pedidos com liberação e reembolso, retenção do vídeo e CSV."],
  ["Operação", "HTTPS automático, backup diário de 7 dias, atualização pelo painel e vídeos no Cloudflare R2."],
];

const LIMITS = [
  "Só Pix. Sem cartão de crédito e sem boleto.",
  "Sem assinatura ou cobrança recorrente: cada compra é um pagamento único.",
  "Sem cupom, afiliados ou upsell depois da compra. O order bump é a única oferta extra.",
  "Sem editor visual. Você muda textos, vídeo, cor e blocos, mas o layout é fixo.",
  "Uma loja e uma senha de painel por instalação.",
  "O servidor é seu: a hospedagem e uma cópia dos backups fora dele ficam com você.",
];

const FAQ = [
  {
    q: "O que é o LibreFunnel?",
    a: "Um funil de vendas de código aberto (licença MIT) para quem vende infoproduto no Brasil: página de vendas com vídeo, checkout Pix, área de membros, recuperação de carrinho e painel, num app que você instala no seu servidor.",
  },
  {
    q: "Quanto custa?",
    a: "O LibreFunnel não cobra nada, nem por venda. Os custos possíveis são de terceiros: o servidor (o plano grátis da Oracle Cloud basta), o domínio e a tarifa do provedor de Pix, se você usar um.",
  },
  {
    q: "Qual a diferença para Hotmart ou Kiwify?",
    a: "Hotmart e Kiwify hospedam a loja e ficam com uma parte de cada venda (Kiwify 8,99% + R$ 2,49, Hotmart 9,9% + R$ 2,49). O LibreFunnel roda no seu servidor e o Pix cai direto na sua conta. Em troca, não tem cartão, boleto, assinatura nem afiliados.",
  },
  {
    q: "Quem hospeda a minha loja?",
    a: "Você, num servidor seu. Nenhum pedido, comprador ou senha passa por librefunnel.com.",
  },
  {
    q: "Preciso saber programar?",
    a: "Não. Você conecta no servidor por SSH, cola um comando e responde algumas perguntas. O resto é no painel.",
  },
  {
    q: "Preciso de CNPJ?",
    a: "Não para começar. O Pix direto na sua chave e o Mercado Pago aceitam CPF. Woovi e AbacatePay pedem CNPJ, e MEI serve.",
  },
  {
    q: "Aceita cartão?",
    a: "Não. O pagamento é só por Pix, direto na sua chave ou por Mercado Pago, Woovi ou AbacatePay.",
  },
  {
    q: "Emite nota fiscal?",
    a: "Sim, se você quiser: a loja emite a NFS-e de cada venda paga pelo Emissor Nacional, com o certificado A1 da empresa, e cancela a nota no reembolso.",
  },
];

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function brl(cents: number) {
  return money.format(cents / 100);
}

function Mark({ className }: { className: string }) {
  return (
    <svg viewBox="6 5 52 52" aria-hidden className={className}>
      <path
        d="M41.2 20.9A16 16 0 1 1 22.8 20.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <circle cx="32" cy="13" r="5" fill="currentColor" />
    </svg>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="font-mono text-xs tracking-[0.08em] text-fd-primary uppercase">{children}</p>;
}

function Heading({ eyebrow, title, lead }: { eyebrow: string; title: string; lead?: string }) {
  return (
    <div className="reveal grid max-w-2xl gap-3">
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="text-3xl font-medium tracking-[-0.03em] text-balance md:text-5xl">{title}</h2>
      {lead ? <p className="text-lg text-fd-muted-foreground">{lead}</p> : null}
    </div>
  );
}

function FeeRow({ name, rule, fee, muted }: { name: string; rule: string; fee: number; muted?: boolean }) {
  const kept = PRICE - fee;

  return (
    <li className="grid gap-2 border-b border-fd-border py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <p className="font-medium">
          {name} <span className="font-normal text-fd-muted-foreground">· {rule}</span>
        </p>
        <p className="font-mono text-sm tabular-nums">
          <span className={muted ? "text-fd-muted-foreground" : "text-paid"}>{brl(kept)}</span>
          <span className="text-fd-muted-foreground"> · tarifa {brl(fee)}</span>
        </p>
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-fd-muted" aria-hidden>
        <span
          className={`bar-grow h-full rounded-full ${muted ? "bg-fd-muted-foreground/50" : "bg-paid"}`}
          style={{ width: `${(kept / PRICE) * 100}%` }}
        />
        <span className="h-full bg-fee" style={{ width: `${(fee / PRICE) * 100}%` }} />
      </div>
    </li>
  );
}

const STRUCTURED = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE}/#org`,
      name: "LibreFunnel",
      url: SITE,
      logo: `${SITE}/icon.svg`,
      sameAs: [GITHUB],
    },
    {
      "@type": "WebSite",
      "@id": `${SITE}/#site`,
      name: "LibreFunnel",
      url: SITE,
      inLanguage: "pt-BR",
      publisher: { "@id": `${SITE}/#org` },
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${SITE}/#app`,
      name: "LibreFunnel",
      description:
        "Funil de vendas de código aberto para infoprodutos no Brasil: página de vendas com vídeo, checkout Pix com order bump, área de membros, recuperação de carrinho por e-mail e WhatsApp, atribuição com a API de Conversões da Meta e painel. Instalado no servidor do vendedor, sem taxa por venda.",
      url: SITE,
      applicationCategory: "BusinessApplication",
      applicationSubCategory: "Sales funnel and checkout",
      operatingSystem: "Linux (Docker)",
      inLanguage: "pt-BR",
      license: "https://opensource.org/licenses/MIT",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "BRL" },
      screenshot: [`${SITE}/shots/summary-light.webp`, `${SITE}/shots/checkout.webp`, `${SITE}/shots/pix.webp`],
      featureList: INCLUDED.map(([term, text]) => `${term}: ${text}`),
      downloadUrl: `${SITE}/install`,
      installUrl: `${SITE}/docs/instalar/`,
      publisher: { "@id": `${SITE}/#org` },
    },
    {
      "@type": "SoftwareSourceCode",
      name: "LibreFunnel",
      codeRepository: GITHUB,
      programmingLanguage: "TypeScript",
      license: "https://opensource.org/licenses/MIT",
      targetProduct: { "@id": `${SITE}/#app` },
    },
    {
      "@type": "FAQPage",
      mainEntity: FAQ.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    },
    {
      "@type": "HowTo",
      name: "Como instalar o LibreFunnel",
      tool: [{ "@type": "HowToTool", name: "Servidor Linux x64 ou arm64 com 2 GB de memória" }],
      step: [
        { "@type": "HowToStep", text: "Conecte no servidor por SSH." },
        { "@type": "HowToStep", text: "Rode: curl -fsSL https://librefunnel.com/install | sh" },
        { "@type": "HowToStep", text: "Responda as perguntas do instalador (domínio e e-mail)." },
        { "@type": "HowToStep", text: "Abra /admin no seu domínio e configure produtos, Pix e e-mail." },
      ],
    },
  ],
};

export default function HomePage() {
  const platformFee = Math.max(...PLATFORMS.map((platform) => platform.fee(PRICE)));

  return (
    <div className="bg-fd-background">
      <JsonLd data={STRUCTURED} />
      <header className="relative m-3 overflow-hidden rounded-3xl bg-brand text-white md:m-6">
        <div aria-hidden className="dots absolute inset-0" />
        <nav className="relative flex items-center justify-between gap-4 p-4 md:px-8 md:py-6">
          <Link href="/" className="flex min-h-11 items-center gap-2 text-lg font-semibold tracking-tight">
            <Mark className="size-7" />
            LibreFunnel
          </Link>
          <div className="flex items-center gap-2 text-sm sm:gap-6">
            <Link href="/docs/" className="flex min-h-11 items-center px-2 hover:underline">
              Docs
            </Link>
            <a href={DEMO} className="hidden min-h-11 items-center px-2 hover:underline sm:flex">
              Demo
            </a>
            <a
              href={GITHUB}
              className="flex min-h-11 items-center rounded-full bg-white/15 px-4 font-medium hover:bg-white/25"
            >
              GitHub
            </a>
          </div>
        </nav>

        <div className="relative mx-auto grid max-w-[1200px] items-center gap-12 px-4 pt-8 pb-0 md:px-8 lg:grid-cols-[minmax(0,6fr)_minmax(0,7fr)] lg:gap-8 lg:pt-12">
          <div className="grid justify-items-start gap-6 lg:pb-24">
            <p className="rise [--delay:0s] rounded-full bg-white/15 px-3 py-1.5 font-mono text-[11px] tracking-[0.08em] uppercase">
              Código aberto · Sem taxa por venda
            </p>
            <h1 className="rise [--delay:0.08s] text-[clamp(2.75rem,7vw,5rem)] leading-[0.95] font-medium tracking-[-0.045em] text-balance">
              Seu funil de vendas, no seu servidor.
            </h1>
            <p className="rise [--delay:0.16s] max-w-xl text-lg text-white/85 md:text-xl">
              Página de vendas, checkout Pix, área de membros e recuperação de carrinho num app que você instala com um
              comando. O Pix cai direto na sua conta.
            </p>
            <div className="rise [--delay:0.24s] w-full">
              <InstallCommand />
            </div>
            <a
              href={DEMO}
              className="rise [--delay:0.32s] flex min-h-11 items-center gap-2 font-medium underline-offset-4 hover:underline"
            >
              Testar a demonstração <span aria-hidden>→</span>
            </a>
          </div>

          <div className="relative pb-10 lg:pb-0">
            <div className="rise [--delay:0.3s] lg:translate-y-10">
              <BrowserFrame url="loja.seudominio.com.br/admin">
                <ThemedShot name="summary" alt="Resumo do painel com receita líquida, vendas e gráfico diário" eager />
              </BrowserFrame>
            </div>
            <div className="rise [--delay:0.5s] absolute right-2 -bottom-2 w-[30%] min-w-[120px] max-w-[200px] lg:-right-6 lg:bottom-0">
              <PhoneFrame>
                <Shot name="paid" alt="Pagamento confirmado no celular do comprador" eager />
              </PhoneFrame>
            </div>
            <div
              role="status"
              className="pop [--delay:1.4s] absolute top-6 left-3 flex items-center gap-3 rounded-2xl bg-white px-4 py-3 text-[#181917] shadow-xl md:top-10 lg:left-6"
            >
              <span className="grid size-9 place-items-center rounded-full bg-[#e5f2ea] text-[#1f7a4d]">
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden
                  className="size-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                >
                  <path d="M5 12.5l4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              <span className="grid text-sm leading-tight">
                <span className="font-semibold">Pix recebido: {brl(11690)}</span>
                <span className="text-[#686b64]">Ana Souza · acesso liberado</span>
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1200px] px-4 md:px-8">
        <section className="grid gap-6 py-20 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-16 md:py-32">
          <Heading eyebrow="O que é" title="Você vende. A loja trabalha." />
          <div className="reveal grid content-end gap-5 text-lg md:text-xl">
            <p>
              O LibreFunnel é para quem vende curso, mentoria ou outro produto digital no Brasil. Ele junta a página de
              vendas com vídeo, o checkout Pix, a área de membros, a recuperação por e-mail e WhatsApp e o painel com a
              origem de cada venda.
            </p>
            <p className="text-fd-muted-foreground">
              O código é aberto, sob licença MIT. Você instala com um comando, configura tudo pelo painel e atualiza com
              um clique, com backup antes.
            </p>
          </div>
        </section>

        <section className="grid gap-12 border-t border-fd-border py-20 md:py-32">
          <Heading
            eyebrow="Uma venda, minuto a minuto"
            title="Do anúncio à primeira aula em sete minutos."
            lead="Telas reais da demonstração, numa loja com provedor de Pix, WhatsApp e Meta conectados."
          />
          <Story steps={SALE} />
          <div className="reveal grid gap-6 rounded-3xl bg-fd-card p-6 md:grid-cols-[minmax(0,4fr)_minmax(0,8fr)] md:gap-12 md:p-10">
            <div className="grid content-start gap-2">
              <Eyebrow>Quem esquece</Eyebrow>
              <h3 className="text-2xl font-medium tracking-tight">A recuperação busca o Pix que ficou para trás.</h3>
            </div>
            <ol className="grid gap-0 sm:grid-cols-4">
              {RECOVERY.map((step, index) => (
                <li
                  key={step.time}
                  className="relative grid content-start gap-2 border-l border-fd-border py-3 pl-5 sm:border-t sm:border-l-0 sm:pt-5 sm:pr-4 sm:pl-0"
                >
                  <span
                    aria-hidden
                    className={`absolute top-4 -left-[5px] size-2.5 rounded-full sm:-top-[5px] sm:left-0 ${index === RECOVERY.length - 1 ? "bg-paid" : "bg-fd-primary"}`}
                  />
                  <span className="font-mono text-sm text-fd-primary tabular-nums">{step.time}</span>
                  <span className="font-medium">{step.title}</span>
                  <span className="text-sm text-fd-muted-foreground">{step.text}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="grid gap-10 border-t border-fd-border py-20 md:py-32">
          <Heading
            eyebrow="Painel"
            title="Vendi? Quebrou algo? Quem eu libero?"
            lead="As três perguntas de todo dia, respondidas na primeira tela. Claro ou escuro, no computador ou no celular."
          />
          <PanelTabs tabs={PANEL} />
        </section>

        <section className="grid gap-10 border-t border-fd-border py-20 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-16 md:py-32">
          <div className="grid content-start gap-6">
            <Heading
              eyebrow="Seu Pix, sem intermediário"
              title={`Numa venda de ${brl(PRICE)}, quanto fica com você.`}
              lead="O LibreFunnel não fica com parte da venda. A tarifa, quando existe, é do provedor de Pix que você escolher."
            />
            <p className="reveal rounded-2xl bg-paid-soft p-5">
              Até <strong className="font-semibold">{brl(platformFee)}</strong> a mais por venda em relação a uma
              plataforma que cobra por venda. Em 100 vendas, {brl(platformFee * 100)}.
            </p>
          </div>
          <div className="reveal grid gap-8">
            <div>
              <p className="mb-2 font-mono text-xs tracking-[0.08em] text-fd-muted-foreground uppercase">
                Com o LibreFunnel
              </p>
              <ul className="border-t border-fd-border">
                {FEES.map((row) => (
                  <FeeRow key={row.name} name={row.name} rule={row.rule} fee={row.fee(PRICE)} />
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-2 font-mono text-xs tracking-[0.08em] text-fd-muted-foreground uppercase">
                Plataformas que cobram por venda
              </p>
              <ul className="border-t border-fd-border">
                {PLATFORMS.map((row) => (
                  <FeeRow key={row.name} name={row.name} rule={row.rule} fee={row.fee(PRICE)} muted />
                ))}
              </ul>
            </div>
            <p className="text-sm text-fd-muted-foreground">
              Tarifas públicas de novembro de 2026. Woovi também tem plano de R$ 0,85 por Pix. Hotmart e Kiwify incluem
              cartão, boleto e afiliados, que o LibreFunnel não tem.{" "}
              <Link href="/docs/conexoes/" className="text-fd-primary underline underline-offset-4">
                Provedores e como conectar
              </Link>
            </p>
          </div>
        </section>

        <section className="grid gap-10 border-t border-fd-border py-20 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-16 md:py-32">
          <Heading eyebrow="Incluído" title="O que vem junto." />
          <dl className="reveal border-t border-fd-border">
            {INCLUDED.map(([term, text], index) => (
              <div
                key={term}
                className="grid gap-1 border-b border-fd-border py-4 sm:grid-cols-[2.5rem_11rem_1fr] sm:gap-4"
              >
                <span aria-hidden className="hidden font-mono text-sm text-fd-primary tabular-nums sm:block">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <dt className="font-medium">{term}</dt>
                <dd className="text-fd-muted-foreground">{text}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="grid gap-10 border-t border-fd-border py-20 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-16 md:py-32">
          <Heading eyebrow="Limites" title="O que ainda não faz." lead="Melhor saber antes de instalar." />
          <ul className="reveal border-t border-fd-border">
            {LIMITS.map((limit) => (
              <li key={limit} className="flex gap-4 border-b border-fd-border py-4">
                <span aria-hidden className="font-mono text-fd-muted-foreground">
                  ×
                </span>
                {limit}
              </li>
            ))}
          </ul>
        </section>

        <section className="grid gap-10 border-t border-fd-border py-20 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-16 md:py-32">
          <Heading eyebrow="Perguntas" title="Antes de instalar." />
          <div className="reveal">
            <div className="border-t border-fd-border">
              {FAQ.map((item) => (
                <details key={item.q} className="group border-b border-fd-border">
                  <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4 font-medium">
                    <h3>{item.q}</h3>
                    <span
                      aria-hidden
                      className="font-mono text-xl text-fd-primary transition-transform duration-200 group-open:rotate-45"
                    >
                      +
                    </span>
                  </summary>
                  <p className="pb-5 text-fd-muted-foreground">{item.a}</p>
                </details>
              ))}
            </div>
            <p className="mt-6">
              <Link href="/docs/perguntas/" className="font-medium text-fd-primary underline underline-offset-4">
                Todas as perguntas, com segurança e LGPD
              </Link>
            </p>
          </div>
        </section>
      </main>

      <footer className="px-3 pb-3 md:px-6 md:pb-6">
        <div className="relative overflow-hidden rounded-3xl bg-brand text-white">
          <div aria-hidden className="dots absolute inset-0" />
          <div className="relative mx-auto grid max-w-[1200px] gap-8 px-6 py-16 md:px-8 md:py-24">
            <h2 className="reveal max-w-3xl text-4xl font-medium tracking-[-0.04em] text-balance md:text-6xl">
              Um comando no seu servidor. Sua loja no ar.
            </h2>
            <div className="reveal grid justify-items-start gap-4">
              <InstallCommand />
              <div className="flex flex-wrap gap-x-6 gap-y-2 font-medium">
                <Link href="/docs/instalar/" className="flex min-h-11 items-center underline-offset-4 hover:underline">
                  Guia de instalação →
                </Link>
                <a href={DEMO} className="flex min-h-11 items-center underline-offset-4 hover:underline">
                  Testar a demonstração →
                </a>
              </div>
            </div>
          </div>
          <div className="relative mx-auto grid max-w-[1200px] gap-10 border-t border-white/15 px-6 py-10 md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))] md:px-8">
            <div className="grid content-start gap-3">
              <p className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                <Mark className="size-6" />
                LibreFunnel
              </p>
              <p className="max-w-xs text-sm text-white/75">
                Funil de vendas com Pix para infoprodutos, de código aberto, no seu servidor.
              </p>
            </div>
            <FooterLinks
              title="Produto"
              links={[
                ["Demonstração", DEMO],
                ["Instalar", "/docs/instalar/"],
                ["Conexões e tarifas", "/docs/conexoes/"],
              ]}
            />
            <FooterLinks
              title="Docs"
              links={[
                ["Visão geral", "/docs/"],
                ["Atualizar", "/docs/atualizar/"],
                ["Perguntas", "/docs/perguntas/"],
              ]}
            />
            <FooterLinks
              title="Projeto"
              links={[
                ["GitHub", GITHUB],
                ["Licença MIT", `${GITHUB}/blob/main/LICENSE`],
                ["Privacidade", "/docs/privacidade/"],
              ]}
            />
          </div>
          <div className="relative mx-auto flex max-w-[1200px] flex-wrap justify-between gap-2 border-t border-white/15 px-6 py-5 text-sm text-white/75 md:px-8">
            <p>© 2026 LibreFunnel</p>
            <a href="/llms.txt" className="hover:text-white">
              llms.txt
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FooterLinks({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div className="grid content-start gap-3 text-sm">
      <p className="font-mono text-xs tracking-[0.08em] text-white/60 uppercase">{title}</p>
      <ul className="grid gap-2">
        {links.map(([text, href]) => (
          <li key={text}>
            <a href={href} className="hover:underline">
              {text}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
