import type { ReactNode } from "react";
import { Icon } from "../media/icon";
import styles from "./table.module.css";

type Column = {
  key: string;
  label: string;
  align?: "end";
  sort?: { href: string; direction?: "ascending" | "descending" };
};

export function Table({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: Column[];
  rows: { id: string; cells: Record<string, ReactNode> }[];
}) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" data-align={column.align} aria-sort={column.sort?.direction}>
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
            <tr key={row.id}>
              {columns.map((column) => (
                <td key={column.key} data-align={column.align}>
                  {row.cells[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
