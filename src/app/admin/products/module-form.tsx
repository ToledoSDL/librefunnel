import { saveModule } from "@/lib/actions/products";
import type { Module } from "@/lib/catalog/products";
import { PRIMARY, TextField } from "../shared";
import { SaveForm } from "../ui";
import { MediaField } from "./media-field";

export function ModuleForm({ product, module, number }: { product?: string; module?: Module; number?: number }) {
  return (
    <SaveForm
      action={saveModule}
      label={module ? "Salvar módulo" : "Adicionar módulo"}
      pendingLabel={module ? "Salvando" : "Adicionando"}
      done={module ? "Módulo salvo." : "Módulo adicionado. Crie outro ou feche esta janela."}
      reset={!module}
      button={PRIMARY}
    >
      {module ? (
        <input type="hidden" name="id" value={module.id} />
      ) : (
        <input type="hidden" name="product" value={product} />
      )}
      <TextField
        label="Nome do módulo"
        name="title"
        required
        maxLength={120}
        defaultValue={module?.title ?? `Módulo ${number}`}
      />
      <MediaField name="cover" kind="image" label="Capa (retrato, 420 x 584)" value={module?.cover} />
    </SaveForm>
  );
}
