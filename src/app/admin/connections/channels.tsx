import { Field } from "@/components/form/field";
import { Select } from "@/components/form/select";
import { Icon } from "@/components/media/icon";
import { Dialog } from "@/components/overlay/dialog";
import { disconnectWhatsApp, saveMeta, saveSmtp } from "@/lib/actions";
import { DANGER, OUTLINE, PRIMARY, TextField, type Links, type Tone } from "../shared";
import { ActionButton, SaveForm, WebhookSecret, WhatsAppConnect } from "../ui";
import styles from "./connections.module.css";
import { configured, Integration, RemoveButton, SecretInput, TestButton } from "./parts";

const WHATSAPP_STATE: Record<Links["whatsapp"]["state"], { label: string; tone: Tone }> = {
  open: { label: "Conectado", tone: "success" },
  connecting: { label: "Aguardando o QR", tone: "warning" },
  close: { label: "Desconectado", tone: "warning" },
  missing: { label: "Não conectado", tone: "default" },
  error: { label: "Com erro", tone: "danger" },
};

export function Email({ email }: { email: Links["email"] }) {
  return (
    <Integration
      brand="email"
      name="E-mail"
      description={email.configured ? undefined : "Sem e-mail, quem compra não recebe o link de acesso."}
      status={configured(email.configured)}
    >
      <Dialog
        trigger={{ label: email.configured ? "Configurar" : "Conectar", size: "sm" }}
        title="Conectar e-mail"
        body={
          <SaveForm
            action={saveSmtp}
            label="Salvar e-mail"
            pendingLabel="Salvando"
            done="E-mail salvo. Clique em Testar."
            button={PRIMARY}
          >
            <Field label="Provedor">
              {(control) => (
                <Select
                  {...control}
                  name="preset"
                  defaultValue=""
                  options={[
                    { value: "", label: "Outro servidor SMTP" },
                    ...email.presets.map((preset) => ({ value: preset.id, label: preset.name })),
                  ]}
                />
              )}
            </Field>
            <div className={styles.pair}>
              <TextField label="Servidor SMTP" name="host" defaultValue={email.host} placeholder="smtp.gmail.com" />
              <TextField
                label="Porta"
                name="port"
                inputMode="numeric"
                defaultValue={email.port}
                hint="Quase sempre 587."
              />
            </div>
            <TextField
              label="Usuário"
              hint={email.presets.map((preset) => `${preset.name}: ${preset.user}`).join(". ")}
              name="user"
              autoComplete="off"
              defaultValue={email.user}
            />
            <SecretInput
              name="password"
              label="Senha"
              set={email.passwordSet}
              hint={email.presets.map((preset) => `${preset.name}: ${preset.password}`).join(". ")}
            />
            <TextField
              label="Remetente"
              hint="Em branco usa o usuário."
              name="from"
              type="email"
              defaultValue={email.from}
            />
          </SaveForm>
        }
      />
      {email.configured ? (
        <>
          <TestButton kind="smtp" />
          <RemoveButton kind="smtp" warning="Sem e-mail, quem compra não recebe o link de acesso." />
        </>
      ) : null}
    </Integration>
  );
}

export function WhatsApp({ whatsapp, official }: { whatsapp: Links["whatsapp"]; official: boolean }) {
  const state = whatsapp.configured
    ? WHATSAPP_STATE[whatsapp.state]
    : process.env.NODE_ENV === "development"
      ? { label: "Só no servidor", tone: "default" as const }
      : { label: "Indisponível", tone: "warning" as const };

  return (
    <Integration
      brand="whatsapp"
      name="WhatsApp por QR Code"
      description={official ? "Sem uso enquanto o WhatsApp oficial estiver conectado." : undefined}
      status={state}
    >
      {whatsapp.configured && whatsapp.state !== "open" ? (
        <Dialog
          trigger={{ label: "Conectar", variant: "solid", tone: "primary", size: "sm" }}
          title="Conectar o WhatsApp"
          body={<WhatsAppConnect retry={OUTLINE} />}
        />
      ) : null}
      {whatsapp.state === "open" ? (
        <>
          <TestButton kind="evolution" />
          <Dialog
            trigger={{ label: "Desconectar", variant: "ghost", tone: "danger", size: "sm" }}
            title="Desconectar o WhatsApp"
            description="A recuperação de carrinho e os avisos por WhatsApp param até você ler um novo QR Code."
          >
            <ActionButton
              action={disconnectWhatsApp}
              button={DANGER}
              label="Confirmar desconexão"
              pendingLabel="Desconectando"
              done="WhatsApp desconectado."
            />
          </Dialog>
        </>
      ) : null}
      {whatsapp.configured ? null : (
        <span className={styles.note}>
          {process.env.NODE_ENV === "development"
            ? "O QR Code precisa do servidor do WhatsApp, que só sobe com bun run start (Docker). No bun run dev, use a API oficial acima."
            : "Este servidor não tem o WhatsApp por QR Code. Instale a loja pelo Docker do guia de instalação ou use a API oficial acima."}
        </span>
      )}
    </Integration>
  );
}

export function Meta({ meta }: { meta: Links["meta"] }) {
  return (
    <Integration brand="meta" name="Meta (Facebook e Instagram)" status={configured(meta.configured)}>
      <Dialog
        trigger={{ label: meta.configured ? "Configurar" : "Conectar", size: "sm" }}
        title="Conectar a Meta"
        body={
          <SaveForm
            action={saveMeta}
            label="Salvar Meta"
            pendingLabel="Salvando"
            done="Meta salva. Clique em Testar."
            button={PRIMARY}
          >
            <TextField
              label="ID do Pixel"
              hint="Gerenciador de Eventos > Fontes de dados."
              name="pixelId"
              inputMode="numeric"
              defaultValue={meta.pixelId}
            />
            <SecretInput
              name="token"
              label="Token da API de Conversões"
              set={meta.tokenSet}
              hint="Seu Pixel > Configurações > Gerar token de acesso."
            />
            <TextField
              label="Código de teste (opcional)"
              hint="Apague depois de testar: enquanto existir, as vendas não contam nas campanhas."
              name="testEventCode"
              defaultValue={meta.testEventCode}
            />
          </SaveForm>
        }
      />
      {meta.configured ? (
        <>
          <TestButton kind="meta" />
          <RemoveButton kind="meta" warning="As vendas deixam de ser enviadas para a Meta." />
        </>
      ) : null}
    </Integration>
  );
}

export function Webhook({ webhook }: { webhook: Links["webhook"] }) {
  return (
    <Integration
      brand="webhook"
      name="Webhook de pagamento"
      description="Libera o pedido com um POST assinado de outro gateway."
      status={configured(webhook.configured, "Ativo")}
    >
      <Dialog
        trigger={{ label: webhook.configured ? "Configurar" : "Ativar", size: "sm" }}
        title="Webhook de pagamento"
        description={`Envie um POST com o JSON assinado pelo segredo para ${webhook.url}`}
        body={
          <WebhookSecret
            configured={webhook.configured}
            button={webhook.configured ? OUTLINE : PRIMARY}
            copyIcon={<Icon name="copy" size={16} />}
            copiedIcon={<Icon name="check" size={16} />}
          />
        }
      />
      {webhook.configured ? (
        <RemoveButton kind="webhook" warning="O endereço passa a responder 404 e nenhum pagamento chega por ele." />
      ) : null}
    </Integration>
  );
}
