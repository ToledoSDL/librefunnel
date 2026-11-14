import type { ReactNode } from "react";
import type { IconName } from "../media/icon";
import { Icon } from "../media/icon";

export function ButtonContent({
  icon,
  iconOnly,
  children,
}: {
  icon?: IconName;
  iconOnly?: boolean;
  children: ReactNode;
}) {
  return (
    <>
      {icon && <Icon name={icon} />}
      {iconOnly ? <span className="sr-only">{children}</span> : children}
    </>
  );
}
