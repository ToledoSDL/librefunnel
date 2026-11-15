import type { ReactNode } from "react";
import { Icon } from "../media/icon";
import styles from "./table.module.css";

type Column = {
  key: string;
  label: string;
  align?: "end";
  // Shown from 768 px: a phone keeps the columns that identify the row, the detail page has the rest.
  wide?: boolean;
  sort?: { href: string; direction?: "ascending" | "descending" };
};

export function Table({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: Column[];
  rows: { id: string; href?: string; label?: string; cells: Record<string, ReactNode> }[];
}) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                data-align={column.align}
                data-wide={column.wide}
                aria-sort={column.sort?.direction}
              >
                {column.sort ? (
                  <a href={column.sort.href} className={styles.sortLink}>
                    {column.label}
                    <Icon
                      name={
                        column.sort.direction === "ascending"
                          ? "arrow-up"
                          : column.sort.direction === "descending"
                            ? "arrow-down"
                            : "arrow-up-down"
                      }
                      size={16}
                    />
                  </a>
                ) : (
                  column.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} data-link={row.href ? true : undefined}>
              {columns.map((column, index) => (
                <td key={column.key} data-align={column.align} data-wide={column.wide}>
                  {row.href && index === 0 ? (
                    <a href={row.href} className={styles.rowLink} aria-label={row.label}>
                      {row.cells[column.key]}
                    </a>
                  ) : (
                    row.cells[column.key]
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
