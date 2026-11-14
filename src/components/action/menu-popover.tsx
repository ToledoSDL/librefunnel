"use client";

import { Menu, MenuButton, MenuItem, MenuProvider } from "@ariakit/react";
import type { ReactNode } from "react";
import type { ButtonAttributes } from "./button";
import styles from "./menu.module.css";

export type MenuEntry = { label: string; danger?: boolean } & (
  | { href: string; newTab?: boolean }
  | { action: (state: { code: null }, form: FormData) => Promise<unknown>; fields?: Record<string, string> }
);

export function MenuPopover({
  trigger,
  triggerLook,
  items,
}: {
  trigger: ReactNode;
  triggerLook: ButtonAttributes;
  items: MenuEntry[];
}) {
  return (
    <MenuProvider>
      <MenuButton {...triggerLook}>{trigger}</MenuButton>
      <Menu gutter={4} className={styles.menu}>
        {items.map((item) =>
          "href" in item ? (
            <MenuItem
              key={item.label}
              className={styles.menuItem}
              data-danger={item.danger}
              render={
                <a
                  href={item.href}
                  target={item.newTab ? "_blank" : undefined}
                  rel={item.newTab ? "noopener noreferrer" : undefined}
                />
              }
            >
              {item.label}
            </MenuItem>
          ) : (
            <form
              key={item.label}
              action={async (form) => {
                await item.action({ code: null }, form);
              }}
            >
              {Object.entries(item.fields ?? {}).map(([name, value]) => (
                <input key={name} type="hidden" name={name} value={value} />
              ))}
              <MenuItem
                className={styles.menuItem}
                data-danger={item.danger}
                hideOnClick={false}
                render={<button type="submit" />}
              >
                {item.label}
              </MenuItem>
            </form>
          ),
        )}
      </Menu>
    </MenuProvider>
  );
}
