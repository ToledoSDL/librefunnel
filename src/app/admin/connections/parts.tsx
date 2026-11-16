import type { ReactNode } from "react";
import { BrandLogo } from "@/components/media/brand-logo";
import type { Brand } from "@/components/media/brand-logo";
import { Dialog } from "@/components/overlay/dialog";
import { Badge } from "@/components/text/badge";
import { removeConnection, testConnection } from "@/lib/actions/connections";
import { DANGER, OUTLINE, TextField, type Tone } from "../shared";
import { ActionButton } from "../ui";
import styles from "./connections.module.css";

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.heading}>{title}</h2>
      <div className={styles.list}>{children}</div>
    </section>
  );
}

export function Integration({
  brand,
  name,
  description,
  status,
  children,
}: {
  brand: Brand;
  name: string;
  description?: string;
  status: { label: string; tone: Tone };
  children: ReactNode;
}) {
  return (
    <div className={styles.integration}>
      <BrandLogo brand={brand} />
      <div className={styles.info}>
        <span className={styles.name}>
          {name}
          <Badge tone={status.tone}>{status.label}</Badge>
        </span>
        {description ? <span className={styles.description}>{description}</span> : null}
      </div>
      <div className={styles.actions}>{children}</div>
    </div>
  );
}

export function configured(ok: boolean, label = "Conectado"): { label: string; tone: Tone } {
  return ok ? { label, tone: "success" } : { label: "Não conectado", tone: "default" };
}

// An ad platform's card: connected, connected with events refused in the last 7 days, or not connected.
export function adStatus(ok: boolean, refused: number): { label: string; tone: Tone } {
  return ok && refused ? { label: "Com recusas", tone: "warning" } : configured(ok);
}

export function refusedNote(refused: number): string | undefined {
  if (!refused) return undefined;
  const events = refused === 1 ? "1 evento recusado" : `${refused} eventos recusados`;
  return `${events} nos últimos 7 dias. Clique em Testar para ver o motivo.`;
}

export function Out({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

export function Steps({ children }: { children: ReactNode }) {
  return <ol className={styles.steps}>{children}</ol>;
}

export function TestButton({ kind, done = "Conexão funcionando." }: { kind: string; done?: string }) {
  return (
    <ActionButton
      action={testConnection}
      fields={{ kind }}
      button={OUTLINE}
      label="Testar"
      pendingLabel="Testando"
      done={done}
    />
  );
}

export function RemoveButton({ kind, warning }: { kind: string; warning: string }) {
  return (
    <Dialog
      trigger={{ label: "Remover", variant: "ghost", tone: "danger", size: "sm" }}
      title="Remover conexão"
      description={warning}
    >
      <ActionButton
        action={removeConnection}
        fields={{ kind }}
        button={DANGER}
        label="Confirmar remoção"
        pendingLabel="Removendo"
        done="Removido."
      />
    </Dialog>
  );
}

export function SecretInput({ name, label, set, hint }: { name: string; label: string; set: boolean; hint?: string }) {
  return (
    <TextField
      label={label}
      hint={hint}
      name={name}
      type="password"
      autoComplete="off"
      placeholder={set ? "Salvo. Deixe em branco para manter" : ""}
    />
  );
}
