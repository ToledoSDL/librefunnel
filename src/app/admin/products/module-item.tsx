import { Dialog } from "@/components/overlay/dialog";
import { Badge } from "@/components/text/badge";
import { Text } from "@/components/text/text";
import type { Module } from "@/lib/catalog/products";
import { ItemActions } from "./item-actions";
import { LessonForm } from "./lesson-form";
import { LessonItem } from "./lesson-item";
import { ModuleForm } from "./module-form";
import styles from "./products.module.css";

export function ModuleItem({ module, first, last }: { module: Module; first: boolean; last: boolean }) {
  const count = module.lessons.length;

  return (
    <li className={styles.module}>
      <div className={styles.item} data-archived={module.archived}>
        <span className={styles.itemText}>
          <span className={styles.itemTitle}>
            <Text as="h3" variant="body" weight="semibold">
              {module.title}
            </Text>
            {module.archived ? <Badge>Arquivado</Badge> : null}
          </span>
          <Text variant="caption" tone="muted">
            {count === 0 ? "Sem aulas" : count === 1 ? "1 aula" : `${count} aulas`}
          </Text>
        </span>
        <div className={styles.itemActions}>
          <Dialog
            trigger={{ label: "Editar módulo", icon: "pencil", iconOnly: true, variant: "ghost" }}
            title="Editar módulo"
            body={<ModuleForm module={module} />}
          />
          <ItemActions kind="module" id={module.id} first={first} last={last} archived={module.archived} />
        </div>
      </div>
      {count ? (
        <ol className={styles.lessons}>
          {module.lessons.map((lesson, position) => (
            <LessonItem key={lesson.id} lesson={lesson} first={position === 0} last={position === count - 1} />
          ))}
        </ol>
      ) : null}
      <div className={styles.addLesson}>
        <Dialog
          trigger={{ label: "Nova aula", icon: "plus", size: "sm", variant: "ghost" }}
          title="Nova aula"
          description={`Entra no fim de ${module.title}.`}
          body={<LessonForm module={module.id} />}
        />
      </div>
    </li>
  );
}
