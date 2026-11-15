import { buttonAttributes } from "@/components/action/button";
import { ThemeMenu } from "@/components/action/theme-menu";
import { Field } from "@/components/form/field";
import { Input } from "@/components/form/input";
import { Icon } from "@/components/media/icon";
import { Card } from "@/components/layout/card";
import { PageHeader } from "@/components/layout/page-header";
import { adminSignOut } from "@/lib/actions";
import { demoMode, isAdmin } from "@/lib/guard";
import { cookies } from "next/headers";
import { Suspense } from "react";
import type { ReactNode } from "react";
import { StoreMark } from "@/app/buyer";
import styles from "./admin.module.css";
import { AdminNav } from "./nav";
import { VersionPanel } from "./version-panel";
import { ActionButton, AdminSignInForm } from "./ui";

function SignIn() {
  // The demo password is public on purpose: it is the demo server's ADMIN_PASSWORD.
  const demoPassword = demoMode() ? (process.env.ADMIN_PASSWORD ?? "") : undefined;

  return (
    <main className={styles.signIn}>
      <StoreMark />
      <PageHeader
        title="Entrar no painel"
        description={
          demoPassword === undefined
            ? "Use a senha definida em ADMIN_PASSWORD no servidor."
            : `Painel de demonstração, aberto a todos. A senha já está preenchida: ${demoPassword}`
        }
      />
      <Card>
        <AdminSignInForm
          button={buttonAttributes({ variant: "solid", tone: "primary", block: true })}
          label={demoPassword === undefined ? "Entrar" : "Entrar na demonstração"}
        >
          <Field label="Senha do painel">
            {(control) => (
              <Input
                {...control}
                name="password"
                type={demoPassword === undefined ? "password" : "text"}
                defaultValue={demoPassword}
                required
                autoComplete="current-password"
              />
            )}
          </Field>
        </AdminSignInForm>
      </Card>
    </main>
  );
}

export const metadata = { title: "Painel", robots: { index: false } };

export default async function AdminLayout({ children }: { children: ReactNode }) {
  if (!(await isAdmin())) return <SignIn />;

  const theme = (await cookies()).get("lf_theme")?.value;

  return (
    <div className={styles.shell}>
      <AdminNav
        brand={<StoreMark />}
        groups={[
          {
            label: "Vendas",
            items: [
              { href: "/admin", label: "Resumo", icon: <Icon name="layout-dashboard" size={16} /> },
              { href: "/admin/orders", label: "Pedidos", icon: <Icon name="receipt" size={16} /> },
              { href: "/admin/products", label: "Produtos", icon: <Icon name="package" size={16} /> },
            ],
          },
          {
            label: "Comunicação",
            items: [
              { href: "/admin/messages", label: "Mensagens", icon: <Icon name="inbox" size={16} /> },
              { href: "/admin/automations", label: "Automações", icon: <Icon name="workflow" size={16} /> },
            ],
          },
          {
            label: "Loja",
            items: [
              { href: "/admin/connections", label: "Conexões", icon: <Icon name="plug" size={16} /> },
              { href: "/admin/settings", label: "Configurações", icon: <Icon name="settings" size={16} /> },
            ],
          },
        ]}
        footer={
          <>
            {/* The updater answers over the network: the page never waits for it, the version button streams in. */}
            <Suspense fallback={null}>
              <VersionPanel />
            </Suspense>
            <ThemeMenu
              theme={theme === "light" || theme === "dark" ? theme : "system"}
              icons={{
                system: <Icon name="monitor" size={16} />,
                light: <Icon name="sun" size={16} />,
                dark: <Icon name="moon" size={16} />,
              }}
            />
            <ActionButton
              action={adminSignOut}
              button={buttonAttributes({ variant: "ghost", size: "sm" })}
              pendingLabel="Saindo"
              label={
                <>
                  <Icon name="log-out" size={16} /> Sair
                </>
              }
            />
          </>
        }
        menuIcon={<Icon name="menu" />}
        closeIcon={<Icon name="x" />}
      />
      <main className={styles.main}>{children}</main>
    </div>
  );
}
