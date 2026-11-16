import { Switch } from "@/components/form/switch";
import { Disclosure } from "@/components/layout/disclosure";
import { Dialog } from "@/components/overlay/dialog";
import { saveTikTok } from "@/lib/actions/ads";
import { PRIMARY, TextField, type Ads } from "../shared";
import { SaveForm } from "../ui";
import { adStatus, Integration, Out, refusedNote, RemoveButton, SecretInput, Steps, TestButton } from "./parts";

export function TikTok({ tiktok }: { tiktok: Ads["tiktok"] }) {
  return (
    <Integration
      brand="tiktok"
      name="TikTok"
      description={refusedNote(tiktok.refused)}
      status={adStatus(tiktok.configured, tiktok.refused)}
    >
      <Dialog
        trigger={{ label: tiktok.configured ? "Configurar" : "Conectar", size: "sm" }}
        title="Conectar o TikTok"
        body={
          <Steps>
            <li>
              <p>
                <Out href="https://ads.tiktok.com/i18n/events_manager">Abra o Gerenciador de Eventos do TikTok</Out>,
                escolha o seu Pixel da Web (ou crie um com a Events API) e copie o código dele.
              </p>
            </li>
            <li>
              <p>Nas Configurações do Pixel, em Events API, clique em Gerar token de acesso.</p>
            </li>
            <li>
              <p>Cole os dois aqui. A loja testa na hora e mostra se deu certo.</p>
              <SaveForm
                reset
                action={saveTikTok}
                label="Salvar e testar"
                pendingLabel="Testando com o TikTok"
                done="TikTok conectado: o evento de teste chegou."
                button={PRIMARY}
              >
                <TextField
                  label="Código do Pixel"
                  name="pixelCode"
                  autoComplete="off"
                  placeholder="C4ABCDEF1234567890"
                  defaultValue={tiktok.pixelCode}
                />
                <SecretInput name="token" label="Token da Events API" set={tiktok.tokenSet} />
                <Disclosure label="Avançado">
                  <Switch
                    name="pixel"
                    value="1"
                    defaultChecked={tiktok.configured ? tiktok.pixel : true}
                    label="Pixel no navegador"
                    description="Roda o Pixel nas páginas de venda e checkout, junto com o servidor e sem contar em dobro. Desligue para não rodar nenhum script do TikTok nas suas páginas."
                  />
                  <TextField
                    label="Código de teste"
                    hint="Da aba Testar eventos. Enquanto estiver preenchido, as vendas não contam nas campanhas: apague depois de conferir."
                    name="testEventCode"
                    autoComplete="off"
                    defaultValue={tiktok.testEventCode}
                  />
                </Disclosure>
              </SaveForm>
            </li>
          </Steps>
        }
      />
      {tiktok.configured ? (
        <>
          <TestButton kind="tiktok" />
          <RemoveButton kind="tiktok" warning="As vendas deixam de ser enviadas para o TikTok." />
        </>
      ) : null}
    </Integration>
  );
}
