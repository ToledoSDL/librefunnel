"use client";

import { Dialog, DialogDisclosure, DialogDismiss, DialogProvider, useDialogStore } from "@ariakit/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import styles from "./nav.module.css";

export type NavGroup = { label: string; items: { href: string; label: string; icon: ReactNode }[] };

function Links({ groups, onNavigate }: { groups: NavGroup[]; onNavigate?: () => void }) {
  const path = usePathname();

  return (
    <nav aria-label="Painel" className={styles.nav}>
      {groups.map((group) => (
        <div key={group.label} className={styles.group}>
          <span className={styles.groupLabel}>{group.label}</span>
          {group.items.map((item) => {
            const current = item.href === "/admin" ? path === "/admin" : path.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={styles.item}
                aria-current={current ? "page" : undefined}
                onClick={onNavigate}
              >
                {item.icon}
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function AdminNav({
  brand,
  groups,
  footer,
  menuIcon,
  closeIcon,
}: {
  brand: ReactNode;
  groups: NavGroup[];
  footer: ReactNode;
  menuIcon: ReactNode;
  closeIcon: ReactNode;
}) {
  const drawer = useDialogStore();

  return (
    <>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>{brand}</div>
        <Links groups={groups} />
        <div className={styles.footer}>{footer}</div>
      </aside>
      <header className={styles.mobileBar}>
        <div className={styles.brand}>{brand}</div>
        <DialogProvider store={drawer}>
          <DialogDisclosure className={styles.menuButton}>
            {menuIcon}
            <span className="sr-only">Abrir menu</span>
          </DialogDisclosure>
          <Dialog className={styles.drawer} backdrop={<div className={styles.backdrop} />}>
            <div className={styles.drawerHead}>
              <div className={styles.brand}>{brand}</div>
              <DialogDismiss className={styles.menuButton}>
                {closeIcon}
                <span className="sr-only">Fechar menu</span>
              </DialogDismiss>
            </div>
            <Links groups={groups} onNavigate={() => drawer.hide()} />
            <div className={styles.footer}>{footer}</div>
          </Dialog>
        </DialogProvider>
      </header>
    </>
  );
}
