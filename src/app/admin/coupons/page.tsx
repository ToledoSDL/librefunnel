import { EmptyState } from "@/components/feedback/empty-state";
import { Card } from "@/components/layout/card";
import { PageHeader } from "@/components/layout/page-header";
import { Dialog } from "@/components/overlay/dialog";
import { Badge } from "@/components/text/badge";
import { deleteCoupon } from "@/lib/actions";
import { productStates } from "@/lib/catalog";
import { coupons } from "@/lib/coupons";
import type { Coupon } from "@/lib/coupons";
import { AutomationRow } from "../automations/automation-row";
import styles from "../automations/automations.module.css";
import { DANGER, INTEGER, requireAdmin } from "../shared";
import { ActionButton } from "../ui";
import { CouponForm } from "./coupon-form";
import { formatMoney } from "@/format";

const DATE = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

function summary(coupon: Coupon, names: Map<string, string>) {
  const off = coupon.kind === "percent" ? `${coupon.value}% de desconto` : `${formatMoney(coupon.value)} de desconto`;

  const uses = coupon.maxUses
    ? `${INTEGER.format(coupon.uses)} de ${INTEGER.format(coupon.maxUses)} usos`
    : `${INTEGER.format(coupon.uses)} usos`;

  const until = coupon.expiresAt ? `vence ${DATE.format(coupon.expiresAt)}` : "sem prazo";

  const scope = coupon.products.length
    ? coupon.products.map((slug) => names.get(slug) ?? slug).join(", ")
    : "todos os produtos";

  return [off, uses, until, scope].join(" · ");
}

export default async function CouponsPage() {
  await requireAdmin();

  const [list, states] = await Promise.all([coupons(), productStates()]);
  const products = states.filter((state) => !state.archived);
  const names = new Map(states.map((state): [string, string] => [state.slug, state.name]));
  const now = new Date();

  const add = (primary: boolean) => (
    <Dialog
      trigger={{
        label: "Criar cupom",
        size: "sm",
        icon: "plus",
        variant: primary ? "solid" : "outline",
        tone: primary ? "primary" : "neutral",
      }}
      title="Criar cupom"
      description="O desconto é calculado no servidor e fica gravado no pedido."
      body={<CouponForm products={products} />}
    />
  );

  return (
    <>
      <PageHeader title="Cupons" />
      <Card title="Cupons de desconto" actions={list.length ? add(false) : null}>
        {list.length ? (
          <ul className={`${styles.list} ${styles.divided}`}>
            {list.map((coupon) => (
              <AutomationRow
                key={coupon.code}
                title={
                  <div className={styles.keywords}>
                    <Badge>{coupon.code}</Badge>
                    {coupon.expiresAt && coupon.expiresAt <= now ? <Badge tone="default">Vencido</Badge> : null}
                    {coupon.maxUses && coupon.uses >= coupon.maxUses ? <Badge tone="default">Esgotado</Badge> : null}
                  </div>
                }
                text={summary(coupon, names)}
                actions={
                  <>
                    <Dialog
                      trigger={{ label: "Editar", size: "sm" }}
                      title={`Editar ${coupon.code}`}
                      description="Pedidos já feitos mantêm o desconto com que foram feitos."
                      body={<CouponForm coupon={coupon} products={products} />}
                    />
                    <Dialog
                      trigger={{ label: "Excluir", variant: "ghost", tone: "danger", size: "sm" }}
                      title={`Excluir ${coupon.code}`}
                      description="O código para de funcionar no checkout. Pedidos já feitos mantêm o desconto."
                    >
                      <ActionButton
                        action={deleteCoupon}
                        fields={{ code: coupon.code }}
                        button={DANGER}
                        label="Excluir"
                        pendingLabel="Excluindo"
                      />
                    </Dialog>
                  </>
                }
              />
            ))}
          </ul>
        ) : (
          <EmptyState
            title="Nenhum cupom"
            description="Crie um código de desconto em porcentagem ou em reais, com prazo e limite de usos."
            action={add(true)}
          />
        )}
      </Card>
    </>
  );
}
