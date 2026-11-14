import { PageHeader } from "@/components/layout/page-header";
import { products } from "@/lib/catalog";
import { baseUrl } from "@/lib/guard";
import { brl, RECOVERY_FIELDS, recoverySteps, replies, REPLY_FIELDS } from "@/lib/messages";
import { requireAdmin } from "../shared";
import { Recovery } from "./recovery";
import { Replies } from "./replies";

const FIELD_LABEL: Record<string, string> = {
  name: "primeiro nome",
  product: "produto",
  amount: "valor",
  link: "link do Pix",
  pix: "Pix copia e cola",
  base: "endereço da loja",
};

export default async function AutomationsPage() {
  await requireAdmin();

  const [steps, answers, active] = await Promise.all([recoverySteps(), replies(), products()]);
  const sample = active[0];

  const samples: Record<string, string> = {
    name: "Ana",
    product: sample?.name ?? "Seu produto",
    amount: brl(sample?.price ?? 9700),
    link: `${baseUrl()}/c/${sample?.slug ?? "produto"}?order=...`,
    pix: "00020126580014br.gov.bcb.pix...",
    base: baseUrl(),
  };

  const describe = (keys: string[]) =>
    keys.map((key) => ({ key, label: FIELD_LABEL[key] ?? key, sample: samples[key] ?? "" }));

  return (
    <>
      <PageHeader title="Automações" />
      <Recovery steps={steps} fields={describe(RECOVERY_FIELDS)} />
      <Replies answers={answers} fields={describe(REPLY_FIELDS)} />
    </>
  );
}
