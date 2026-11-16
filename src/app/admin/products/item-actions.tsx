import { Menu } from "@/components/action/menu";
import type { MenuEntry } from "@/components/action/menu-popover";
import { archiveItem, moveItem } from "@/lib/actions/products";

// Archiving is undone with Restaurar from the same menu, so it needs no confirmation step.
export function ItemActions({
  kind,
  id,
  first,
  last,
  archived,
  page,
}: {
  kind: "product" | "module" | "lesson";
  id: string | number;
  first: boolean;
  last: boolean;
  archived: boolean;
  page?: string;
}) {
  const key = String(id);

  const items: MenuEntry[] = [
    ...(page && !archived ? [{ label: "Ver página", href: page, newTab: true }] : []),
    ...(first ? [] : [{ label: "Mover para cima", action: moveItem, fields: { kind, key, direction: "up" } }]),
    ...(last ? [] : [{ label: "Mover para baixo", action: moveItem, fields: { kind, key, direction: "down" } }]),
    archived
      ? { label: "Restaurar", action: archiveItem, fields: { kind, key, archived: "0" } }
      : { label: "Arquivar", action: archiveItem, fields: { kind, key, archived: "1" }, danger: true },
  ];

  return <Menu label="Mais ações" items={items} />;
}
