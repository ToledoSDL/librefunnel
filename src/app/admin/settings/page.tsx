import { Tabs } from "@/components/data/tabs";
import { PageHeader } from "@/components/layout/page-header";
import { products, settings } from "@/lib/catalog";
import { pick, requireAdmin, type Query } from "../shared";
import { CheckoutSection } from "./checkout";
import { BrandSection, LegalSection, NoticesSection, StoreSection } from "./sections";
import styles from "./settings.module.css";

const SECTIONS = [
  { key: "store", label: "Loja" },
  { key: "brand", label: "Marca" },
  { key: "checkout", label: "Checkout" },
  { key: "notices", label: "Avisos" },
  { key: "legal", label: "Atendimento e dados" },
];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Query> }) {
  await requireAdmin();

  const requested = pick((await searchParams).section);
  const section = SECTIONS.find((item) => item.key === requested)?.key ?? "store";
  const [current, items] = await Promise.all([settings(), products()]);

  return (
    <>
      <PageHeader title="Configurações" />
      <Tabs
        label="Seções das configurações"
        items={SECTIONS.map((item) => ({
          label: item.label,
          href: item.key === "store" ? "/admin/settings" : `/admin/settings?section=${item.key}`,
          current: item.key === section,
        }))}
      />
      <div className={styles.sections}>
        {section === "store" ? <StoreSection current={current} products={items} /> : null}
        {section === "brand" ? <BrandSection current={current} /> : null}
        {section === "checkout" ? (
          <CheckoutSection current={current} sample={items.find((item) => !item.archived)} />
        ) : null}
        {section === "notices" ? <NoticesSection current={current} /> : null}
        {section === "legal" ? <LegalSection current={current} /> : null}
      </div>
    </>
  );
}
