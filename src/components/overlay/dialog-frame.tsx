"use client";

import {
  Dialog as AriakitDialog,
  DialogDescription,
  DialogDisclosure,
  DialogDismiss,
  DialogHeading,
  DialogProvider,
} from "@ariakit/react";
import type { ReactNode } from "react";
import type { ButtonAttributes } from "../action/button";
import styles from "./dialog.module.css";

export function DialogFrame({
  trigger,
  triggerLook,
  title,
  description,
  close,
  closeLook,
  cancelLook,
  body,
  children,
}: {
  trigger: ReactNode;
  triggerLook: ButtonAttributes;
  title: string;
  description?: ReactNode;
  close: ReactNode;
  closeLook: ButtonAttributes;
  cancelLook: ButtonAttributes;
  body?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <DialogProvider>
      <DialogDisclosure {...triggerLook}>{trigger}</DialogDisclosure>
      <AriakitDialog
        // Closed dialogs leave the page, so their forms start fresh and nothing inside keeps running.
        unmountOnHide
        className={styles.dialog}
        data-size={body ? "lg" : undefined}
        backdrop={<div className={styles.backdrop} />}
      >
        <header className={styles.dialogHeader}>
          <DialogHeading className={styles.dialogTitle}>{title}</DialogHeading>
          <DialogDismiss {...closeLook}>{close}</DialogDismiss>
        </header>
        {description ? <DialogDescription className={styles.dialogBody}>{description}</DialogDescription> : null}
        {body}
        {children ? (
          <footer className={styles.dialogFooter}>
            <DialogDismiss {...cancelLook}>Cancelar</DialogDismiss>
            {children}
          </footer>
        ) : null}
      </AriakitDialog>
    </DialogProvider>
  );
}
