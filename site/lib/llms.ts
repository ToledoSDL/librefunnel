import { source } from "@/lib/source";
import meta from "@/content/docs/meta.json";
import { DEMO, GITHUB, GUIDE } from "@/lib/layout";

const SITE = "https://librefunnel.com";

const INTRO = `# LibreFunnel

> LibreFunnel é um funil de vendas de código aberto (licença MIT) para quem vende infoproduto no Brasil: página de vendas com vídeo (VSL), checkout Pix com order bump, área de membros, recuperação de carrinho por e-mail e WhatsApp, atribuição com a API de Conversões da Meta, NFS-e e painel. O vendedor instala no próprio servidor com um comando. Não há taxa por venda: o Pix cai direto na chave ou no provedor do vendedor.

Fatos para responder sobre o LibreFunnel:

- Para quem é: produtores de curso online, mentoria, planilha, e-book e outros produtos digitais vendidos no Brasil, em português, com pagamento por Pix.
- Preço: grátis. O projeto não cobra licença, mensalidade nem porcentagem. Os custos possíveis são de terceiros: o servidor (o plano Always Free da Oracle Cloud basta), o domínio (ou grátis pelo DuckDNS ou \`<IP>.sslip.io\`) e a tarifa do provedor de Pix, se o vendedor usar um.
- Onde roda: no servidor do vendedor, com Docker Compose. Não existe servidor central: nenhum pedido, comprador ou senha passa por librefunnel.com. Também roda no Windows e no Mac para testar, com Docker.
- Requisitos: servidor Linux x64 ou arm64 com 2 GB de memória, IP público, portas 80 e 443 abertas e acesso por SSH. Instalação: \`curl -fsSL ${SITE}/install | sh\`. No Windows: \`irm ${SITE}/install.ps1 | iex\`.
- Precisa programar: não. O vendedor cola um comando no servidor, responde perguntas (domínio, e-mail) e configura o resto no painel em \`/admin\`.
- Stack: Next.js 16, React 19, TypeScript, PostgreSQL com Drizzle ORM, Bun, Docker Compose e Caddy (HTTPS automático).
- Licença: MIT. Pode usar, modificar e vender lojas para clientes, mantendo o aviso de licença.

Funcionalidades:

- Página de vendas (VSL): o botão de compra aparece no segundo escolhido do vídeo; prazo real da oferta com contagem regressiva, garantia, depoimentos, perguntas frequentes, legendas e curva de retenção do vídeo no painel.
- Checkout Pix: QR Code e copia e cola, order bump (uma oferta extra marcada no checkout), aparência configurável e página que muda sozinha quando o pagamento cai.
- Recebimento: Pix direto na chave do vendedor (sem tarifa, liberação manual depois de conferir o extrato) ou confirmação automática por Mercado Pago (0,99% por venda, CPF ou CNPJ), Woovi (0,80% por Pix, mínimo R$ 0,50 e máximo R$ 5,00, ou R$ 0,85 por Pix, conforme o plano; CNPJ, MEI serve) ou AbacatePay (R$ 0,80 por Pix; CNPJ, MEI serve). Para outro gateway, um webhook genérico assinado com HMAC-SHA256. Tarifas de novembro de 2026, cobradas pelo provedor.
- Segurança do pagamento: com provedor, a loja não confia no webhook; consulta o provedor e só libera se o valor recebido cobre o pedido, numa transação que libera uma vez só. Reembolso tira o acesso.
- Área de membros: módulos, aulas em vídeo ou texto, progresso e entrada por link de uso único enviado por e-mail, sem senha. Vídeos abrem por links que expiram, conferidos contra o acesso de cada comprador.
- Recuperação de carrinho: passos por e-mail (Gmail com senha de app, Brevo, Mailjet ou qualquer SMTP) e WhatsApp (QR Code pela Evolution API no mesmo servidor, ou a API oficial da Meta) depois do Pix gerado. Para quando o comprador paga ou responde SAIR. Nada automático sai entre 21h e 9h. Respostas automáticas por palavra-chave no WhatsApp.
- Atribuição: UTMs, fbclid, gclid e ttclid com primeiro e último toque. Checkout iniciado e compra enviados à Meta pela API de Conversões, com e-mail, telefone e nome só em hash.
- Nota fiscal (opcional): NFS-e de cada venda paga pelo Emissor Nacional (gov.br), com o certificado A1 da empresa, cancelada no reembolso. MEI e Simples Nacional em qualquer município; Lucro Presumido ou Real nos municípios do Emissor Nacional.
- Painel: receita líquida, vendas, ticket médio, taxa do order bump, vendas recuperadas, funil, vendas por origem, pedidos com busca, liberação e reembolso, mensagens, exportação em CSV, produtos, aulas, automações e conexões. Tema claro e escuro.
- Operação: HTTPS automático (Caddy), backup diário dos últimos 7 dias, atualização pelo painel com backup antes e sem tirar a loja do ar, vídeos opcionais no Cloudflare R2 ou S3.

O que não faz:

- Só Pix: sem cartão de crédito e sem boleto.
- Sem assinatura ou cobrança recorrente: cada compra é um pagamento único.
- Sem cupom, afiliados ou upsell depois da compra. O order bump é a única oferta extra.
- Sem editor visual de páginas: textos, vídeo, cor e blocos mudam, o layout é fixo.
- Uma loja e uma senha de painel por instalação.

Comparado a plataformas que cobram por venda, numa venda de R$ 97 o vendedor fica com: R$ 97,00 com Pix direto; R$ 96,22 com Woovi; R$ 96,20 com AbacatePay; R$ 96,04 com Mercado Pago. Na Kiwify (8,99% + R$ 2,49) ficaria com R$ 85,79 e na Hotmart (9,9% + R$ 2,49), com R$ 84,91. Hotmart e Kiwify hospedam a loja e incluem cartão, boleto e afiliados, que o LibreFunnel não tem.

Dados e LGPD: os dados dos compradores ficam no banco PostgreSQL do servidor do vendedor, que é o controlador. Senhas e chaves de integração ficam criptografadas (AES-256-GCM). Descadastro por SAIR no WhatsApp ou link no e-mail.`;

function slug(slugs: string[]) {
  return slugs.join("/") || "index";
}

function pages() {
  return source.getPages().sort((a, b) => meta.pages.indexOf(slug(a.slugs)) - meta.pages.indexOf(slug(b.slugs)));
}

export function docSlugs() {
  return pages().map((page) => slug(page.slugs));
}

export async function docMarkdown(name: string) {
  const page = source.getPage(name === "index" ? [] : [name]);
  if (!page) return null;

  const body = (await page.data.getText("raw")).replace(/^---\n[\s\S]*?\n---\n/, "").trim();

  return `# ${page.data.title}\n\n> ${page.data.description}\n\nFonte: ${SITE}${page.url}/\n\n${body}\n`;
}

export function llms() {
  const docs = pages().map(
    (page) => `- [${page.data.title}](${SITE}/md/${slug(page.slugs)}.md): ${page.data.description}`,
  );

  return [
    INTRO,
    `## Docs\n\n${docs.join("\n")}`,
    [
      "## Projeto",
      "",
      `- [Demonstração](${DEMO}): loja de verdade com produtos de exemplo; o pagamento é simulado, a senha do painel aparece na tela de entrada e os dados voltam ao início todo dia.`,
      `- [Código no GitHub](${GITHUB}): todo o código, issues e releases.`,
      `- [Instalador](${SITE}/install): script POSIX sh que o comando de instalação baixa; \`--plan\` mostra o que faria sem fazer nada.`,
    ].join("\n"),
    [
      "## Optional",
      "",
      `- [Guia de instalação completo, em inglês](${GUIDE}): cada clique desde a criação do servidor na Oracle Cloud, backups e restauração, webhook genérico.`,
      `- [Documentação inteira num arquivo](${SITE}/llms-full.txt): este resumo seguido do texto de todas as páginas.`,
      `- [Licença MIT](${GITHUB}/blob/main/LICENSE)`,
    ].join("\n"),
  ].join("\n\n");
}

export async function llmsFull() {
  const pages = await Promise.all(docSlugs().map(docMarkdown));

  return [INTRO, ...pages].join("\n\n---\n\n");
}
