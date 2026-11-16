import { PageHeader } from "@/components/layout/page-header";
import { integrations } from "@/lib/dashboard";
import { adConnections } from "@/lib/tracking/accounts";
import { requireAdmin } from "../shared";
import { Analytics } from "./analytics";
import { Email, Webhook, WhatsApp } from "./channels";
import { GoogleAds } from "./google-ads";
import { Meta } from "./meta";
import { TikTok } from "./tiktok";
import { Verification } from "./verification";
import { WhatsAppCloud } from "./cloud";
import styles from "./connections.module.css";
import { Nfse } from "./nfse";
import { Section } from "./parts";
import { PixProviders } from "./pix";
import { Storage } from "./storage";
import { WooviCrypto } from "./woovi-crypto";

export default async function ConnectionsPage() {
  await requireAdmin();

  const [links, ads] = await Promise.all([integrations(), adConnections()]);

  return (
    <>
      <PageHeader title="Conexões" />
      <div className={styles.page}>
        <Section title="Recebimento">
          <PixProviders providers={links.pix.providers} account={links.pix.account}>
            <WooviCrypto
              crypto={links.pix.crypto}
              woovi={links.pix.providers.some((provider) => provider.id === "woovi" && provider.configured)}
            />
          </PixProviders>
        </Section>
        <Section title="Nota fiscal">
          <Nfse nfse={links.nfse} />
        </Section>
        <Section title="Entrega e mensagens">
          <Email email={links.email} />
          <WhatsAppCloud cloud={links.cloud} />
          <WhatsApp whatsapp={links.whatsapp} official={links.cloud.configured} />
        </Section>
        <Section title="Anúncios e análise">
          <Meta meta={ads.meta} />
          <TikTok tiktok={ads.tiktok} />
          <GoogleAds ads={ads.googleAds} />
          <Analytics analytics={ads.analytics} />
          <Verification verification={ads.verification} />
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
