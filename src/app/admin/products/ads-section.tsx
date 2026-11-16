import { Section } from "@/components/layout/section";
import { saveProductAds } from "@/lib/actions/ads";
import type { Product } from "@/lib/catalog/products";
import { adConnections, productAccounts } from "@/lib/tracking/accounts";
import styles from "../admin.module.css";
import { PRIMARY, TextField } from "../shared";
import { SaveForm } from "../ui";
import { SecretInput } from "../connections/parts";

function fallback(store: string, what: string) {
  return store ? `Em branco: usa ${what} da loja (${store}).` : `Em branco: usa ${what} da loja, ainda não conectado.`;
}

// For a product sold under another ad account. Everything here is optional: a blank field uses the store's connection.
export async function AdsSection({ product }: { product: Product }) {
  const [store, own] = await Promise.all([adConnections(), productAccounts(product.slug)]);

  return (
    <SaveForm
      reset
      action={saveProductAds}
      label="Salvar anúncios"
      pendingLabel="Salvando"
      done="Anúncios salvos."
      bar
      button={PRIMARY}
    >
      <input type="hidden" name="slug" value={product.slug} />
      <Section
        title="Meta"
        description="Só se este produto anuncia por outro Pixel. As vendas e as visitas dele vão para este Pixel em vez do da loja."
      >
        <div className={styles.grid}>
          <TextField
            label="ID ou código do Pixel"
            name="metaPixel"
            autoComplete="off"
            defaultValue={own.meta?.fields.pixelId}
            hint={fallback(store.meta.pixelId, "o Pixel")}
          />
          <SecretInput
            name="metaToken"
            label="Token da API de Conversões"
            set={Boolean(own.meta?.secrets.token)}
            hint="Em branco: usa o token da loja, que precisa ter acesso a este Pixel."
          />
        </div>
      </Section>
      <Section title="TikTok" description="Só se este produto anuncia por outro Pixel do TikTok.">
        <div className={styles.grid}>
          <TextField
            label="Código do Pixel"
            name="tiktokPixel"
            autoComplete="off"
            defaultValue={own.tiktok?.fields.pixelCode}
            hint={fallback(store.tiktok.pixelCode, "o Pixel")}
          />
          <SecretInput
            name="tiktokToken"
            label="Token da Events API"
            set={Boolean(own.tiktok?.secrets.token)}
            hint="Em branco: usa o token da loja."
          />
        </div>
      </Section>
      <Section
        title="Google Ads"
        description="Só se as vendas deste produto contam em outra ação de conversão ou conta."
      >
        <div className={styles.grid}>
          <TextField
            label="Ação de conversão"
            name="actionId"
            autoComplete="off"
            defaultValue={own.googleads?.fields.actionId}
            hint={fallback(store.googleAds.actionId, "a ação")}
          />
          <TextField
            label="ID da conta do Google Ads"
            name="customerId"
            inputMode="numeric"
            defaultValue={own.googleads?.fields.customerId}
            hint="Em branco: a conta da loja. O login feito em Conexões precisa ter acesso a esta conta."
          />
        </div>
      </Section>
      <Section title="Google Analytics" description="Só se este produto tem a própria propriedade do Analytics.">
        <div className={styles.grid}>
          <TextField
            label="ID da métrica ou Google tag"
            name="measurementId"
            autoComplete="off"
            defaultValue={own.analytics?.fields.measurementId}
            hint={fallback(store.analytics.measurementId, "a propriedade")}
          />
          <SecretInput
            name="apiSecret"
            label="Chave secreta da API"
            set={Boolean(own.analytics?.secrets.apiSecret)}
            hint="Em branco: usa a chave da loja."
          />
        </div>
      </Section>
    </SaveForm>
  );
}
