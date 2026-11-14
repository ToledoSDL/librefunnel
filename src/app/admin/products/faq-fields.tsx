import { Field } from "@/components/form/field";
import { Textarea } from "@/components/form/textarea";
import { TextField } from "../shared";

export function FaqFields({ question, answer }: { question?: string; answer?: string }) {
  return (
    <>
      <TextField label="Pergunta" name="faq_q" defaultValue={question} />
      <Field label="Resposta">
        {(control) => <Textarea {...control} name="faq_a" rows={3} defaultValue={answer} />}
      </Field>
    </>
  );
}
