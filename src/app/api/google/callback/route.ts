import { clientIp, demoMode, limited } from "@/lib/guard";
import { testConversions } from "@/lib/tracking/conversions";
import { finishAuthorization } from "@/lib/tracking/googleads";
import type { GoogleAuthCode } from "@/lib/tracking/googleads";

type Outcome = GoogleAuthCode | "GOOGLE_ADS_REJECTED" | "GOOGLE_ADS_UNREACHABLE" | "GOOGLE_ADS_NOT_CONFIGURED";

const TEXT: Record<Outcome | "OK", string> = {
  OK: "Google Ads conectado e testado: as vendas já vão para a sua ação de conversão. Voltando para Conexões.",
  GOOGLE_ADS_REJECTED:
    "O login funcionou, mas o Google Ads recusou o teste. Confira em Conexões o ID da conta, se a ação de conversão é do tipo Importação de cliques nessa conta e se o e-mail que você usou tem acesso a ela.",
  GOOGLE_ADS_UNREACHABLE:
    "O login funcionou, mas o Google Ads não respondeu ao teste agora. Clique em Testar em Conexões daqui a pouco.",
  GOOGLE_ADS_NOT_CONFIGURED:
    "O login funcionou, mas falta o ID da conta ou da ação de conversão. Preencha em Conexões > Google Ads.",
  GOOGLE_AUTH_EXPIRED:
    "Este login expirou ou já foi usado. Volte para Conexões e clique em Entrar com Google de novo, em até 10 minutos.",
  GOOGLE_AUTH_DENIED:
    "O acesso não foi autorizado no Google. Volte para Conexões, clique em Entrar com Google e aceite o acesso ao Data Manager.",
  GOOGLE_AUTH_FAILED:
    "O Google não confirmou o login. Confira em Conexões o ID e a chave secreta do cliente OAuth e se este endereço está nos URIs de redirecionamento autorizados dele.",
};

// The admin cookie is SameSite=Strict, so it does not come along on Google's redirect; this page links back, and that
// same-site navigation carries it. Success follows the link by itself.
function page(code: Outcome | null) {
  const text = TEXT[code ?? "OK"];
  const refresh = code ? "" : '<meta http-equiv="refresh" content="1;url=/admin/connections">';

  return new Response(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${refresh}<title>Google Ads</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5"><p>${text}</p><p><a href="/admin/connections">Voltar para Conexões</a></p></body></html>`,
    { status: code ? 400 : 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  );
}

export async function GET(request: Request) {
  if (demoMode() || limited("google-callback", clientIp(request.headers), 20, 600)) return page("GOOGLE_AUTH_EXPIRED");
  const query = new URL(request.url).searchParams;
  if (query.has("error")) return page("GOOGLE_AUTH_DENIED");
  const failed = await finishAuthorization(query.get("code") ?? "", query.get("state") ?? "");
  return page(failed ?? (await testConversions("googleads")));
}
