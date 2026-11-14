import { Field } from "@/components/form/field";
import { Input } from "@/components/form/input";
import { Select } from "@/components/form/select";
import { Row } from "@/components/layout/row";
import { saveRecoveryStep } from "@/lib/actions";
import type { RecoveryStep } from "@/lib/messages";
import styles from "../admin.module.css";
import { PRIMARY } from "../shared";
import { SaveForm } from "../ui";
import { delayParts, UNITS } from "./delay";
import type { TemplateFields } from "./template-input";
import { TemplateInput } from "./template-input";

export function StepForm({ step, fields }: { step?: RecoveryStep; fields: TemplateFields }) {
  const parts = delayParts(step?.afterMinutes ?? 60);

  return (
    <SaveForm
      action={saveRecoveryStep}
      label={step ? "Salvar mensagem" : "Adicionar mensagem"}
      pendingLabel={step ? "Salvando" : "Adicionando"}
      done={step ? "Mensagem salva." : "Mensagem adicionada à sequência."}
      reset={!step}
      button={PRIMARY}
    >
      {step ? <input type="hidden" name="id" value={step.id} /> : null}
      <div className={styles.grid}>
        <Field label="Enviar depois de" hint="Contado a partir do Pix gerado.">
          {(control) => (
            <Row gap={2} wrap={false}>
              <Input {...control} name="delay" type="number" min={1} required defaultValue={parts.delay} />
              <Select
                name="unit"
                aria-label="Unidade"
                defaultValue={String(parts.unit.minutes)}
                options={UNITS.map((unit) => ({ value: String(unit.minutes), label: unit.label }))}
              />
            </Row>
          )}
        </Field>
        <Field label="Canal">
          {(control) => (
            <Select
              {...control}
              name="channel"
              defaultValue={step?.channel ?? "whatsapp"}
              options={[
                { value: "whatsapp", label: "WhatsApp" },
                { value: "email", label: "E-mail" },
              ]}
            />
          )}
        </Field>
      </div>
      <TemplateInput
        name="text"
        label="Mensagem"
        value={step?.text}
        fields={fields}
        hint="No e-mail, a primeira linha vira o assunto. No WhatsApp, mensagens entre 21h e 9h esperam até as 9h."
      />
    </SaveForm>
  );
}
