import { saveReply } from "@/lib/actions";
import type { Reply } from "@/lib/messages";
import { PRIMARY, TextField } from "../shared";
import { SaveForm } from "../ui";
import type { TemplateFields } from "./template-input";
import { TemplateInput } from "./template-input";

export function ReplyForm({ reply, fields }: { reply?: Reply; fields: TemplateFields }) {
  return (
    <SaveForm
      action={saveReply}
      label={reply ? "Salvar resposta" : "Adicionar resposta"}
      pendingLabel={reply ? "Salvando" : "Adicionando"}
      done={reply ? "Resposta salva." : "Resposta adicionada."}
      reset={!reply}
      button={PRIMARY}
    >
      {reply ? <input type="hidden" name="id" value={reply.id} /> : null}
      <TextField
        label="Palavras-chave"
        hint="Separadas por vírgula."
        name="keywords"
        required
        defaultValue={reply?.keywords.join(", ")}
        placeholder="quero, link"
      />
      <TemplateInput name="text" label="Resposta" value={reply?.text} fields={fields} />
    </SaveForm>
  );
}
