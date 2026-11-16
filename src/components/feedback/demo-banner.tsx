import { enterDemo } from "@/lib/actions/members";
import { Text } from "@/components/text/text";
import { TextLink } from "@/components/text/text-link";
import styles from "./demo-banner.module.css";

export function DemoBanner() {
  return (
    <div className={styles.banner} role="note">
      <Text variant="body-sm" tone="muted">
        Demonstração do LibreFunnel. Os dados voltam ao original todo dia.{" "}
        <TextLink href="https://github.com/ToledoSDL/librefunnel" external>
          Instale a sua loja
        </TextLink>
      </Text>
      <nav className={styles.links} aria-label="Partes da demonstração">
        <a href="/">Loja</a>
        <form action={enterDemo}>
          <button type="submit">Área de membros</button>
        </form>
        <a href="/admin">Painel</a>
      </nav>
    </div>
  );
}
