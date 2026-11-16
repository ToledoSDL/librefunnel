import { Field } from "@/components/form/field";
import { Textarea } from "@/components/form/textarea";
import { Dialog } from "@/components/overlay/dialog";
import { saveVerification } from "@/lib/actions/ads";
import { PRIMARY, TextField, type Ads } from "../shared";
import { SaveForm } from "../ui";
import { Integration, Out } from "./parts";

export function Verification({ verification }: { verification: Ads["verification"] }) {
  const set = verification.google !== "" || verification.meta !== "";

  return (
    <Integration
      brand="searchconsole"
      name="Verificação de domínio"
      description="Google Search Console e Meta, em todos os domínios da loja e dos produtos."
      status={set ? { label: "Ativa", tone: "success" } : { label: "Desligada", tone: "default" }}
    >
      <Dialog
        trigger={{ label: set ? "Configurar" : "Ativar", size: "sm" }}
        title="Verificação de domínio"
        description="Cole a meta tag que a plataforma mostra (ou só o valor de content) e salve. Ela entra em todas as páginas, em todos os domínios; depois volte à plataforma e clique em Verificar."
        body={
          <SaveForm
            reset
            action={saveVerification}
            label="Salvar verificação"
            pendingLabel="Salvando"
            done="Salvo. Volte à plataforma e clique em Verificar."
            button={PRIMARY}
          >
            <Field
              label="Google Search Console"
              hint="Adicionar propriedade > Prefixo do URL > Tag HTML. Cada domínio de produto é uma propriedade com o próprio código: cole um por linha."
            >
              {(control) => (
                <Textarea {...control} name="google" rows={3} defaultValue={verification.google} spellCheck={false} />
              )}
            </Field>
            <p>
              <Out href="https://search.google.com/search-console">Abrir o Search Console</Out>
            </p>
            <TextField
              label="Meta"
              hint="Configurações do negócio > Segurança da marca > Domínios > Verificação por meta tag. O mesmo código vale para todos os domínios."
              name="meta"
              autoComplete="off"
              defaultValue={verification.meta}
            />
            <p>
              <Out href="https://business.facebook.com/settings/owned-domains">Abrir os domínios da Meta</Out>
            </p>
          </SaveForm>
        }
      />
    </Integration>
  );
}
