import "server-only";
import { formatTitleCase } from "@/format";
import { jsonObject } from "./guard";

// Every lookup in a public registry goes through here. Only CNPJ (Receita Federal data served by BrasilAPI): CPF data is
// not public (LGPD), and the store asks for no address, so it has no use for CEP.
export type Company = { name: string; city: string; town: string; uf: string; mei: boolean; simples: boolean };

const CNPJ_REGISTRY = "https://brasilapi.com.br/api/cnpj/v1/";

export async function company(cnpj: string): Promise<Company | undefined> {
  const response = await fetch(`${CNPJ_REGISTRY}${cnpj}`, { signal: AbortSignal.timeout(10_000) }).catch(
    () => undefined,
  );

  const body = response?.ok ? jsonObject(await response.text()) : undefined;
  const city = String(body?.codigo_municipio_ibge ?? "");
  const { razao_social: name, municipio: town, uf } = body ?? {};
  if (!/^\d{7}$/.test(city) || typeof name !== "string" || typeof town !== "string" || typeof uf !== "string")
    return undefined;
  return {
    name,
    city,
    town: formatTitleCase(town),
    uf,
    mei: body?.opcao_pelo_mei === true,
    simples: body?.opcao_pelo_simples === true,
  };
}
