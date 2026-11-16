import { CopyField } from "@/components/action/copy-field";
import { Disclosure } from "@/components/layout/disclosure";
import { Dialog } from "@/components/overlay/dialog";
import { connectR2, saveStorage } from "@/lib/actions/connections";
import { OUTLINE, PRIMARY, TextField, type Links } from "../shared";
import { SaveForm } from "../ui";
import styles from "./connections.module.css";
import { configured, Integration, RemoveButton, SecretInput, Steps, TestButton } from "./parts";

// Opens the Cloudflare token form with the name and the R2 edit permission already filled in.
const TOKEN_URL = `https://dash.cloudflare.com/profile/api-tokens?${new URLSearchParams({
  permissionGroupKeys: JSON.stringify([{ key: "workers_r2", type: "edit" }]),
  name: "LibreFunnel",
})}`;

// Same rule the store applies itself (applyCors): any site reads, since product domains play the videos too; only the
// panel uploads.
function cors(origin: string) {
  return JSON.stringify([
    { AllowedOrigins: ["*"], AllowedMethods: ["GET", "HEAD"], AllowedHeaders: ["*"] },
    { AllowedOrigins: [origin], AllowedMethods: ["PUT"], AllowedHeaders: ["*"], ExposeHeaders: ["ETag"] },
  ]);
}

function OtherService({ storage }: { storage: Links["storage"] }) {
  return (
    <Disclosure label="Usar Amazon S3, Backblaze ou outro serviço S3">
      <SaveForm
        action={saveStorage}
        label="Testar e salvar"
        pendingLabel="Testando o bucket"
        done="Bucket conectado."
        button={OUTLINE}
      >
        <TextField
          label="Endereço S3, com o bucket no fim"
          name="endpoint"
          inputMode="url"
          placeholder="https://s3.us-east-1.amazonaws.com/meu-bucket"
          defaultValue={storage.endpoint && `${storage.endpoint}/${storage.bucket}`}
        />
        <div className={styles.pair}>
          <TextField label="ID da chave" name="accessKey" autoComplete="off" defaultValue={storage.accessKey} />
          <SecretInput name="secret" label="Chave secreta" set={storage.secretSet} />
        </div>
        <CopyField label="Política de CORS do bucket" value={cors(storage.origin)} />
      </SaveForm>
    </Disclosure>
  );
}

export function Storage({ storage }: { storage: Links["storage"] }) {
  return (
    <Integration
      brand="cloudflare"
      name="Cloudflare R2"
      description={
        storage.configured
          ? `Vídeos e imagens no bucket ${storage.bucket}.`
          : "Guarda vídeos e imagens fora do servidor, sem custo de banda."
      }
      status={configured(storage.configured)}
    >
      <Dialog
        trigger={{ label: storage.configured ? "Configurar" : "Conectar", size: "sm" }}
        title="Conectar Cloudflare R2"
        body={
          <>
            <Steps>
              <li>
                <p>
                  <a href={TOKEN_URL} target="_blank" rel="noopener noreferrer">
                    Crie um token na Cloudflare
                  </a>{" "}
                  (a permissão já vem marcada) e copie o valor.
                </p>
              </li>
              <li>
                <p>Cole aqui. A loja cria o bucket privado e configura o resto.</p>
                <SaveForm
                  action={connectR2}
                  label="Conectar"
                  pendingLabel="Criando o bucket"
                  done="R2 conectado. Os próximos envios vão para ele e os arquivos do servidor são movidos em segundo plano."
                  button={PRIMARY}
                >
                  <SecretInput name="token" label="Token da Cloudflare" set={false} />
                </SaveForm>
              </li>
            </Steps>
            <OtherService storage={storage} />
          </>
        }
      />
      {storage.configured ? (
        <>
          <TestButton kind="storage" />
          <RemoveButton
            kind="storage"
            warning="Os arquivos que já estão no bucket deixam de abrir na loja até você conectar de novo. Nada é apagado do bucket."
          />
        </>
      ) : null}
    </Integration>
  );
}
