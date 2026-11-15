import { SIMPLE_ICONS } from "./icon-set";
import styles from "./brand-logo.module.css";

// Brand colors are part of each logo, not of the product palette.
const BRANDS: Record<string, { icon?: keyof typeof SIMPLE_ICONS; src?: string; color: string; initials?: string }> = {
  mercadopago: { src: "/brands/mercadopago.svg", color: "#00bcff" },
  woovi: { src: "/brands/woovi.svg", color: "#03d69d" },
  abacatepay: { src: "/brands/abacatepay.svg", color: "#7fb83d" },
  depix: { src: "/brands/depix.svg", color: "#38e3ac" },
  noxpay: { src: "/brands/noxpay.svg", color: "#f5a623" },
  pix: { icon: "pix", color: "#32bcad" },
  gmail: { icon: "gmail", color: "#ea4335" },
  brevo: { icon: "brevo", color: "#0b996e" },
  mailjet: { color: "#9585f4", initials: "MJ" },
  email: { color: "#6b6e66", initials: "@" },
  whatsapp: { icon: "whatsapp", color: "#25d366" },
  meta: { icon: "meta", color: "#0081fb" },
  webhook: { color: "#6b6e66", initials: "{ }" },
  cloudflare: { icon: "cloudflare", color: "#f38020" },
  nfse: { color: "#6b6e66", initials: "NF" },
};

export type Brand = keyof typeof BRANDS;

export function BrandLogo({ brand, size = "md" }: { brand: Brand; size?: "md" | "lg" }) {
  const entry = BRANDS[brand];
  const body = entry?.icon ? SIMPLE_ICONS[entry.icon] : undefined;

  return (
    <span className={styles.logo} data-size={size} style={{ color: entry?.color }} aria-hidden>
      {entry?.src ? (
        <img src={entry.src} alt="" width={28} height={28} />
      ) : body ? (
        <svg viewBox="0 0 24 24" fill="currentColor" dangerouslySetInnerHTML={{ __html: body }} />
      ) : (
        <span className={styles.initials}>{entry?.initials ?? brand.slice(0, 1).toUpperCase()}</span>
      )}
    </span>
  );
}
