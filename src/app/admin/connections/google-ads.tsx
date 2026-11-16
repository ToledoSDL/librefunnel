import { CopyField } from "@/components/action/copy-field";
import { Disclosure } from "@/components/layout/disclosure";
import { Dialog } from "@/components/overlay/dialog";
import { connectGoogle, saveGoogleAds } from "@/lib/actions/ads";
import { OUTLINE, PRIMARY, TextField, type Ads, type Tone } from "../shared";
import { ActionButton, SaveForm } from "../ui";
import { adStatus, Integration, Out, refusedNote, RemoveButton, SecretInput, Steps, TestButton } from "./parts";

const CLOUD = "https://console.cloud.google.com";

function status(ads: Ads["googleAds"]): { label: string; tone: Tone } {
  if (ads.saved && !ads.authorized) return { label: "Falta entrar com Google", tone: "warning" };
  return adStatus(ads.configured, ads.refused);
}

export function GoogleAds({ ads }: { ads: Ads["googleAds"] }) {
  return (
    <Integration brand="googleads" name="Google Ads" description={refusedNote(ads.refused)} status={status(ads)}>
      <Dialog
        trigger={{ label: ads.saved ? "Configurar" : "Conectar", size: "sm" }}
        title="Conectar o Google Ads"
        body={
          <Steps>
            <li>
              <p>
                No Google Ads, <Out href="https://ads.google.com/aw/conversions">crie uma ação de conversão</Out> em
                Importar &gt; Cliques, com valores diferentes para cada conversão. Abra a ação e copie o endereço da
                página.
              </p>
            </li>
            <li>
              <p>
                No Google Cloud,{" "}
                <Out href={`${CLOUD}/apis/library/datamanager.googleapis.com`}>ative a Data Manager API</Out>,{" "}
                <Out href={`${CLOUD}/auth/branding`}>preencha a tela de permissão</Out> e{" "}
                <Out href={`${CLOUD}/auth/audience`}>publique o app</Out> (em teste, o Google desconecta em 7 dias).
              </p>
            </li>
            <li>
              <p>
                <Out href={`${CLOUD}/auth/clients/create`}>Crie um cliente OAuth</Out> do tipo Aplicativo da Web, com
                este URI de redirecionamento autorizado:
              </p>
              <CopyField label="URI de redirecionamento" value={ads.redirectUri} />
            </li>
            <li>
              <p>Cole aqui. Você entra com o Google e volta para cá conectado e testado.</p>
              <SaveForm
                reset
                action={saveGoogleAds}
                label={ads.authorized ? "Salvar e testar" : "Salvar e entrar com Google"}
                pendingLabel={ads.authorized ? "Testando com o Google" : "Abrindo o Google"}
                done="Google Ads conectado: o teste passou."
                button={PRIMARY}
              >
                <TextField
                  label="ID do cliente OAuth"
                  name="clientId"
                  autoComplete="off"
                  placeholder="123-abc.apps.googleusercontent.com"
                  defaultValue={ads.clientId}
                />
                <SecretInput name="clientSecret" label="Chave secreta do cliente" set={ads.clientSecretSet} />
                <TextField
                  label="ID da conta do Google Ads"
                  hint="Os 10 números no topo do Google Ads."
                  name="customerId"
                  inputMode="numeric"
                  placeholder="123-456-7890"
                  defaultValue={ads.customerId}
                />
                <TextField
                  label="Ação de conversão"
                  hint="O endereço da página da ação ou o número depois de ctId=."
                  name="actionId"
                  autoComplete="off"
                  defaultValue={ads.actionId}
                />
                <Disclosure label="Avançado">
                  <TextField
                    label="ID da conta de administrador"
                    hint="Só se você entra no Google Ads por uma conta de administrador (MCC)."
                    name="loginCustomerId"
                    inputMode="numeric"
                    defaultValue={ads.loginCustomerId}
                  />
                  <TextField
                    label="Google tag do Google Ads"
                    hint="O ID AW- ou a tag inteira, de Ferramentas > Google tag. Liga a tag nas páginas de venda para listas de remarketing; as vendas continuam indo pelo servidor."
                    name="tagId"
                    autoComplete="off"
                    placeholder="AW-123456789"
                    defaultValue={ads.tagId}
                  />
                </Disclosure>
              </SaveForm>
            </li>
          </Steps>
        }
      />
      {ads.saved ? (
        <ActionButton
          action={connectGoogle}
          button={ads.authorized ? OUTLINE : PRIMARY}
          label={ads.authorized ? "Entrar com Google de novo" : "Entrar com Google"}
          pendingLabel="Abrindo o Google"
          done="Abrindo o Google."
        />
      ) : null}
      {ads.configured ? <TestButton kind="googleads" /> : null}
      {ads.saved ? (
        <RemoveButton kind="googleads" warning="As vendas deixam de ser enviadas para o Google Ads." />
      ) : null}
    </Integration>
  );
}
