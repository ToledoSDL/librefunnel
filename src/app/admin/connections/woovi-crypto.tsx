import { Field } from "@/components/form/field";
import { Select } from "@/components/form/select";
import { BrandLogo } from "@/components/media/brand-logo";
import { Dialog } from "@/components/overlay/dialog";
import { Badge } from "@/components/text/badge";
import { Text } from "@/components/text/text";
import { saveWooviCrypto } from "@/lib/actions";
import { WOOVI_ASSETS } from "@/lib/orders";
import { ErrorText } from "@/app/ui";
import { PRIMARY, TextField, type Links, type Tone } from "../shared";
import { SaveForm } from "../ui";
import styles from "./connections.module.css";
import { Steps } from "./parts";

type Crypto = Links["pix"]["crypto"];

const MODES = [
  { value: "off", label: "Desligado: fica tudo em reais" },
  { value: "balance", label: "Converter o saldo disponível, de hora em hora" },
  { value: "sale", label: "Converter cada venda da loja" },
];

function summary(crypto: Crypto): string {
  if (crypto.mode === "off")
    return "Recebe pela Woovi e converte em USDT ou USDC, direto na sua carteira. Exige CNPJ e a conta Woovi conectada.";
  const asset = WOOVI_ASSETS.find((entry) => entry.id === crypto.asset)?.label ?? crypto.asset;
  const how = crypto.mode === "balance" ? "Saldo acima de R$ 50 vira" : "Cada venda vira";
  return `${how} ${asset}, enviado para ${crypto.wallet.slice(0, 6)}...${crypto.wallet.slice(-4)}.`;
}

export function WooviCrypto({ crypto, woovi }: { crypto: Crypto; woovi: boolean }) {
  const status: { label: string; tone: Tone } | null = crypto.error
    ? { label: "Conversão recusada", tone: "danger" }
    : crypto.mode === "off"
      ? null
      : { label: "Ligado", tone: "success" };

  return (
    <div className={styles.tile}>
      <div className={styles.tileHead}>
        <BrandLogo brand="woovi" />
        {status ? <Badge tone={status.tone}>{status.label}</Badge> : null}
      </div>
      <strong>Woovi (cripto)</strong>
      <span className={styles.description}>{summary(crypto)}</span>
      <div className={styles.tileActions}>
        <Dialog
          trigger={{ label: crypto.mode === "off" ? "Ligar" : "Configurar", size: "sm" }}
          title="Receber em cripto pela Woovi"
          body={
            <>
              {crypto.error ? (
                <Text variant="body-sm" tone="danger">
                  <ErrorText code={crypto.error} />
                </Text>
              ) : null}
              <Steps>
                <li>
                  <p>
                    <strong>Conecte a Woovi</strong> em Recebimento do Pix{woovi ? " (já conectada)" : ""}. O comprador
                    continua pagando o Pix da Woovi.
                  </p>
                </li>
                <li>
                  <p>
                    <strong>Peça a conta de stablecoin.</strong> No suporte da Woovi, peça a subconta de stablecoin
                    (análise da empresa) e dê ao AppID a permissão STABLECOIN_DEPOSIT_CREATE.
                  </p>
                </li>
                <li>
                  <strong>Escolha como converter.</strong> A Woovi usa uma corretora de cripto parceira e manda direto
                  para a sua carteira.
                  <SaveForm
                    action={saveWooviCrypto}
                    label="Salvar"
                    pendingLabel="Conferindo com a Woovi"
                    done="Salvo. As conversões rodam em segundo plano."
                    button={PRIMARY}
                  >
                    <Field label="Conversão">
                      {(control) => <Select {...control} name="mode" defaultValue={crypto.mode} options={MODES} />}
                    </Field>
                    <Field label="Moeda e rede">
                      {(control) => (
                        <Select
                          {...control}
                          name="asset"
                          defaultValue={crypto.asset || WOOVI_ASSETS[0].id}
                          options={WOOVI_ASSETS.map((asset) => ({ value: asset.id, label: asset.label }))}
                        />
                      )}
                    </Field>
                    <TextField
                      label="Endereço da sua carteira nessa rede"
                      name="wallet"
                      autoComplete="off"
                      defaultValue={crypto.wallet}
                    />
                  </SaveForm>
                </li>
              </Steps>
            </>
          }
        />
      </div>
    </div>
  );
}
