import { buttonAttributes } from "./button";
import { ButtonContent } from "./button-content";
import type { MenuEntry } from "./menu-popover";
import { MenuPopover } from "./menu-popover";

export function Menu({ label, items }: { label: string; items: MenuEntry[] }) {
  return (
    <MenuPopover
      trigger={
        <ButtonContent icon="ellipsis" iconOnly>
          {label}
        </ButtonContent>
      }
      triggerLook={buttonAttributes({ variant: "ghost", iconOnly: true })}
      items={items}
    />
  );
}
