import { CopyField } from "@/components/action/copy-field";
import { BrandLogo } from "@/components/media/brand-logo";
import { Dialog } from "@/components/overlay/dialog";
import { Badge } from "@/components/text/badge";
import { savePix } from "@/lib/actions";
import { OUTLINE, PRIMARY, type Links } from "../shared";
import { ActionButton, SaveForm } from "../ui";
import styles from "./connections.module.css";
import { RemoveButton, SecretInput, Steps, TestButton } from "./parts";

type Provider = Links["pix"]["providers"][number];
type Paid = Exclude<Provider["id"], "static">;

const HELP: Record<Paid, { apiKey: string; webhookSecret: string; panel: string; keys: string; webhook: string }> = {
  mercadopago: {
    apiKey: "Access Token de produção",
    webhookSecret: "Assinatura secreta do webhook",
    panel: "https://www.mercadopago.com.br/developers/panel/app",
    keys: "Em Suas integrações > Credenciais de produção, copie o Access Token.",
    webhook: "Em Suas integrações > Webhooks, cole este endereço, marque o evento e copie a assinatura secreta.",
  },
  woovi: {
    apiKey: "AppID",
    webhookSecret: "Authorization do webhook (opcional)",
    panel: "https://app.woovi.com",
    keys: "Em API/Plugins > Nova API/Plugin, escolha API e copie o AppID.",
    webhook: "Em API/Plugins > Novo webhook, crie um webhook com este endereço para cada evento.",
  },
  abacatepay: {
    apiKey: "Chave da API (v2)",
    webhookSecret: "Segredo do webhook (32 caracteres ou mais)",
    panel: "https://app.abacatepay.com",
    keys: "Em Integração > API > Nova chave, escolha API v2 e copie a chave.",
    webhook:
      "Em Integração > Webhooks > Criar webhook (v2), cole este endereço, invente um segredo e marque os eventos.",
  },
};

function Setup({ provider, help }: { provider: Provider; help: (typeof HELP)[Paid] }) {
  return (
    <Steps>
      <li>
        <p>
          <strong>Pegue a chave.</strong>{" "}
          <a href={help.panel} target="_blank" rel="noopener noreferrer">
            Abra o painel de {provider.name}
          </a>
          . {help.keys}
        </p>
      </li>
      {provider.webhookUrl ? (
        <li>
          <p>
            <strong>Cadastre o webhook.</strong> {help.webhook}
          </p>
          <CopyField label="Endereço do webhook" value={provider.webhookUrl} />
          {provider.events.length ? (
            <span className={styles.events}>
              {provider.events.map((event) => (
                <Badge key={event}>{event}</Badge>
              ))}
            </span>
          ) : null}
        </li>
      ) : null}
      <li>
        <strong>Cole as chaves aqui.</strong>
        <SaveForm
          action={savePix}
          label={provider.active ? "Salvar chaves" : "Salvar e usar este provedor"}
          pendingLabel="Salvando"
          done="Salvo. Clique em Testar."
          button={PRIMARY}
        >
          <input type="hidden" name="provider" value={provider.id} />
          <SecretInput name="apiKey" label={help.apiKey} set={provider.apiKeySet} />
          <SecretInput name="webhookSecret" label={help.webhookSecret} set={provider.webhookSecretSet} />
        </SaveForm>
      </li>
    </Steps>
  );
}

function ProviderTile({ provider }: { provider: Provider }) {
  return (
    <div className={styles.tile} data-active={provider.active}>
      <div className={styles.tileHead}>
        <BrandLogo brand={provider.id === "static" ? "pix" : provider.id} />
        {provider.active ? <Badge tone="success">Em uso</Badge> : null}
      </div>
      <strong>{provider.id === "static" ? "Pix na sua chave" : provider.name}</strong>
      <span className={styles.description}>
        {provider.fee} {provider.needsCnpj ? "Exige CNPJ (MEI serve)." : "Funciona com CPF."}
      </span>
      <div className={styles.tileActions}>
        {provider.id === "static" ? (
          provider.active ? null : (
            <ActionButton
              action={savePix}
              fields={{ provider: "static" }}
              button={OUTLINE}
              label="Usar"
              pendingLabel="Salvando"
              done="Pronto: os próximos pedidos usam o Pix na chave do produto."
            />
          )
        ) : (
          <>
            <Dialog
              trigger={{ label: provider.configured ? "Configurar" : "Conectar", size: "sm" }}
              title={`Conectar ${provider.name}`}
              body={<Setup provider={provider} help={HELP[provider.id]} />}
            />
            {provider.configured ? (
              <>
                <TestButton kind={provider.id} />
                <RemoveButton
                  kind={provider.id}
                  warning="Pedidos já gerados por este provedor deixam de ser confirmados sozinhos: libere-os em Pedidos."
                />
              </>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

export function PixProviders({ providers }: { providers: Provider[] }) {
  return (
    <div className={styles.tiles}>
      {providers.map((provider) => (
        <ProviderTile key={provider.id} provider={provider} />
      ))}
    </div>
  );
}
