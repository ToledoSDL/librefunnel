import { headers } from "next/headers";
import { Section } from "@/components/layout/section";
import type { Product } from "@/lib/catalog/products";
import { baseUrl } from "@/lib/guard";
import styles from "../admin.module.css";
import { TextField } from "../shared";
import { MoneyField } from "./money-field";
import { ProductForm } from "./product-form";

export async function GeneralSection({ product }: { product: Product }) {
  const store = new URL(baseUrl()).hostname;
  // Set by the Caddyfile that serves product domains; stores installed before it lack the header.
  const served = (await headers()).has("x-product-domains");

  return (
    <ProductForm product={product} section="general">
      <Section title="Produto" description="O novo preço vale para os próximos pedidos.">
        <div className={styles.grid}>
          <TextField label="Nome" name="name" required maxLength={120} defaultValue={product.name} />
          <MoneyField label="Preço" name="price" required defaultCents={product.price} />
        </div>
        <TextField label="Frase de apresentação" name="tagline" maxLength={300} defaultValue={product.tagline} />
      </Section>
      <Section
        title="Domínio próprio"
        description={`Opcional. O endereço abre a página deste produto, e a loja continua em ${store} para o painel e a área de membros.`}
      >
        <TextField
          label="Domínio"
          name="domain"
          maxLength={253}
          defaultValue={product.domain}
          placeholder="meucurso.com.br"
          autoCapitalize="none"
          spellCheck={false}
          hint={
            served
              ? `No DNS do domínio, crie um registro A com o mesmo IP de ${store}. O HTTPS sai sozinho no primeiro acesso.`
              : "Esta loja foi instalada antes dos domínios próprios. Rode o comando de instalação no servidor uma última vez (os dados ficam): depois disso, as atualizações pelo painel trazem tudo sozinhas."
          }
        />
      </Section>
    </ProductForm>
  );
}
