import { buttonAttributes } from "@/components/action/button";
import { Alert } from "@/components/feedback/alert";
import { Field } from "@/components/form/field";
import { Select } from "@/components/form/select";
import { Row } from "@/components/layout/row";
import { Dialog } from "@/components/overlay/dialog";
import { Badge } from "@/components/text/badge";
import { Text } from "@/components/text/text";
import { TextLink } from "@/components/text/text-link";
import { restartStore, saveAutoUpdate, updateStore } from "@/lib/actions/store";
import { demoMode } from "@/lib/guard";
import { currentVersion, latestRelease, newer, updaterStatus } from "@/lib/updates";
import styles from "./admin.module.css";
import { StoreCommand } from "./store-command";
import { SaveForm } from "./ui";

const HOURS = Array.from({ length: 24 }, (_, hour) => ({ value: String(hour), label: `Todo dia às ${hour}h` }));

export async function VersionPanel() {
  const current = currentVersion();
  const installed = current === "dev" ? "desenvolvimento" : current;
  const latest = latestRelease();
  const status = await updaterStatus();
  const available = latest && newer(latest.version, current) ? latest : undefined;

  return (
    <Dialog
      trigger={{
        label: available ? `Atualizar para ${available.version}` : `Versão ${current}`,
        variant: available ? "soft" : "ghost",
        tone: available ? "primary" : "neutral",
        size: "sm",
        icon: available ? "arrow-up-circle" : "tag",
      }}
      title="Versão da loja"
      body={
        <div className={styles.version}>
          {available ? (
            <section className={styles.release}>
              <Row justify="between">
                <Text weight="semibold">{available.version} disponível</Text>
                <Badge tone="primary">Nova</Badge>
              </Row>
              <Text variant="body-sm" tone="muted">
                Você está na {installed}. A versão nova sobe ao lado da atual, com backup do banco antes, e a loja não
                sai do ar.
              </Text>
              {available.notes ? <p className={styles.notes}>{available.notes}</p> : null}
              <Row gap={4}>
                {status ? (
                  <StoreCommand
                    action={updateStore}
                    version={available.version}
                    current={current}
                    label={`Atualizar para ${available.version}`}
                    pendingLabel="Iniciando"
                    waiting="Fazendo backup e subindo a versão nova. A loja continua no ar e esta página recarrega sozinha."
                    look={buttonAttributes({ variant: "solid", tone: "primary" })}
                  />
                ) : null}
                <TextLink href={available.url} external>
                  Ver o que mudou
                </TextLink>
              </Row>
            </section>
          ) : (
            <Row justify="between">
              <Text>Versão {installed}</Text>
              {latest ? (
                <Badge tone="success">Em dia</Badge>
              ) : (
                <Text variant="body-sm" tone="muted">
                  Ainda não consultada no GitHub
                </Text>
              )}
            </Row>
          )}

          {status?.state === "failed" ? (
            <Alert tone="danger" title="A última operação falhou">
              {status.message ?? "Sem detalhes."} A loja continua na versão {installed}.
            </Alert>
          ) : null}

          {status ? (
            <>
              <section className={styles.versionPart}>
                <SaveForm
                  action={saveAutoUpdate}
                  label="Salvar horário"
                  pendingLabel="Salvando"
                  done="Horário salvo."
                  button={buttonAttributes({ variant: "outline" })}
                >
                  <Field
                    label="Atualizar sozinha"
                    hint="Instala a versão nova nesse horário, com backup antes. Produtos, pedidos e configurações ficam como estão."
                  >
                    {(control) => (
                      <Select
                        {...control}
                        name="hour"
                        defaultValue={status.autoHour}
                        options={[{ value: "", label: "Desligada" }, ...HOURS]}
                      />
                    )}
                  </Field>
                </SaveForm>
              </section>

              <section className={styles.versionPart}>
                <Text weight="semibold">Reiniciar a loja</Text>
                <Text variant="body-sm" tone="muted">
                  Sobe a loja de novo na mesma versão, sem sair do ar. Use quando algo travar ou depois de mudar o .env
                  no servidor.
                </Text>
                <StoreCommand
                  action={restartStore}
                  current={current}
                  label="Reiniciar agora"
                  pendingLabel="Reiniciando"
                  waiting="Reiniciando. A loja continua no ar e esta página recarrega sozinha."
                  look={buttonAttributes({ variant: "outline" })}
                />
              </section>
            </>
          ) : (
            <Text variant="body-sm" tone="muted">
              {demoMode() ? (
                "Na demonstração, atualizar e reiniciar pelo painel ficam desligados."
              ) : (
                <>
                  Atualizar e reiniciar pelo painel só funcionam quando a loja roda pelo Docker do guia de instalação.
                  Fora dele, atualize pelo terminal:{" "}
                  <TextLink href="https://librefunnel.com/docs/atualizar" external>
                    como atualizar
                  </TextLink>
                  .
                </>
              )}
            </Text>
          )}
        </div>
      }
    />
  );
}
