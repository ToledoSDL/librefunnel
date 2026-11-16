import { Button } from "@/components/action/button";
import { Alert } from "@/components/feedback/alert";
import { Field } from "@/components/form/field";
import { Disclosure } from "@/components/layout/disclosure";
import { Select } from "@/components/form/select";
import { Dialog } from "@/components/overlay/dialog";
import { saveCloud } from "@/lib/actions/connections";
import { PRIMARY, TextField, type Links, type Tone } from "../shared";
import { SaveForm } from "../ui";
import styles from "./connections.module.css";
import { configured, Integration, RemoveButton, SecretInput, Steps, TestButton } from "./parts";

const TEMPLATE: Record<NonNullable<Links["cloud"]["template"]>, { label: string; tone: Tone; note: string }> = {
  approved: { label: "Conectado", tone: "success", note: "" },
  pending: {
    label: "Modelo em análise",
    tone: "warning",
    note: "A Meta está aprovando o modelo de mensagem, o que leva alguns minutos. Até lá só as respostas automáticas saem; atualize a página para ver.",
  },
  rejected: {
    label: "Modelo recusado",
    tone: "danger",
    note: "A Meta recusou ou pausou o modelo librefunnel_aviso. Abra o WhatsApp Manager > Modelos de mensagem, veja o motivo e envie para análise de novo.",
  },
  error: {
    label: "Sem resposta da Meta",
    tone: "danger",
    note: "Não foi possível ler a conta agora. Se continuar, o token pode ter sido revogado: clique em Configurar e conecte de novo.",
  },
};

function Setup({ cloud }: { cloud: Links["cloud"] }) {
  const connect = (
    <SaveForm
      action={saveCloud}
      label={cloud.configured ? "Conectar de novo" : "Conectar"}
      pendingLabel="Conectando"
      done="Conectado. A Meta aprova o modelo de mensagem em alguns minutos; depois clique em Testar."
      button={PRIMARY}
    >
      <Steps>
        <li>
          <strong>Copie a chave secreta do app</strong>
          <span className={styles.description}>
            No seu app da Meta, em Configurações do app &gt; Básico. Sem app ainda? Crie um do tipo Empresa e adicione o
            WhatsApp com o número de vendas.
          </span>
          <Button href="https://developers.facebook.com/apps/" newTab size="sm" icon="external-link">
            Abrir meus apps
          </Button>
          <SecretInput name="appSecret" label="Chave secreta do app" set={cloud.configured} />
        </li>
        <li>
          <strong>Gere um token que não expira</strong>
          <span className={styles.description}>Em Usuários do sistema, com validade Nunca.</span>
          <Button href="https://business.facebook.com/settings/system-users" newTab size="sm" icon="external-link">
            Abrir Usuários do sistema
          </Button>
          <Disclosure label="Ver passo a passo">
            <ol className={styles.substeps}>
              <li>Adicionar: qualquer nome, função Administrador.</li>
              <li>Atribuir ativos: o app e a conta do WhatsApp, com controle total.</li>
              <li>
                Gerar token: escolha o app, validade Nunca e marque whatsapp_business_messaging e
                whatsapp_business_management.
              </li>
            </ol>
          </Disclosure>
          <SecretInput name="token" label="Token" set={cloud.configured} />
        </li>
      </Steps>
      <Disclosure label="A loja pediu o PIN do número?">
        <TextField
          label="PIN de duas etapas"
          hint="6 números. Se o número já tem confirmação em duas etapas, use o PIN dela; se não tem, invente um e guarde."
          name="pin"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
        />
      </Disclosure>
    </SaveForm>
  );

  if (!cloud.https) {
    return (
      <>
        <Alert tone="warning" title="Só conecta com a loja publicada em https">
          Hoje ela está em {cloud.baseUrl}, onde a Meta não chega. Pode preparar as chaves agora.
        </Alert>
        {connect}
      </>
    );
  }

  if (cloud.numbers.length < 2) return connect;

  return (
    <>
      <SaveForm
        action={saveCloud}
        label="Usar este número"
        pendingLabel="Trocando"
        done="Número trocado. As próximas mensagens saem por ele."
        button={PRIMARY}
      >
        <Field label="Número de envio">
          {(control) => (
            <Select
              {...control}
              name="phoneId"
              defaultValue={cloud.phoneId}
              options={cloud.numbers.map((number) => ({ value: number.id, label: number.label }))}
            />
          )}
        </Field>
      </SaveForm>
      <Disclosure label="Conectar com outras chaves">{connect}</Disclosure>
    </>
  );
}

export function WhatsAppCloud({ cloud }: { cloud: Links["cloud"] }) {
  const template = cloud.template ? TEMPLATE[cloud.template] : undefined;

  return (
    <Integration
      brand="whatsapp"
      name="WhatsApp oficial (Meta)"
      description={
        cloud.configured
          ? [`Número ${cloud.number}, em uso no lugar do WhatsApp por QR Code.`, template?.note].join(" ").trim()
          : "API oficial da Meta, sem risco de bloqueio do número. A Meta cobra por mensagem de modelo enviada."
      }
      status={template ?? configured(false)}
    >
      <Dialog
        trigger={{ label: cloud.configured ? "Configurar" : "Conectar", size: "sm" }}
        title="Conectar o WhatsApp oficial"
        description="Cole duas chaves da Meta. O número, o modelo de mensagem e as respostas a loja configura sozinha."
        body={<Setup cloud={cloud} />}
      />
      {cloud.configured ? (
        <>
          {cloud.template === "approved" ? <TestButton kind="whatsapp" /> : null}
          <RemoveButton
            kind="whatsapp"
            warning="As mensagens voltam a sair pelo WhatsApp por QR Code, se ele estiver conectado."
          />
        </>
      ) : null}
    </Integration>
  );
}
