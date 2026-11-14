import { Dialog } from "@/components/overlay/dialog";
import { Badge } from "@/components/text/badge";
import { Text } from "@/components/text/text";
import type { Module } from "@/lib/catalog";
import { ItemActions } from "./item-actions";
import { LessonForm } from "./lesson-form";
import styles from "./products.module.css";

export function LessonItem({
  lesson,
  first,
  last,
}: {
  lesson: Module["lessons"][number];
  first: boolean;
  last: boolean;
}) {
  return (
    <li className={styles.item} data-archived={lesson.archived}>
      <span className={styles.itemTitle}>
        <Text as="span" variant="body-sm">
          {lesson.title}
        </Text>
        <Badge>{lesson.video ? "Vídeo" : "Leitura"}</Badge>
        {lesson.archived ? <Badge>Arquivada</Badge> : null}
      </span>
      <div className={styles.itemActions}>
        <Dialog trigger={{ label: "Editar", size: "sm" }} title="Editar aula" body={<LessonForm lesson={lesson} />} />
        <ItemActions kind="lesson" id={lesson.id} first={first} last={last} archived={lesson.archived} />
      </div>
    </li>
  );
}
