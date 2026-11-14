import { Field } from "@/components/form/field";
import { Textarea } from "@/components/form/textarea";
import { OUTLINE } from "../shared";
import { TemplateField } from "../ui";

export type TemplateFields = { key: string; label: string; sample: string }[];

export function TemplateInput({
  name,
  label,
  value,
  fields,
  hint,
}: {
  name: string;
  label: string;
  value?: string;
  fields: TemplateFields;
  hint?: string;
}) {
  return (
    <TemplateField value={value} fields={fields} chip={OUTLINE}>
      <Field label={label} hint={hint}>
        {(control) => <Textarea {...control} name={name} required defaultValue={value} />}
      </Field>
    </TemplateField>
  );
}
