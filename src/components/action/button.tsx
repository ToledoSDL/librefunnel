import type { ReactNode } from "react";
import { ButtonContent } from "./button-content";
import type { IconName } from "../media/icon";
import { SubmitButton } from "./submit-button";
import styles from "./button.module.css";

export function buttonAttributes({ variant = "outline", tone = "neutral", size = "md", iconOnly, block }: ButtonLook) {
  return {
    className: styles.button,
    "data-variant": variant,
    "data-tone": tone,
    "data-size": size,
    "data-icon-only": iconOnly,
    "data-block": block,
  };
}

// Client components take these precomputed, so they never import the icon set through this module.
export type ButtonAttributes = ReturnType<typeof buttonAttributes>;

export type ButtonLook = {
  variant?: "solid" | "soft" | "outline" | "ghost";
  tone?: "primary" | "neutral" | "danger";
  size?: "sm" | "md" | "lg";
  icon?: IconName;
  iconOnly?: boolean;
  block?: boolean;
};

export function Button({
  href,
  type = "button",
  name,
  value,
  newTab,
  children,
  ...look
}: ButtonLook & {
  href?: string;
  type?: "button" | "submit" | "reset";
  name?: string;
  value?: string;
  newTab?: boolean;
  children: ReactNode;
}) {
  const content = (
    <ButtonContent icon={look.icon} iconOnly={look.iconOnly}>
      {children}
    </ButtonContent>
  );

  if (href) {
    return (
      <a
        href={href}
        target={newTab ? "_blank" : undefined}
        rel={newTab ? "noopener noreferrer" : undefined}
        {...buttonAttributes(look)}
      >
        {content}
      </a>
    );
  }

  if (type === "submit") {
    return (
      <SubmitButton name={name} value={value} {...buttonAttributes(look)}>
        {content}
      </SubmitButton>
    );
  }

  return (
    <button type={type} name={name} value={value} {...buttonAttributes(look)}>
      {content}
    </button>
  );
}
