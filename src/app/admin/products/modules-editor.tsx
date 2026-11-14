import { EmptyState } from "@/components/feedback/empty-state";
import { Card } from "@/components/layout/card";
import { Dialog } from "@/components/overlay/dialog";
import { Text } from "@/components/text/text";
import type { Product } from "@/lib/catalog";
import { ModuleForm } from "./module-form";
import { ModuleItem } from "./module-item";
import styles from "./products.module.css";

export function ModulesEditor({ product }: { product: Product }) {
  const count = product.modules.length;

  const add = (primary: boolean) => (
    <Dialog
      trigger={{
        label: "Novo módulo",
        icon: "plus",
        size: "sm",
        variant: primary ? "solid" : "outline",
        tone: primary ? "primary" : "neutral",
      }}
      title="Novo módulo"
      description="Entra no fim da lista. Depois adicione as aulas dele."
      body={<ModuleForm product={product.slug} />}
    />
  );

  return (
    <Card title="Módulos e aulas" actions={count ? add(false) : null}>
      {count ? (
        <>
          <Text variant="body-sm" tone="muted">
            A área de membros mostra nesta ordem. Aulas arquivadas somem para os alunos.
          </Text>
          <ol className={styles.modules}>
            {product.modules.map((module, index) => (
              <ModuleItem key={module.id} module={module} first={index === 0} last={index === count - 1} />
            ))}
          </ol>
        </>
      ) : (
        <EmptyState
          title="Nenhum módulo ainda"
          description="Crie o primeiro módulo e depois adicione as aulas dele."
          action={add(true)}
        />
      )}
    </Card>
  );
}
