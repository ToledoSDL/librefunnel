import type { ReactNode } from "react";
import { Input } from "@/components/form/input";
import { Select } from "@/components/form/select";
import { SettingRow } from "@/components/form/setting-row";
import { Switch } from "@/components/form/switch";
import { Textarea } from "@/components/form/textarea";
import { Card } from "@/components/layout/card";
import { saveSettings } from "@/lib/actions";
import type { Product, Settings } from "@/lib/catalog";
import { OUTLINE } from "../shared";
import { MediaUpload, SaveForm } from "../ui";
import { BrandStudio } from "./brand-studio";

// Same green the checkout uses when the store picks no color.
export const DEFAULT_ACCENT = "#1fa855";

export function Section({ children }: { children: ReactNode }) {
  return (
    <SaveForm action={saveSettings} bar label="Salvar alterações" pendingLabel="Salvando" done="Configurações salvas.">
      {children}
    </SaveForm>
  );
}

// A checked box posts "1" first; the hidden "0" after it only counts when the box is off.
export function Toggle({ name, checked, label }: { name: string; checked: boolean; label: string }) {
  return (
    <>
      <Switch name={name} value="1" defaultChecked={checked} label={label} />
      <input type="hidden" name={name} value="0" />
    </>
  );
}

export function StoreSection({ current, products }: { current: Settings; products: Product[] }) {
  return (
    <Section>
      <Card title="Loja">
        <div>
          <SettingRow title="Nome da loja" description="No topo das páginas, no painel e como remetente dos e-mails.">
            <Input aria-label="Nome da loja" name="brand" required maxLength={120} defaultValue={current.brand} />
          </SettingRow>
          <SettingRow
            title="Descrição"
            description="Uma frase sobre a loja. Aparece no Google e quando alguém compartilha o link."
          >
            <Textarea
              aria-label="Descrição da loja"
              name="description"
              rows={2}
              maxLength={200}
              defaultValue={current.description}
              placeholder="Cursos de confeitaria para vender em casa"
            />
          </SettingRow>
          <SettingRow
            title="Página inicial"
            description="O que abre no endereço principal da loja. Com um produto só, leve direto para a página dele."
          >
            <Select
              aria-label="Página inicial"
              name="home"
              defaultValue={current.home ?? ""}
              options={[
                { value: "", label: "Vitrine com todos os produtos" },
                ...products.map((product) => ({ value: product.slug, label: product.name })),
              ]}
            />
          </SettingRow>
          <SettingRow
            title="Imagem de compartilhamento"
            description="Aparece no WhatsApp, Instagram e Facebook quando o link da loja é enviado. 1200 × 630."
          >
            <MediaUpload
              id="shareImage"
              name="shareImage"
              kind="image"
              value={current.shareImage}
              button={OUTLINE}
              remove={OUTLINE}
            />
          </SettingRow>
        </div>
      </Card>
    </Section>
  );
}

export function BrandSection({ current }: { current: Settings }) {
  return (
    <Section>
      <Card title="Marca">
        <div>
          <SettingRow
            title="Logo"
            description="Substitui o símbolo do LibreFunnel no checkout, na área de membros e no painel. PNG ou WebP com fundo transparente, na horizontal."
          >
            <MediaUpload id="logo" name="logo" kind="image" value={current.logo} button={OUTLINE} remove={OUTLINE} />
          </SettingRow>
          <SettingRow
            title="Ícone da aba"
            description="O ícone pequeno do navegador. Quadrado, PNG, pelo menos 64 × 64."
          >
            <MediaUpload id="icon" name="icon" kind="image" value={current.icon} button={OUTLINE} remove={OUTLINE} />
          </SettingRow>
          <SettingRow
            title="Cor principal"
            description="No botão de compra, no botão da página de vendas e nos destaques. O texto fica escuro ou branco sozinho para continuar legível."
          >
            <BrandStudio name={current.brand} logo={current.logo} accent={current.accent} fallback={DEFAULT_ACCENT} />
          </SettingRow>
          <SettingRow title="Selo LibreFunnel" description="“Feito com LibreFunnel” no rodapé das páginas.">
            <Toggle name="poweredBy" checked={current.poweredBy} label="Mostrar o selo" />
          </SettingRow>
        </div>
      </Card>
    </Section>
  );
}

export function NoticesSection({ current }: { current: Settings }) {
  return (
    <Section>
      <Card title="Avisos de venda para você">
        <div>
          <SettingRow
            title="Seu e-mail"
            description="Recebe um aviso a cada venda, com o link do pedido. Em branco, sem aviso."
          >
            <Input aria-label="Seu e-mail" name="ownerEmail" type="email" defaultValue={current.ownerEmail} />
          </SettingRow>
          <SettingRow
            title="Seu WhatsApp"
            description="Recebe o mesmo aviso no WhatsApp, enviado pelo número de vendas. Com DDD."
          >
            <Input
              aria-label="Seu WhatsApp"
              name="ownerWhatsapp"
              type="tel"
              inputMode="tel"
              placeholder="(48) 99999-0000"
              defaultValue={current.ownerWhatsapp}
            />
          </SettingRow>
        </div>
      </Card>
    </Section>
  );
}

export function LegalSection({ current }: { current: Settings }) {
  return (
    <Section>
      <Card title="Atendimento">
        <div>
          <SettingRow title="E-mail de suporte" description="No rodapé e nos e-mails, para o comprador falar com você.">
            <Input
              aria-label="E-mail de suporte"
              name="supportEmail"
              type="email"
              defaultValue={current.supportEmail}
            />
          </SettingRow>
          <SettingRow title="WhatsApp de suporte" description="Vira o botão Suporte no WhatsApp do rodapé. Com DDD.">
            <Input
              aria-label="WhatsApp de suporte"
              name="supportWhatsapp"
              type="tel"
              inputMode="tel"
              placeholder="(48) 99999-0000"
              defaultValue={current.supportWhatsapp}
            />
          </SettingRow>
        </div>
      </Card>
      <Card title="Dados de quem vende">
        <div>
          <SettingRow
            title="Nome ou razão social"
            description="Como no seu CPF ou CNPJ. O Código de Defesa do Consumidor pede a identificação de quem vende."
          >
            <Input
              aria-label="Nome ou razão social"
              name="legalName"
              maxLength={120}
              defaultValue={current.legalName}
            />
          </SettingRow>
          <SettingRow title="CPF ou CNPJ" description="Só números ou com pontos, barra e traço.">
            <Input
              aria-label="CPF ou CNPJ"
              name="document"
              inputMode="numeric"
              maxLength={18}
              defaultValue={current.document}
            />
          </SettingRow>
          <SettingRow
            title="Política de privacidade"
            description="Link no rodapé de todas as páginas. Em branco, sem link."
          >
            <Input
              aria-label="Link da política de privacidade"
              name="privacyUrl"
              type="url"
              placeholder="https://"
              defaultValue={current.privacyUrl}
            />
          </SettingRow>
        </div>
      </Card>
    </Section>
  );
}
