import { EmptyState } from "@/components/feedback/empty-state";
import { Card } from "@/components/layout/card";
import { BrandLogo } from "@/components/media/brand-logo";
import { Dialog } from "@/components/overlay/dialog";
import { Text } from "@/components/text/text";
import { deleteRecoveryStep } from "@/lib/actions";
import type { RecoveryStep } from "@/lib/messages";
import { AutomationRow } from "./automation-row";
import styles from "./automations.module.css";
import { delayLabel } from "./delay";
import { DeleteDialog } from "./delete-dialog";
import { StepForm } from "./step-form";
import type { TemplateFields } from "./template-input";

const CHANNEL = { whatsapp: "WhatsApp", email: "E-mail" };

export function Recovery({ steps, fields }: { steps: RecoveryStep[]; fields: TemplateFields }) {
  const add = (primary: boolean) => (
    <Dialog
      trigger={{
        label: "Adicionar mensagem",
        size: "sm",
        icon: "plus",
        variant: primary ? "solid" : "outline",
        tone: primary ? "primary" : "neutral",
      }}
      title="Adicionar mensagem"
      body={<StepForm fields={fields} />}
    />
  );

  return (
    <Card title="Recuperação de Pix não pago" actions={steps.length ? add(false) : null}>
      <Text variant="body-sm" tone="muted">
        Param quando a pessoa paga ou responde SAIR.
      </Text>
      {steps.length ? (
        <ol className={`${styles.list} ${styles.timeline}`}>
          {steps.map((step, index) => (
            <AutomationRow
              key={step.id}
              lead={<BrandLogo brand={step.channel} />}
              title={
                <Text variant="body" weight="semibold">
                  {delayLabel(step.afterMinutes)}
                  <span className="sr-only">, por {CHANNEL[step.channel]}</span>
                </Text>
              }
              text={step.text}
              actions={
                <>
                  <Dialog
                    trigger={{ label: "Editar", size: "sm" }}
                    title={`Editar a mensagem ${index + 1}`}
                    body={<StepForm step={step} fields={fields} />}
                  />
                  <DeleteDialog action={deleteRecoveryStep} id={step.id} title={`Excluir a mensagem ${index + 1}`} />
                </>
              }
            />
          ))}
        </ol>
      ) : (
        <EmptyState
          title="Nenhuma mensagem de recuperação"
          description="Quem gerar o Pix e não pagar não recebe nenhum lembrete."
          action={add(true)}
        />
      )}
    </Card>
  );
}
