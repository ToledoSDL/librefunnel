import { buttonAttributes } from "@/components/action/button";
import { Alert } from "@/components/feedback/alert";
import { Select } from "@/components/form/select";
import { SettingRow } from "@/components/form/setting-row";
import { Dialog } from "@/components/overlay/dialog";
import { Badge } from "@/components/text/badge";
import { restartStore, saveAutoUpdate, updateStore } from "@/lib/actions";
import { currentVersion, latestRelease, newer, updaterStatus } from "@/lib/updates";
import styles from "./admin.module.css";
import { StoreCommand } from "./store-command";
import { SaveForm } from "./ui";

const HOURS = Array.from({ length: 24 }, (_, hour) => ({ value: String(hour), label: `Todo dia às ${hour}h` }));

export async function VersionPanel() {
  const current = currentVersion();
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
          <div className={styles.versionRow}>
            <span>Instalada</span>
            <strong>{current === "dev" ? "Desenvolvimento" : current}</strong>
          </div>
          <div className={styles.versionRow}>
            <span>Mais recente</span>
            {latest ? (
              <strong>
                {latest.version} {available ? <Badge tone="primary">Nova</Badge> : <Badge tone="success">Em dia</Badge>}
              </strong>
            ) : (
              <span className={styles.muted}>Ainda não consultada no GitHub</span>
            )}
          </div>

          {status?.state === "failed" ? (
            <Alert tone="danger" title="A última operação falhou">
              {status.message ?? "Sem detalhes."} A loja continua na versão {current}.
            </Alert>
          ) : null}

          {!status ? (
            <p className={styles.muted}>
              Atualizar e reiniciar pelo painel funcionam quando a loja roda pelo Docker do guia de instalação.
            </p>
          ) : null}

          {available ? (
            <section className={styles.release}>
              <strong>Novidades da {available.version}</strong>
              {available.notes ? <p className={styles.notes}>{available.notes}</p> : null}
              <a href={available.url} target="_blank" rel="noopener noreferrer">
                Ver no GitHub
              </a>
              <StoreCommand
                action={updateStore}
                version={available.version}
                current={current}
                label={`Atualizar para ${available.version}`}
                pendingLabel="Iniciando"
                waiting="Fazendo backup e atualizando. A loja fica fora do ar por cerca de um minuto e esta página recarrega sozinha."
                look={buttonAttributes({ variant: "solid", tone: "primary" })}
              />
            </section>
          ) : null}

          <SettingRow
            title="Atualizar sozinha"
            description="Instala a versão nova no horário escolhido, com backup antes. Seus produtos, pedidos e configurações ficam como estão."
          >
            <SaveForm action={saveAutoUpdate} label="Salvar" pendingLabel="Salvando" done="Horário salvo.">
              <Select
                aria-label="Horário da atualização automática"
                name="hour"
                defaultValue={status?.autoHour ?? ""}
                options={[{ value: "", label: "Desligada" }, ...HOURS]}
              />
            </SaveForm>
          </SettingRow>

          <SettingRow
            title="Reiniciar a loja"
            description="Resolve travamentos e aplica mudanças feitas no servidor. Fica fora do ar por alguns segundos."
          >
            <StoreCommand
              action={restartStore}
              current={current}
              label="Reiniciar agora"
              pendingLabel="Reiniciando"
              waiting="Reiniciando. Esta página recarrega sozinha quando a loja voltar."
              look={buttonAttributes({ variant: "outline" })}
            />
          </SettingRow>
        </div>
      }
    />
  );
}
