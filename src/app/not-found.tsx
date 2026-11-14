import { Button } from "@/components/action/button";
import { Row } from "@/components/layout/row";
import { Stack } from "@/components/layout/stack";
import { Text } from "@/components/text/text";
import styles from "./not-found.module.css";

export const metadata = { title: "Página não encontrada", robots: { index: false } };

export default function NotFound() {
  return (
    <div className={`surface-experience ${styles.page}`}>
      <main className={styles.main}>
        <Stack gap={4}>
          <Text variant="body-sm" tone="muted">
            Erro 404
          </Text>
          <Text variant="display">Página não encontrada</Text>
          <Text tone="muted">
            O endereço pode ter mudado ou o link chegou incompleto. Confira o link que você recebeu ou siga por um dos
            caminhos abaixo.
          </Text>
          <Row gap={3}>
            <Button href="/m" variant="solid" tone="primary">
              Entrar na área de membros
            </Button>
            <Button href="/">Ver os produtos</Button>
          </Row>
        </Stack>
      </main>
    </div>
  );
}
