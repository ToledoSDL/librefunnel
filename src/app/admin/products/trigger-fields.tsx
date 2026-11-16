import { Field } from "@/components/form/field";
import { Select } from "@/components/form/select";
import type { Trigger } from "@/lib/catalog/products";
import styles from "../admin.module.css";
import { TextField } from "../shared";

const KINDS = [
  { value: "text", label: "Texto sobre o vídeo" },
  { value: "button", label: "Botão de compra" },
];

export function TriggerFields({ trigger }: { trigger?: Trigger }) {
  return (
    <>
      <TextField
        label="Texto"
        name="trigger_text"
        maxLength={80}
        placeholder="Preste atenção nesta parte"
        defaultValue={trigger?.text}
      />
      <div className={styles.grid}>
        <TextField
          label="Aparece aos (segundos)"
          name="trigger_at"
          type="number"
          min={0}
          max={7200}
          defaultValue={trigger?.at}
        />
        <TextField
          label="Some aos (segundos)"
          name="trigger_until"
          type="number"
          min={1}
          max={7200}
          defaultValue={trigger?.until}
        />
        <Field label="Tipo">
          {(control) => (
            <Select
              {...control}
              name="trigger_kind"
              options={KINDS}
              defaultValue={trigger?.button ? "button" : "text"}
            />
          )}
        </Field>
      </div>
    </>
  );
}
