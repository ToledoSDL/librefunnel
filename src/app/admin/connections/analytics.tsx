import { Switch } from "@/components/form/switch";
import { Disclosure } from "@/components/layout/disclosure";
import { Dialog } from "@/components/overlay/dialog";
import { saveAnalytics } from "@/lib/actions/ads";
import { PRIMARY, TextField, type Ads } from "../shared";
import { SaveForm } from "../ui";
import { adStatus, Integration, Out, refusedNote, RemoveButton, SecretInput, Steps, TestButton } from "./parts";

const TESTED =
  "O Google aceitou o evento de teste. Ele confere o formato, não a chave: depois da primeira venda, veja em Relatórios > Tempo real se ela chegou.";

export function Analytics({ analytics }: { analytics: Ads["analytics"] }) {
  return (
    <Integration
      brand="analytics"
      name="Google Analytics"
      description={
        refusedNote(analytics.refused) ??
        (analytics.configured && !analytics.tag
          ? "Só vendas e reembolsos chegam. Ligue a Google tag em Avançado para ver a origem das visitas."
          : undefined)
      }
      status={adStatus(analytics.configured, analytics.refused)}
    >
      <Dialog
        trigger={{ label: analytics.configured ? "Configurar" : "Conectar", size: "sm" }}
        title="Conectar o Google Analytics"
        body={
          <Steps>
            <li>
              <p>
                <Out href="https://analytics.google.com/analytics/web/">Abra o Google Analytics</Out>, vá em
                Administrador &gt; Fluxos de dados e escolha o fluxo da Web (ou crie um com o endereço da loja).
              </p>
            </li>
            <li>
              <p>
                Copie o ID da métrica (G-) ou a Google tag inteira, de Ver instruções da tag. No mesmo fluxo, em Chaves
                secretas da API Measurement Protocol, clique em Criar.
              </p>
            </li>
            <li>
              <p>Cole os dois aqui. Se a Google tag colada tiver o ID do Google Ads, ele também é salvo.</p>
              <SaveForm
                reset
                action={saveAnalytics}
                label="Salvar e testar"
                pendingLabel="Testando com o Google"
                done={TESTED}
                button={PRIMARY}
              >
                <TextField
                  label="ID da métrica ou Google tag"
                  name="measurementId"
                  autoComplete="off"
                  placeholder="G-ABC123XYZ"
                  defaultValue={analytics.measurementId}
                />
                <SecretInput name="apiSecret" label="Chave secreta da API" set={analytics.apiSecretSet} />
                <Disclosure label="Avançado">
                  <Switch
                    name="tag"
                    value="1"
                    defaultChecked={analytics.configured ? analytics.tag : true}
                    label="Google tag no navegador"
                    description="Mostra de onde vêm as visitas. A venda vai também pelo servidor e conta uma vez só. Desligada, só vendas e reembolsos chegam ao Analytics."
                  />
                </Disclosure>
              </SaveForm>
            </li>
          </Steps>
        }
      />
      {analytics.configured ? (
        <>
          <TestButton kind="analytics" done={TESTED} />
          <RemoveButton kind="analytics" warning="As vendas deixam de ser enviadas para o Google Analytics." />
        </>
      ) : null}
    </Integration>
  );
}
