import { Disclosure } from "@/components/layout/disclosure";
import type { Product } from "@/lib/catalog/products";
import styles from "../admin.module.css";
import { TextField } from "../shared";

export function PixFields({ pix }: { pix?: Product["pix"] }) {
  return (
    <>
      <TextField
        label="Chave Pix"
        hint="E-mail, CPF, CNPJ, chave aleatória ou celular com +55."
        name="pixKey"
        required
        defaultValue={pix?.key}
        autoComplete="off"
      />
      <Disclosure label="Ajustar nome e cidade do recebedor">
        <div className={styles.grid}>
          <TextField
            label="Nome do recebedor"
            hint="Em branco: a razão social do CNPJ ou o nome em Configurações."
            name="pixName"
            maxLength={60}
            defaultValue={pix?.name}
          />
          <TextField
            label="Cidade do recebedor"
            hint="Em branco: a cidade do CNPJ."
            name="pixCity"
            maxLength={60}
            defaultValue={pix?.city}
          />
        </div>
      </Disclosure>
    </>
  );
}
