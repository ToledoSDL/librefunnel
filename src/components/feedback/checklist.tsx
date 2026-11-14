import { useId } from "react";
import { Icon } from "../media/icon";
import { ChecklistStep, type ChecklistStepItem } from "./checklist-step";
import { Progress } from "./progress";
import styles from "./checklist.module.css";

// Required steps gate selling, so progress counts only them; the rest wait in a slim line once those are done.
export function Checklist({
  title,
  readyTitle,
  steps,
}: {
  title: string;
  readyTitle: string;
  steps: ChecklistStepItem[];
}) {
  const group = useId();
  const required = steps.filter((step) => step.level === "required");
  const finished = required.filter((step) => step.done).length;
  const current = required.find((step) => !step.done);

  if (steps.every((step) => step.done)) return null;

  if (!current) {
    return (
      <section className={styles.checklist}>
        <header className={styles.ready}>
          <span className={styles.readyMark}>
            <Icon name="check" size={16} />
          </span>
          <h2 className={styles.heading}>{readyTitle}</h2>
        </header>
        <ul className={styles.steps}>
          {steps
            .filter((step) => !step.done)
            .map((step) => (
              <ChecklistStep key={step.id} step={step} group={group} current={false} />
            ))}
        </ul>
      </section>
    );
  }

  return (
    <section className={styles.checklist}>
      <header className={styles.header}>
        <h2 className={styles.heading}>{title}</h2>
        <span className={styles.count}>
          {finished} de {required.length} obrigatórios
        </span>
      </header>
      <Progress value={finished} max={required.length} label="Passos obrigatórios concluídos" />
      <ol className={styles.steps}>
        {steps.map((step, index) => (
          <ChecklistStep key={step.id} step={step} number={index + 1} group={group} current={step === current} />
        ))}
      </ol>
    </section>
  );
}
