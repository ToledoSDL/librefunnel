import { Field } from "@/components/form/field";
import { Input } from "@/components/form/input";
import { Select } from "@/components/form/select";
import { Dialog } from "@/components/overlay/dialog";
import { saveNfse } from "@/lib/actions";
import { PRIMARY, TextField, type Links } from "../shared";
import { SaveForm } from "../ui";
import styles from "./connections.module.css";
import { configured, Integration, RemoveButton, SecretInput, TestButton } from "./parts";

const DATE = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" });

const REGIME_OPTIONS = [
  { value: "mei", label: "MEI" },
  { value: "simples", label: "Simples Nacional (ME ou EPP)" },
  { value: "normal", label: "Lucro Presumido ou Real" },
];

function cnpj(digits: string): string {
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

export function Nfse({ nfse }: { nfse: Links["nfse"] }) {
  return (
    <Integration
      brand="nfse"
      name="Nota fiscal"
      description={
        nfse.configured
          ? `${nfse.holder} (${cnpj(nfse.cnpj)}). Certificado vence em ${nfse.expiresAt ? DATE.format(nfse.expiresAt) : "data desconhecida"}.`
          : "Emite a NFS-e Nacional de cada venda paga e cancela no reembolso."
      }
      status={configured(nfse.configured)}
    >
      <Dialog
        trigger={{ label: nfse.configured ? "Configurar" : "Conectar", size: "sm" }}
        title="Nota fiscal (NFS-e Nacional)"
        body={
          <SaveForm
            action={saveNfse}
            label="Salvar e testar"
            pendingLabel="Testando com o gov.br"
            done="Nota fiscal ligada. Cada venda paga a partir de agora recebe nota."
            button={PRIMARY}
          >
            <Field label="Certificado A1 da empresa (.pfx ou .p12)">
              {(control) => (
                <Input {...control} name="certificate" type="file" accept=".pfx,.p12,application/x-pkcs12" />
              )}
            </Field>
            <SecretInput
              name="password"
              label="Senha do certificado"
              set={false}
              hint={nfse.configured ? "Só se enviar um certificado novo." : undefined}
            />
            <Field label="Regime">
              {(control) => <Select {...control} name="regime" defaultValue={nfse.regime} options={REGIME_OPTIONS} />}
            </Field>
            <div className={styles.pair}>
              <TextField
                label="Código IBGE do município"
                name="city"
                inputMode="numeric"
                maxLength={7}
                defaultValue={nfse.city}
                placeholder="3550308"
                hint="A cidade do CNPJ, em cidades.ibge.gov.br."
              />
              <TextField
                label="Inscrição municipal"
                name="registration"
                defaultValue={nfse.registration}
                hint="Em branco se a empresa não tem."
              />
            </div>
            <TextField
              label="Código de tributação nacional"
              name="service"
              inputMode="numeric"
              maxLength={8}
              defaultValue={nfse.service}
              hint="080201 é treinamento e ensino. Confirme com o seu contador."
            />
            <div className={styles.pair}>
              <TextField
                label="Tributos aproximados (%)"
                name="taxRate"
                inputMode="decimal"
                defaultValue={nfse.taxRate}
                hint="Simples: alíquota efetiva do DAS. Presumido ou Real: tributos federais. MEI: em branco."
              />
              <TextField
                label="ISS (%)"
                name="issRate"
                inputMode="decimal"
                defaultValue={nfse.issRate}
                hint="Só Presumido ou Real."
              />
            </div>
          </SaveForm>
        }
      />
      {nfse.configured ? (
        <>
          <TestButton kind="nfse" />
          <RemoveButton
            kind="nfse"
            warning="As próximas vendas deixam de receber nota. Notas já emitidas continuam válidas, e um reembolso não cancela mais a nota sozinho."
          />
        </>
      ) : null}
    </Integration>
  );
}
