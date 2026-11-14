import type { ReactNode } from "react";
import type { ButtonLook } from "../action/button";
import { buttonAttributes } from "../action/button";
import { ButtonContent } from "../action/button-content";
import { Icon } from "../media/icon";
import { DialogFrame } from "./dialog-frame";

export function Dialog({
  trigger,
  title,
  description,
  body,
  children,
}: {
  trigger: ButtonLook & { label: string };
  title: string;
  description?: ReactNode;
  body?: ReactNode;
  children?: ReactNode;
}) {
  const { label, ...look } = trigger;

  return (
    <DialogFrame
      trigger={
        <ButtonContent icon={look.icon} iconOnly={look.iconOnly}>
          {label}
        </ButtonContent>
      }
      triggerLook={buttonAttributes(look)}
      title={title}
      description={description}
      close={
        <>
          <Icon name="x" />
          <span className="sr-only">Fechar</span>
        </>
      }
      closeLook={buttonAttributes({ variant: "ghost", iconOnly: true })}
      cancelLook={buttonAttributes({ variant: "outline" })}
      body={body}
    >
      {children}
    </DialogFrame>
  );
}
