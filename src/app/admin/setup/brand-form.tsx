import { Field } from "@/components/form/field";
import { TextLink } from "@/components/text/text-link";
import { saveSettings } from "@/lib/actions/store";
import type { Settings } from "@/lib/settings";
import { href, OUTLINE, PRIMARY, TextField } from "../shared";
import { MediaUpload, SaveForm } from "../ui";

export function BrandForm({ store }: { store: Settings }) {
  return (
    <>
      <SaveForm
        action={saveSettings}
        label="Salvar identidade"
        pendingLabel="Salvando"
        done="Identidade salva."
        button={PRIMARY}
      >
        <TextField
          label="Nome da loja"
          hint="No topo das páginas, no checkout e como remetente dos e-mails."
          name="brand"
          required
          maxLength={120}
          defaultValue={store.brand}
        />
        <Field label="Logo (opcional)" hint="PNG ou WebP com fundo transparente, na horizontal.">
          {(control) => (
            <MediaUpload
              id={control.id}
              aria-describedby={control["aria-describedby"]}
              name="logo"
              kind="image"
              value={store.logo}
              button={OUTLINE}
              remove={OUTLINE}
            />
          )}
        </Field>
      </SaveForm>
      <TextLink href={href("settings", { section: "brand" })}>Cor, ícone da aba e mais em Configurações</TextLink>
    </>
  );
}
