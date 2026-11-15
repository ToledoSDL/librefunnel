import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { InstallCommand } from "@/components/install";
import { DEMO, GITHUB } from "@/lib/layout";

export const metadata: Metadata = { alternates: { canonical: "/" } };

const PHOTO = "url(/hero.webp)";

const PAID = [
  {
    time: "21:04",
    title: "Anúncio",
    text: "Ana toca no seu anúncio no Instagram. A loja guarda a origem: campanha, anúncio e o clique.",
  },
  {
    time: "21:05",
    title: "Página de vendas",
    text: "O vídeo começa. O botão de compra aparece no segundo que você escolheu e não some mais.",
  },
  {
    time: "21:09",
    title: "Checkout",
    text: "Nome, e-mail, WhatsApp e o order bump marcado. O Pix sai com QR Code e copia e cola.",
  },
  {
    time: "21:11",
    title: "Pix pago",
    text: "O provedor confirma o valor inteiro e a página do Pix muda sozinha. A Meta recebe a compra.",
  },
  {
    time: "21:11",
    title: "Acesso no e-mail",
    text: "Chega o link de entrada na área de membros, sem senha. Ana já está na primeira aula.",
  },
];

const FORGOT = [
  { time: "21:20", title: "Pix gerado", text: "Bruno gera o Pix e fecha o app do banco antes de pagar." },
  {
    time: "21:50",
    title: "E-mail de lembrete",
    text: "O primeiro passo da recuperação, que aqui você marcou para 30 minutos, manda o Pix de novo.",
  },
  {
    time: "09:00",
    title: "WhatsApp",
    text: "O passo de WhatsApp das 22:20 esperou: nada automático sai entre 21h e 9h.",
  },
  { time: "09:06", title: "Pago", text: "Bruno paga. A recuperação para na hora, e o acesso chega por e-mail." },
];

const PIX = [
  { name: "Pix direto na sua chave", fee: "Sem tarifa. Você confere o extrato e libera o pedido." },
  { name: "Mercado Pago", fee: "0,99% por venda. CPF ou CNPJ." },
  {
    name: "Woovi",
    fee: "0,80% por Pix (mínimo R$ 0,50, máximo R$ 5,00) ou R$ 0,85 por Pix, conforme o plano. CNPJ, MEI serve.",
  },
  { name: "AbacatePay", fee: "R$ 0,80 por Pix. CNPJ, MEI serve." },
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
  ["Painel", "Faturamento, funil, origens, pedidos com liberação e reembolso, retenção do vídeo e CSV."],
  ["Operação", "HTTPS automático, backup diário de 7 dias, atualização pelo painel e vídeos no Cloudflare R2."],
];

const LIMITS = [
  "Só Pix. Sem cartão de crédito e sem boleto.",
  "Sem assinatura ou cobrança recorrente: cada compra é um pagamento único.",
  "Sem cupom, afiliados ou upsell depois da compra. O order bump é a única oferta extra.",
  "Sem editor visual. Você muda textos, vídeo, cor e blocos, mas o layout é fixo.",
  "Não emite nota fiscal.",
  "Uma loja e uma senha de painel por instalação.",
  "O servidor é seu: a hospedagem e uma cópia dos backups fora dele ficam com você.",
];

const FAQ = [
  {
    q: "Quanto custa?",
    a: "O LibreFunnel não cobra nada. Os custos possíveis são de terceiros: o servidor (o plano grátis da Oracle Cloud basta), o domínio e a tarifa do provedor de Pix, se você usar um.",
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
    q: "Aceita cartão?",
    a: "Não. O pagamento é só por Pix, direto na sua chave ou por Mercado Pago, Woovi ou AbacatePay.",
  },
];

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

function Pill({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full bg-black/45 px-3 py-1.5 font-mono text-[11px] tracking-[0.08em] text-white uppercase">
      {children}
    </span>
  );
}

function Section({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) {
  return (
    <section className="grid gap-8 border-t border-fd-border py-16 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-16 md:py-24">
      <div className="grid content-start gap-3">
        <h2 className="text-3xl font-medium tracking-[-0.03em] text-balance md:text-4xl">{title}</h2>
        {lead ? <p className="text-fd-muted-foreground">{lead}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function Timeline({ label, steps }: { label: string; steps: typeof PAID }) {
  return (
    <div className="grid gap-4">
      <p className="font-mono text-xs tracking-[0.08em] text-fd-muted-foreground uppercase">{label}</p>
      <ol className="border-t border-fd-border">
        {steps.map((step) => (
          <li
            key={step.time + step.title}
            className="grid grid-cols-[4rem_minmax(0,1fr)] gap-4 border-b border-fd-border py-4"
          >
            <span className="pt-0.5 font-mono text-sm text-fd-primary tabular-nums">{step.time}</span>
            <div>
              <h3 className="font-medium">{step.title}</h3>
              <p className="text-fd-muted-foreground">{step.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="bg-fd-background">
      <header
        className="relative m-3 flex min-h-[min(calc(100svh-1.5rem),760px)] flex-col overflow-hidden rounded-2xl bg-[#141513] bg-cover bg-center text-white md:m-16 md:min-h-[min(calc(100svh-8rem),820px)]"
        style={{ backgroundImage: PHOTO }}
      >
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(rgb(0_0_0/0.22)_1px,transparent_1.4px)] bg-size-[4px_4px]"
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(ellipse_70%_55%_at_50%_55%,rgb(0_0_0/0.5),transparent)]"
        />
        <nav className="relative flex items-center justify-between gap-4 p-4 md:p-6">
          <Link href="/" className="flex min-h-11 items-center gap-2 text-lg font-semibold tracking-tight">
            <Mark className="size-7" />
            LibreFunnel
          </Link>
          <div className="flex items-center gap-4 text-sm">
            <Link href="/docs/" className="hidden min-h-11 items-center sm:flex">
              Docs
            </Link>
            <a href={GITHUB} className="rounded-full">
              <Pill>Código aberto · MIT</Pill>
            </a>
          </div>
        </nav>
        <div className="relative flex flex-1 flex-col items-center justify-center gap-6 px-4 pt-6 pb-16 text-center md:gap-8">
          <Pill>Loja própria · Sem taxa por venda</Pill>
          <h1 className="max-w-5xl text-[clamp(3.25rem,9vw,6rem)] leading-[0.95] font-medium tracking-[-0.04em] text-balance">
            Seu funil de vendas, no seu servidor.
          </h1>
          <p className="max-w-xl text-lg text-white/90 md:text-xl">
            Página de vendas, checkout Pix, área de membros e recuperação de carrinho num app de código aberto.
            <br className="hidden sm:block" /> O dinheiro vai direto para a sua chave Pix.
          </p>
          <InstallCommand />
          <a href={DEMO} className="min-h-11 content-center font-medium underline underline-offset-4">
            Testar a demonstração →
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-[1100px] px-4 md:px-8">
        <Section
          title="Você vende. A loja trabalha."
          lead="Um app no seu servidor faz o que costuma exigir cinco assinaturas e uma taxa em cada venda."
        >
          <div className="grid gap-5 text-lg">
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
        </Section>

        <Section
          title="Uma venda, minuto a minuto."
          lead="Duas noites comuns numa loja com provedor de Pix, WhatsApp e Meta conectados."
        >
          <div className="grid gap-12">
            <Timeline label="Quem paga" steps={PAID} />
            <Timeline label="Quem esquece" steps={FORGOT} />
          </div>
        </Section>

        <Section
          title="Seu Pix. Sem intermediário."
          lead="O LibreFunnel não fica com parte da venda. Você escolhe como receber, e a tarifa, quando existe, é do provedor."
        >
          <dl className="border-t border-fd-border">
            {PIX.map((row) => (
              <div
                key={row.name}
                className="grid gap-1 border-b border-fd-border py-4 sm:grid-cols-[12rem_1fr] sm:gap-6"
              >
                <dt className="font-medium">{row.name}</dt>
                <dd className="text-fd-muted-foreground">{row.fee}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-sm text-fd-muted-foreground">Tarifas de novembro de 2026.</p>
        </Section>

        <Section title="O que vem junto.">
          <dl className="border-t border-fd-border">
            {INCLUDED.map(([term, text]) => (
              <div key={term} className="grid gap-1 border-b border-fd-border py-4 sm:grid-cols-[12rem_1fr] sm:gap-6">
                <dt className="font-medium">{term}</dt>
                <dd className="text-fd-muted-foreground">{text}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section title="O que ainda não faz." lead="Melhor saber antes de instalar.">
          <ul className="border-t border-fd-border">
            {LIMITS.map((limit) => (
              <li key={limit} className="border-b border-fd-border py-4">
                {limit}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Perguntas.">
          <div className="border-t border-fd-border">
            {FAQ.map((item) => (
              <details key={item.q} className="group border-b border-fd-border">
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4 font-medium">
                  {item.q}
                  <span aria-hidden className="font-mono text-fd-muted-foreground group-open:rotate-45">
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
        </Section>
      </main>

      <footer className="px-3 pb-3 md:px-16 md:pb-16">
        <div className="mx-auto overflow-hidden rounded-2xl bg-fd-card">
          <div
            aria-hidden
            className="h-28 bg-[#141513] bg-cover bg-center mask-[linear-gradient(to_bottom,black,transparent)] md:h-40"
            style={{ backgroundImage: PHOTO }}
          />
          <div className="grid gap-10 px-6 pb-8 md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))] md:px-10">
            <div className="grid content-start gap-3">
              <p className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                <Mark className="size-6 text-fd-primary" />
                LibreFunnel
              </p>
              <p className="max-w-xs text-sm text-fd-muted-foreground">
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
                ["Demo", DEMO],
              ]}
            />
          </div>
          <div className="flex flex-wrap justify-between gap-2 border-t border-fd-border px-6 py-5 text-sm text-fd-muted-foreground md:px-10">
            <p>© 2026 LibreFunnel</p>
            <a href={GITHUB} className="hover:text-fd-foreground">
              Código aberto no GitHub
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
      <p className="font-mono text-xs tracking-[0.08em] text-fd-muted-foreground uppercase">{title}</p>
      <ul className="grid gap-2">
        {links.map(([text, href]) => (
          <li key={text}>
            <a href={href} className="hover:text-fd-primary">
              {text}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
