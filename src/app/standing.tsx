import { Icon } from "@/components/media/icon";
import type { Standing } from "@/lib/members";
import styles from "./standing.module.css";

const TEXT = {
  owned: { title: "Você já tem acesso a este produto.", action: "Entrar na área de membros", icon: "circle-check" },
  pending: { title: "Seu Pix deste produto ainda espera o pagamento.", action: "Continuar o pagamento", icon: "clock" },
} as const;

// Shown on the sales and checkout pages, so a buyer who comes back is led to what they already have.
export function StandingNotice({ standing }: { standing: Standing }) {
  const text = TEXT[standing.kind];

  return (
    <p className={styles.standing} role="status">
      <Icon name={text.icon} size={16} />
      <span>
        {text.title} <a href={standing.href}>{text.action}</a>
      </span>
    </p>
  );
}
