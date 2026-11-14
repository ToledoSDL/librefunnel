import { Field } from "@/components/form/field";
import { Select } from "@/components/form/select";
import { Textarea } from "@/components/form/textarea";
import { TextField } from "../shared";

export function TestimonialFields({ name, text, stars }: { name?: string; text?: string; stars?: number }) {
  return (
    <>
      <TextField label="Nome" name="testimonial_name" defaultValue={name} />
      <Field label="Depoimento">
        {(control) => <Textarea {...control} name="testimonial_text" rows={3} defaultValue={text} />}
      </Field>
      <Field label="Nota">
        {(control) => (
          <Select
            {...control}
            name="testimonial_stars"
            defaultValue={String(stars ?? 5)}
            options={[5, 4, 3, 2, 1].map((count) => ({
              value: String(count),
              label: count === 1 ? "1 estrela" : `${count} estrelas`,
            }))}
          />
        )}
      </Field>
    </>
  );
}
