import { Icon } from "../media/icon";
import styles from "./pagination.module.css";

export function Pagination({ page, pages, href }: { page: number; pages: number; href: (page: number) => string }) {
  if (pages <= 1) return null;

  return (
    <nav aria-label="Paginação" className={styles.pagination}>
      {page > 1 ? (
        <a href={href(page - 1)} className={styles.pageLink}>
          <Icon name="chevron-left" size={16} />
          Anterior
        </a>
      ) : (
        <span />
      )}
      <span className={styles.pageCount}>
        Página {page} de {pages}
      </span>
      {page < pages ? (
        <a href={href(page + 1)} className={styles.pageLink}>
          Próxima
          <Icon name="chevron-right" size={16} />
        </a>
      ) : (
        <span />
      )}
    </nav>
  );
}
