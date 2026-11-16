import { Switch } from "@/components/form/switch";
import { Disclosure } from "@/components/layout/disclosure";
import { Dialog } from "@/components/overlay/dialog";
import { saveMeta } from "@/lib/actions/ads";
import { PRIMARY, TextField, type Ads } from "../shared";
import { SaveForm } from "../ui";
import { adStatus, Integration, Out, refusedNote, RemoveButton, SecretInput, Steps, TestButton } from "./parts";

export function Meta({ meta }: { meta: Ads["meta"] }) {
  return (
    <Integration
      brand="meta"
      name="Meta (Facebook e Instagram)"
      description={refusedNote(meta.refused)}
      status={adStatus(meta.configured, meta.refused)}
    >
      <Dialog
        trigger={{ label: meta.configured ? "Configurar" : "Conectar", size: "sm" }}
        title="Conectar a Meta"
        body={
          <Steps>
            <li>
              <p>
                <Out href="https://business.facebook.com/events_manager2">Abra o Gerenciador de Eventos</Out>, escolha o
                seu Pixel e copie o ID dele (ou o código do Pixel inteiro).
              </p>
            </li>
            <li>
              <p>Nas Configurações do Pixel, em API de Conversões, clique em Gerar token de acesso.</p>
            </li>
            <li>
              <p>Cole os dois aqui. A loja testa na hora e mostra se deu certo.</p>
              <SaveForm
                reset
                action={saveMeta}
                label="Salvar e testar"
                pendingLabel="Testando com a Meta"
                done="Meta conectada: o evento de teste chegou."
                button={PRIMARY}
              >
                <TextField
                  label="ID ou código do Pixel"
                  name="pixelId"
                  autoComplete="off"
                  placeholder="123456789012345"
                  defaultValue={meta.pixelId}
                />
                <SecretInput name="token" label="Token da API de Conversões" set={meta.tokenSet} />
                <Disclosure label="Avançado">
                  <Switch
                    name="pixel"
                    value="1"
                    defaultChecked={meta.configured ? meta.pixel : true}
                    label="Pixel no navegador"
                    description="Roda o Pixel nas páginas de venda e checkout, junto com o servidor e sem contar em dobro. Desligue para não rodar nenhum script da Meta nas suas páginas."
                  />
                  <TextField
                    label="Código de teste"
                    hint="Da aba Eventos de teste. Enquanto estiver preenchido, as vendas não contam nas campanhas: apague depois de conferir."
                    name="testEventCode"
                    autoComplete="off"
                    defaultValue={meta.testEventCode}
                  />
                </Disclosure>
              </SaveForm>
            </li>
          </Steps>
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
