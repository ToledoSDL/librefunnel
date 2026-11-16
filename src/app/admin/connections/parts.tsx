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

export function Steps({ children }: { children: ReactNode }) {
  return <ol className={styles.steps}>{children}</ol>;
}

export function TestButton({ kind }: { kind: string }) {
  return (
    <ActionButton
      action={testConnection}
      fields={{ kind }}
      button={OUTLINE}
      label="Testar"
      pendingLabel="Testando"
      done="Conexão funcionando."
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
