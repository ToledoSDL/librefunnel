import { Text } from "@/components/text/text";
import { savePix } from "@/lib/actions";
import { PixKeyForm, PixProviders } from "../connections/pix";
import { OUTLINE, type Links } from "../shared";
import { ActionButton } from "../ui";

export function PixChoice({ pix }: { pix: Links["pix"] }) {
  return (
    <>
      <PixProviders providers={pix.providers} account={pix.account} />
      {pix.account === null ? (
        <>
          <Text variant="body-sm">
            Sem taxa, o Pix cai na sua chave e você libera cada pedido ao ver o valor no extrato. Com um provedor, a
            liberação é automática.
          </Text>
          <PixKeyForm />
        </>
      ) : pix.chosen ? null : (
        <div>
          <ActionButton
            action={savePix}
            fields={{ provider: "static" }}
            button={OUTLINE}
            label={`Receber na chave ${pix.account.key}`}
            pendingLabel="Salvando"
            done="Pronto: os pedidos usam o Pix na chave da loja."
          />
        </div>
      )}
    </>
  );
}
