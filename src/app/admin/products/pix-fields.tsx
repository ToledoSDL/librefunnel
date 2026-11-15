import type { Product } from "@/lib/catalog";
import styles from "../admin.module.css";
import { TextField } from "../shared";

export function PixFields({ pix }: { pix?: Product["pix"] }) {
  return (
    <div className={styles.grid}>
      <TextField
        label="Chave Pix"
        hint="E-mail, CPF, CNPJ, chave aleatória ou celular com +55."
        name="pixKey"
        required
        defaultValue={pix?.key}
        autoComplete="off"
      />
      <TextField
        label="Nome do recebedor"
        hint="Como aparece no banco, sem acentos."
        name="pixName"
        required
        maxLength={60}
        defaultValue={pix?.name}
      />
      <TextField label="Cidade do recebedor" name="pixCity" required maxLength={60} defaultValue={pix?.city} />
    </div>
  );
}
