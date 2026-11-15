import { Button } from "@/components/action/button";
import { Checklist } from "@/components/feedback/checklist";
import type { ChecklistStepItem } from "@/components/feedback/checklist-step";
import { TextLink } from "@/components/text/text-link";
import type { productStates, Settings } from "@/lib/catalog";
import { Email, Meta, WhatsApp } from "../connections/channels";
import connections from "../connections/connections.module.css";
import { href, type Links } from "../shared";
import { BrandForm } from "./brand-form";
import { DemoProducts } from "./demo-products";
import { PixChoice } from "./pix-choice";

const DEMO_PRODUCTS = new Set(["metodo-demo", "planilha-metas"]);

// settings() falls back to this name until the seller saves one.
const DEFAULT_BRAND = "LibreFunnel";

export function Setup({
  links,
  store,
  items,
}: {
  links: Links;
  store: Settings;
  items: Awaited<ReturnType<typeof productStates>>;
}) {
  const own = items.filter((item) => !item.archived && !DEMO_PRODUCTS.has(item.slug));
  const demos = items.filter((item) => DEMO_PRODUCTS.has(item.slug));
  const liveDemos = demos.filter((item) => !item.archived);
  const provider = links.pix.providers.find((entry) => entry.active);

  const steps: ChecklistStepItem[] = [
    {
      id: "brand",
      title: "Identidade da loja",
      level: "required",
      done: store.brand !== DEFAULT_BRAND || Boolean(store.logo),
      status: store.brand,
      why: "O nome e o logo aparecem no checkout, nos e-mails e na área de membros: é por eles que quem compra reconhece você.",
      children: <BrandForm store={store} />,
    },
    {
      id: "email",
      title: "E-mail de entrega",
      level: "required",
      done: links.email.configured,
      status: links.email.from || links.email.user,
      why: "Quem compra recebe por e-mail o link de acesso: sem ele, a venda acontece e o acesso não chega.",
      children: (
        <div className={connections.list}>
          <Email email={links.email} />
        </div>
      ),
    },
    {
      id: "pix",
      title: "Recebimento do Pix",
      level: "required",
      done: links.pix.account !== null && (links.pix.provider !== "static" || links.pix.chosen),
      status: provider?.id === "static" ? links.pix.account?.key : provider?.name,
      why: "Escolha como o dinheiro chega até você e como cada pagamento é confirmado.",
      children: <PixChoice pix={links.pix} />,
    },
    {
      id: "product",
      title: "Primeiro produto",
      level: "required",
      done: own.length > 0,
      status: own.length === 1 ? own[0]?.name : `${own.length} produtos`,
      why: "Dê nome e preço ao que você vende: a página de vendas e o checkout ficam prontos assim que você salva.",
      children: (
        <div>
          <Button href={href("products")} variant="solid" tone="primary" icon="arrow-right">
            Criar em Produtos
          </Button>
        </div>
      ),
    },
    ...(demos.length
      ? [
          {
            id: "demo",
            title: "Produtos de demonstração",
            level: "required" as const,
            done: liveDemos.length === 0,
            status: "Arquivados",
            why: "Os produtos de exemplo aparecem na vitrine e aceitam pedidos de verdade; arquivados, saem da loja e podem voltar em Produtos.",
            children: <DemoProducts items={liveDemos} />,
          },
        ]
      : []),
    {
      id: "whatsapp",
      title: "WhatsApp de vendas",
      level: "recommended",
      done: links.cloud.configured || links.whatsapp.state === "open",
      status: links.cloud.configured ? "WhatsApp oficial" : "Conectado",
      why: "Lembra quem gerou o Pix e não pagou e avisa quando o pagamento cai, recuperando vendas que se perderiam.",
      children: (
        <>
          <div className={connections.list}>
            <WhatsApp whatsapp={links.whatsapp} official={links.cloud.configured} />
          </div>
          <TextLink href={href("connections")}>Prefere a API oficial da Meta? Conecte em Conexões</TextLink>
        </>
      ),
    },
    {
      id: "meta",
      title: "Anúncios na Meta",
      level: "optional",
      done: links.meta.configured,
      status: "Conectada",
      why: "Cada venda é enviada para a Meta, que passa a mostrar seus anúncios a quem tem mais chance de comprar.",
      children: (
        <div className={connections.list}>
          <Meta meta={links.meta} />
        </div>
      ),
    },
  ];

  return <Checklist title="Prepare a loja para vender" readyTitle="Loja pronta para vender" steps={steps} />;
}
