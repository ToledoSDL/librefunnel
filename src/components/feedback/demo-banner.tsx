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
    </div>
  );
}
