import { EmptyState } from "@/components/feedback/empty-state";
import { Section } from "@/components/layout/section";
import { Dialog } from "@/components/overlay/dialog";
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
    <Section title="Módulos e aulas" description="Na ordem da área de membros." actions={count ? add(false) : null}>
      {count ? (
        <ol className={styles.modules}>
          {product.modules.map((module, index) => (
            <ModuleItem key={module.id} module={module} first={index === 0} last={index === count - 1} />
          ))}
        </ol>
      ) : (
        <EmptyState
          title="Nenhum módulo ainda"
          description="Crie o primeiro módulo e depois adicione as aulas dele."
          action={add(true)}
        />
      )}
    </Section>
  );
}
