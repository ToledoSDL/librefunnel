import { PageHeader } from "@/components/layout/page-header";
import { integrations } from "@/lib/dashboard";
import { requireAdmin } from "../shared";
import { Email, Meta, Webhook, WhatsApp } from "./channels";
import { WhatsAppCloud } from "./cloud";
import styles from "./connections.module.css";
import { Section } from "./parts";
import { PixProviders } from "./pix";
import { Storage } from "./storage";
import { WooviCrypto } from "./woovi-crypto";

export default async function ConnectionsPage() {
  await requireAdmin();

  const links = await integrations();

  return (
    <>
      <PageHeader title="Conexões" />
      <div className={styles.page}>
        <Section title="Recebimento">
          <PixProviders providers={links.pix.providers} />
          <WooviCrypto
            crypto={links.pix.crypto}
            woovi={links.pix.providers.some((provider) => provider.id === "woovi" && provider.configured)}
          />
        </Section>
        <Section title="Entrega e mensagens">
          <Email email={links.email} />
          <WhatsAppCloud cloud={links.cloud} />
          <WhatsApp whatsapp={links.whatsapp} official={links.cloud.configured} />
        </Section>
        <Section title="Anúncios">
          <Meta meta={links.meta} />
        </Section>
        <Section title="Vídeos e arquivos">
          <Storage storage={links.storage} />
        </Section>
        <Section title="Avançado">
          <Webhook webhook={links.webhook} />
        </Section>
      </div>
    </>
  );
}
