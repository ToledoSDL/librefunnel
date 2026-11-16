import { CopyField } from "@/components/action/copy-field";
import { Input } from "@/components/form/input";
import { SegmentedControl } from "@/components/form/segmented-control";
import { SettingRow } from "@/components/form/setting-row";
import { Card } from "@/components/layout/card";
import { Icon } from "@/components/media/icon";
import { TextLink } from "@/components/text/text-link";
import { CHECKOUT_LABELS } from "@/lib/settings";
import type { Product } from "@/lib/catalog/products";
import type { Settings } from "@/lib/settings";
import { baseUrl } from "@/lib/guard";
import { inkFor } from "@/app/color";
import { OUTLINE } from "../shared";
import { CheckoutStudio } from "./checkout-studio";
import { DEFAULT_ACCENT, Section, Toggle } from "./sections";

export function CheckoutSection({ current, sample }: { current: Settings; sample?: Product }) {
  const accent = current.accent ?? DEFAULT_ACCENT;
  const prefillLink = `${baseUrl()}/c/${sample?.slug ?? "seu-produto"}?name=NOME&email=EMAIL&phone=WHATSAPP`;

  return (
    <Section>
      <CheckoutStudio
        initial={{
          phone: current.checkoutPhone,
          confirmEmail: current.confirmEmail,
          theme: current.checkoutTheme,
          button: current.checkoutButton,
          notice: current.checkoutNotice ?? "",
          countdown: current.checkoutCountdown,
          trust: current.checkoutTrust,
          guarantee: current.checkoutGuarantee,
          testimonials: current.checkoutTestimonials,
          thanksUrl: current.thanksUrl ?? "",
          thanksLabel: current.thanksLabel,
        }}
        labels={CHECKOUT_LABELS}
        store={{ brand: current.brand, logo: current.logo, accent, accentInk: inkFor(accent) }}
        product={{
          name: sample?.name ?? "Seu produto",
          price: sample?.price ?? 9700,
          cover: sample?.cover ?? undefined,
          guaranteeDays: sample?.guaranteeDays ?? 7,
          testimonials: sample?.testimonials.length ?? 0,
        }}
        toggle={OUTLINE}
        icons={{
          lock: <Icon name="lock" size={16} />,
          clock: <Icon name="clock" size={16} />,
          info: <Icon name="info" size={16} />,
          pix: <Icon name="qr-code" size={16} />,
          shield: <Icon name="shield-check" size={16} />,
          seal: <Icon name="badge-check" size={16} />,
          zap: <Icon name="zap" size={16} />,
          eye: <Icon name="eye" size={16} />,
        }}
      >
        <Card title="Campos do comprador">
          <div>
            <SettingRow
              title="WhatsApp do comprador"
              description="Obrigatório garante a recuperação de carrinho por WhatsApp. Opcional converte um pouco mais."
            >
              <SegmentedControl
                label="WhatsApp do comprador"
                name="checkoutPhone"
                value={current.checkoutPhone}
                options={[
                  { value: "optional", label: "Opcional" },
                  { value: "required", label: "Obrigatório" },
                  { value: "hidden", label: "Não pedir" },
                ]}
              />
            </SettingRow>
            <SettingRow
              title="Confirmar e-mail"
              description="Pede o e-mail duas vezes. Evita que o acesso vá para um endereço digitado errado."
            >
              <Toggle name="confirmEmail" checked={current.confirmEmail} label="Pedir confirmação" />
            </SettingRow>
            <SettingRow
              title="Dados pelo link"
              description="Para quem já é seu contato: troque NOME, EMAIL e WHATSAPP pelos campos da sua ferramenta de e-mail e o comprador abre o checkout preenchido."
            >
              <CopyField label="Link com os dados" value={prefillLink} />
            </SettingRow>
          </div>
        </Card>
        <Card title="Aparência">
          <div>
            <SettingRow title="Modo" description="Automático segue o modo claro ou escuro do celular de quem compra.">
              <SegmentedControl
                label="Modo do checkout"
                name="checkoutTheme"
                value={current.checkoutTheme}
                options={[
                  { value: "light", label: "Claro" },
                  { value: "dark", label: "Escuro" },
                  { value: "auto", label: "Automático" },
                ]}
              />
            </SettingRow>
            <SettingRow
              title="Texto do botão de compra"
              description="Também entra na frase dos termos. Diga o que acontece ao tocar, como Quero meu acesso."
            >
              <Input
                aria-label="Texto do botão de compra"
                name="checkoutButton"
                maxLength={40}
                placeholder={CHECKOUT_LABELS.button}
                defaultValue={current.checkoutButton}
              />
            </SettingRow>
            <SettingRow title="Cor do botão" description="É a cor principal da loja, a mesma da página de vendas.">
              <TextLink href="/admin/settings?section=brand">Mudar a cor em Marca</TextLink>
            </SettingRow>
          </div>
        </Card>
        <Card title="Conteúdo da página">
          <div>
            <SettingRow
              title="Aviso acima do formulário"
              description="Uma linha com algo real, como a data de início da turma. Em branco, sem aviso."
            >
              <Input
                aria-label="Aviso acima do formulário"
                name="checkoutNotice"
                maxLength={200}
                placeholder="Turma começa em 1º de dezembro"
                defaultValue={current.checkoutNotice}
              />
            </SettingRow>
            <SettingRow
              title="Contagem regressiva"
              description="Só aparece em produtos com data de fim da oferta e conta até ela, sem reiniciar."
            >
              <Toggle name="checkoutCountdown" checked={current.checkoutCountdown} label="Mostrar a contagem" />
            </SettingRow>
            <SettingRow
              title="Selos de confiança"
              description="Compra segura, garantia e acesso imediato, embaixo do botão de compra."
            >
              <Toggle name="checkoutTrust" checked={current.checkoutTrust} label="Mostrar os selos" />
            </SettingRow>
            <SettingRow
              title="Quadro de garantia"
              description="Os dias de garantia de cada produto, em destaque ao lado do formulário."
            >
              <Toggle name="checkoutGuarantee" checked={current.checkoutGuarantee} label="Mostrar a garantia" />
            </SettingRow>
            <SettingRow
              title="Depoimentos"
              description="Os depoimentos cadastrados em cada produto, ao lado do formulário."
            >
              <Toggle
                name="checkoutTestimonials"
                checked={current.checkoutTestimonials}
                label="Mostrar os depoimentos"
              />
            </SettingRow>
          </div>
        </Card>
        <Card title="Pagamento e termos">
          <div>
            <SettingRow
              title="Validade do Pix"
              description="Em horas, de 1 a 720. Depois disso o pedido expira e um novo Pix precisa ser gerado."
            >
              <Input
                aria-label="Validade do Pix em horas"
                name="orderHours"
                type="number"
                min={1}
                max={720}
                required
                defaultValue={current.orderHours}
              />
            </SettingRow>
            <SettingRow
              title="Link dos termos"
              description="Aparece no checkout, junto do botão de compra. Em branco, sem link."
            >
              <Input
                aria-label="Link dos termos"
                name="termsUrl"
                type="url"
                placeholder="https://"
                defaultValue={current.termsUrl}
              />
            </SettingRow>
            <SettingRow title="Versão dos termos" description="Fica registrada em cada pedido, como 2026-11.">
              <Input
                aria-label="Versão dos termos"
                name="termsVersion"
                maxLength={40}
                defaultValue={current.termsVersion}
              />
            </SettingRow>
          </div>
        </Card>
        <Card title="Depois do pagamento">
          <div>
            <SettingRow
              title="Botão extra"
              description="Na tela de pagamento confirmado, abaixo de Entrar na área de membros. Para o grupo de alunos ou a próxima oferta. Sem link, sem botão."
            >
              <Input
                aria-label="Link do botão extra"
                name="thanksUrl"
                type="url"
                placeholder="https://"
                defaultValue={current.thanksUrl}
              />
              <Input
                aria-label="Texto do botão extra"
                name="thanksLabel"
                maxLength={40}
                placeholder={CHECKOUT_LABELS.thanks}
                defaultValue={current.thanksLabel}
              />
            </SettingRow>
          </div>
        </Card>
      </CheckoutStudio>
    </Section>
  );
}
