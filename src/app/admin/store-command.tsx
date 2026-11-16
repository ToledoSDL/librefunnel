"use client";

import { useActionState, useEffect, useState } from "react";
import type { ButtonAttributes } from "@/components/action/button";
import { Stack } from "@/components/layout/stack";
import { Text } from "@/components/text/text";
import type { ActionState } from "@/lib/actions/form";
import { ErrorText } from "@/app/ui";
import styles from "./admin.module.css";

type Command = (state: ActionState, form: FormData) => Promise<ActionState>;

// A new container replaces the running one in the background, so poll until the version changes and reload into it.
function useReturn(active: boolean, from: string) {
  const [late, setLate] = useState(false);

  useEffect(() => {
    if (!active) return;

    let wentDown = false;
    const started = Date.now();

    const timer = setInterval(async () => {
      const reply = await fetch("/admin/version", { cache: "no-store" }).catch(() => undefined);

      if (!reply?.ok) {
        wentDown = true;
        return;
      }

      const { version }: { version?: string } = await reply.json();
      const waited = Date.now() - started;

      if (version !== from || wentDown || waited > 90_000) location.reload();
      if (waited > 180_000) setLate(true);
    }, 3000);

    return () => clearInterval(timer);
  }, [active, from]);

  return late;
}

export function StoreCommand({
  action,
  label,
  pendingLabel,
  waiting,
  look,
  current,
  version,
}: {
  action: Command;
  label: string;
  pendingLabel: string;
  waiting: string;
  look: ButtonAttributes;
  current: string;
  version?: string;
}) {
  const [state, run, pending] = useActionState(action, { code: null });
  const started = Boolean(state.ok);
  const late = useReturn(started, current);

  if (started) {
    return (
      <p className={styles.waiting} role="status">
        <span className={styles.spinner} aria-hidden />
        {late ? "Está demorando mais que o normal. Confira o servidor com docker compose ps." : waiting}
      </p>
    );
  }

  return (
    <form action={run}>
      <Stack gap={2}>
        {version ? <input type="hidden" name="version" value={version} /> : null}
        <div>
          <button type="submit" {...look} disabled={pending} aria-busy={pending || undefined}>
            {pending ? pendingLabel : label}
          </button>
        </div>
        {state.code ? (
          <Text variant="body-sm" tone="danger">
            <ErrorText code={state.code} />
          </Text>
        ) : null}
      </Stack>
    </form>
  );
}
