import { Text } from "@/components/text/text";
import { savePix } from "@/lib/actions";
import { PixProviders } from "../connections/pix";
import { OUTLINE, type Links } from "../shared";
import { ActionButton } from "../ui";

export function PixChoice({ pix }: { pix: Links["pix"] }) {
  return (
    <>
      <PixProviders providers={pix.providers} />
      {pix.chosen ? null : (
        <>
          <Text variant="body-sm">
            Com o Pix na sua chave não há taxa, mas você confere cada pagamento no extrato do banco e libera o pedido em
            Pedidos. Com um provedor de Pix, o acesso é liberado sozinho assim que o pagamento cai.
          </Text>
          <div>
            <ActionButton
              action={savePix}
              fields={{ provider: "static" }}
              button={OUTLINE}
              label="Continuar com o Pix na minha chave"
              pendingLabel="Salvando"
              done="Pronto: os pedidos usam o Pix na chave de cada produto."
            />
          </div>
        </>
      )}
    </>
  );
}
