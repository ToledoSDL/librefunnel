"use client";

import { useRouter } from "next/navigation";
import { createContext, useActionState, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Text } from "@/components/text/text";
import type { ActionState, Code } from "@/lib/actions";
import { createOrder } from "@/lib/actions";
import { Money } from "./format";

type FormAction = (state: ActionState, formData: FormData) => Promise<ActionState>;
type FormView = { code: Code | null; ok: boolean; withBump: boolean };

const CHECKOUT_STORAGE = "lf_checkout";

const FIELD_CODES: Partial<Record<Code, string>> = {
  INVALID_NAME: "name",
  INVALID_EMAIL: "email",
  INVALID_PHONE: "phone",
};

const FormContext = createContext<FormView>({ code: null, ok: false, withBump: false });

const ERROR_TEXT: Record<Code, string> = {
  PRODUCT_NOT_FOUND: "Este produto não está mais à venda neste endereço. Confira o link com o vendedor.",
  OFFER_ENDED: "Esta oferta foi encerrada. Fale com o vendedor para saber da próxima turma.",
  INVALID_NAME: "Digite seu nome completo, com 2 a 120 letras e sem links.",
  INVALID_EMAIL: "Este e-mail não parece válido. Confira o @ e o final (ex.: nome@gmail.com) e use um endereço só.",
  INVALID_PHONE:
    "O WhatsApp precisa de DDD e número, com 10 ou 11 dígitos, como (11) 98765-4321. Se preferir, deixe em branco.",
  RATE_LIMITED: "Muitas tentativas seguidas deste aparelho. Espere alguns minutos e tente de novo.",
  ORDER_NOT_FOUND: "Pedido não encontrado. O link pode estar incompleto: atualize a página e confira o endereço.",
  INVALID_TRANSITION:
    "Este pedido mudou de situação enquanto a página estava aberta. Atualize a página para ver o estado atual.",
  INVALID_AMOUNT: "Valor inválido. Digite o valor que caiu no extrato, em reais, como 97,00.",
  UNDERPAID:
    "O valor recebido é menor que o do pedido. Confira o extrato; se combinou desconto, libere informando o valor recebido.",
  DUPLICATE_PAYMENT: "Este pagamento já tinha sido registrado. Nada mudou no pedido.",
  LINK_INVALID: "Este link de acesso expirou ou já foi usado. Peça um novo: ele chega no seu e-mail em instantes.",
  NOT_SIGNED_IN: "Sua sessão terminou. Entre de novo com o link enviado para o seu e-mail.",
  LESSON_NOT_FOUND: "Esta aula não existe mais ou não faz parte dos seus cursos. Volte para a lista de aulas.",
  INVALID_SIGNATURE:
    "Assinatura do webhook inválida. Confira se o segredo cadastrado no gateway é o mesmo salvo em Conexões; se gerou um segredo novo, atualize no gateway.",
  INVALID_PAYLOAD: "Os dados chegaram num formato inesperado. Atualize a página e tente de novo.",
  PAYLOAD_TOO_LARGE: "Os dados enviados passam do tamanho permitido. Envie menos conteúdo de uma vez.",
  INVALID_PASSWORD: "Senha incorreta. Use o valor de ADMIN_PASSWORD configurado no servidor.",
  DEMO_BLOCKED:
    "Isto fica desligado na demonstração, para nada sair de verdade nem encher o servidor. Na sua loja, funciona normalmente.",
  DEMO_ONLY: "O pagamento simulado só existe na demonstração. Pague o Pix pelo app do seu banco.",
  INVALID_EVENT: "Evento de rastreamento desconhecido. Atualize a página.",
  META_NOT_CONFIGURED:
    "Meta não configurada: preencha o ID do Pixel e o token da API de Conversões em Conexões e salve.",
  META_REJECTED:
    "A Meta recusou o evento. Confira em Conexões se o token foi gerado no mesmo Pixel do ID informado (Gerenciador de Eventos > seu Pixel > Configurações > Gerar token de acesso).",
  META_UNREACHABLE: "A Meta não respondeu agora. O envio é tentado de novo sozinho.",
  CHANNEL_NOT_CONFIGURED: "Canal não configurado. Preencha os dados do e-mail ou do WhatsApp em Conexões e salve.",
  WHATSAPP_DISCONNECTED: "WhatsApp desconectado. Conecte de novo pelo QR Code na aba Conexões e reenvie.",
  WHATSAPP_STARTING:
    "O WhatsApp está sendo ligado no servidor. Na primeira vez o download leva alguns minutos: clique em Conectar de novo daqui a pouco.",
  OPTED_OUT: "Esta pessoa pediu para não receber mensagens (respondeu SAIR), então nada foi enviado.",
  DAILY_CAP: "Limite diário do WhatsApp atingido, para o número não ser bloqueado. Reenvie amanhã.",
  INVALID_ADDRESS: "O e-mail ou WhatsApp do pedido não existe. Confirme o endereço com o comprador antes de reenviar.",
  PROVIDER_REJECTED:
    "O provedor recusou o envio ou a chave de acesso. Confira em Conexões usuário, senha e remetente do e-mail, a chave da Evolution ou a conexão do WhatsApp oficial, e use Testar.",
  PROVIDER_UNREACHABLE:
    "O servidor de envio não respondeu. Confira em Conexões o servidor de e-mail e o endereço da Evolution; o envio é tentado de novo sozinho.",
  ALREADY_OWNED: "O comprador já tem este produto por outro pedido, então a mensagem não foi enviada.",
  INVALID_SLUG:
    "O endereço do produto aceita só letras minúsculas sem acento, números e hífen, até 60 caracteres, como metodo-demo. Ou deixe em branco para gerar pelo nome.",
  SLUG_TAKEN: "Já existe um produto com este endereço, mesmo arquivado. Escolha outro, como metodo-demo-2.",
  INVALID_TITLE: "O nome precisa ter de 2 a 120 caracteres, numa linha só.",
  INVALID_PRICE: "Preço inválido. Use um valor entre R$ 1,00 e R$ 100.000,00 com até 2 casas decimais, como 97,00.",
  INVALID_PIX_KEY:
    "Chave Pix inválida. Use o e-mail, CPF, CNPJ, chave aleatória ou o celular com +55 e DDD, como +5548999990000, exatamente como está no app do banco.",
  INVALID_PIX_HOLDER: "Preencha o nome do recebedor e a cidade do Pix, como aparecem no app do banco.",
  INVALID_DATE:
    "Data de fim da oferta inválida. Escolha dia e hora no calendário ou deixe em branco para vender sem prazo.",
  INVALID_CTA_SECONDS:
    "O botão precisa aparecer entre 0 e 7200 segundos do vídeo (2 horas). Use um número inteiro, como 90 para 1min30.",
  STORAGE_UNREACHABLE:
    "O armazenamento não respondeu. Confira o endereço (no R2: https://<id da conta>.r2.cloudflarestorage.com) e tente de novo.",
  STORAGE_DENIED:
    "O armazenamento recusou a chave. Gere um token com permissão de leitura e escrita neste bucket e cole a chave e o segredo de novo.",
  STORAGE_NO_BUCKET: "O bucket não foi encontrado. Confira o nome, ou crie o bucket no painel do provedor.",
  STORAGE_CORS:
    "As chaves funcionam, mas o bucket ainda não aceita envios do painel e o token não pode mudar isso sozinho. Cole a política de CORS que aparece abaixo nas configurações do bucket e salve de novo.",
  CLOUDFLARE_TOKEN_INVALID:
    "A Cloudflare não aceitou este token. Copie de novo o valor que aparece logo depois de criar o token (ele só aparece uma vez).",
  CLOUDFLARE_PERMISSION:
    "O token não pode criar buckets. Crie outro pelo botão acima, que já marca a permissão R2 Storage: editar.",
  CLOUDFLARE_R2_DISABLED:
    "O R2 ainda não está ativo na sua conta. Abra R2 no painel da Cloudflare, ative uma vez (o plano gratuito cobre 10 GB) e clique em Conectar de novo.",
  INVALID_ENDPOINT:
    "Cole o endereço da API S3 começando com https://. No R2 ele aparece nas configurações do bucket, como https://<id da conta>.r2.cloudflarestorage.com/<bucket>.",
  INVALID_BUCKET:
    "Informe o nome do bucket (letras minúsculas, números, pontos e hífens), no campo Bucket ou no fim do endereço S3.",
  INVALID_TRIGGER:
    "Cada texto do vídeo precisa de texto (até 80 letras), um segundo para aparecer e um para sumir, maior que o primeiro. Apague as linhas que não vai usar.",
  INVALID_GUARANTEE:
    "A garantia precisa ser de 7 a 365 dias. O mínimo de 7 dias é exigido pelo Código de Defesa do Consumidor.",
  INVALID_BUMP:
    "O order bump precisa ser outro produto ativo da loja, com preço de R$ 1,00 a R$ 100.000,00. Escolha outro produto ou deixe sem order bump.",
  INVALID_TEXT:
    "Um texto está vazio ou longo demais. Preencha o campo obrigatório e encurte: frases curtas até 300 caracteres, mensagens até 2.000 e aulas até 20.000.",
  INVALID_MEDIA: "Arquivo não reconhecido. Remova e envie de novo pelo botão Enviar.",
  INVALID_FAQ: "Cada pergunta frequente precisa de pergunta e resposta. Preencha as duas ou remova a linha.",
  INVALID_TESTIMONIAL:
    "Cada depoimento precisa de nome (2 a 120 letras), texto e nota de 1 a 5 estrelas. Preencha tudo ou remova a linha.",
  INVALID_ORDER_HOURS:
    "A validade do pedido precisa ser de 1 a 720 horas e maior que a espera da última mensagem de recuperação.",
  INVALID_URL: "Os links precisam ser endereços completos, começando com https://, como https://seusite.com.br/termos.",
  UPDATER_UNAVAILABLE:
    "O atualizador não respondeu. Ele só existe quando a loja roda pelo Docker do guia de instalação; no servidor, rode docker compose up -d e tente de novo.",
  UPDATE_BUSY: "Já existe uma atualização ou reinício em andamento. Espere terminar: a página recarrega sozinha.",
  INVALID_VERSION: "Versão inválida. Use uma versão publicada no GitHub, como v0.3.0.",
  INVALID_HOUR: "Escolha uma hora de 0 a 23, ou desligue a atualização automática.",
  INVALID_COLOR: "A cor precisa estar no formato #RRGGBB, como #254ccb. Use o seletor de cor ao lado do campo.",
  INVALID_DOCUMENT: "O CPF precisa ter 11 números e o CNPJ 14. Pontos, barras e traços são opcionais.",
  INVALID_TEMPLATE:
    "A mensagem tem um campo entre chaves que não existe. Use só os campos mostrados acima do texto, escritos igual, como {name}.",
  INVALID_KEYWORDS:
    "Informe pelo menos uma palavra-chave, separadas por vírgula, como: quero, link. Cada uma com até 60 caracteres.",
  INVALID_DELAY:
    "O tempo de espera precisa ser de pelo menos 1 minuto e menor que a validade do pedido, definida em Configurações.",
  MEDIA_TYPE:
    "Formato não aceito. Envie vídeo MP4 ou WebM, ou imagem JPG, PNG ou WebP. Arquivos renomeados de outro formato são recusados.",
  MEDIA_TOO_LARGE: "Arquivo grande demais: vídeos até 1 GB e imagens até 10 MB. Comprima o arquivo e envie de novo.",
  SMTP_AUTH_FAILED:
    "O servidor de e-mail recusou o usuário ou a senha. No Gmail, use uma senha de app de 16 letras (myaccount.google.com/apppasswords), não a senha normal; na Brevo, a chave SMTP, não a de API. Corrija em Conexões e teste de novo.",
  SMTP_UNREACHABLE:
    "Não foi possível conectar ao servidor de e-mail. Confira o servidor e a porta em Conexões: 587 serve para a maioria dos provedores, 465 só se o provedor pedir.",
  OWNER_ADDRESS_MISSING:
    "O teste vai para você, mas falta o seu e-mail ou WhatsApp. Preencha em Configurações e teste de novo.",
  PSP_NOT_CONFIGURED:
    "Faltam as chaves deste provedor de Pix. Cole as chaves em Conexões, em Recebimento do Pix, e salve.",
  PSP_REJECTED:
    "O provedor de Pix recusou a chave. Cole de novo a chave de produção inteira (Mercado Pago: Access Token; Woovi: AppID com permissão de cobrança; AbacatePay: chave da API v2) e salve.",
  PSP_UNREACHABLE:
    "O provedor de Pix não respondeu agora. Teste de novo em alguns minutos; enquanto isso, os pedidos saem com o Pix na sua chave.",
  INVALID_HOST:
    "Servidor de e-mail inválido. Use só o endereço, sem https:// nem espaços, como smtp.gmail.com, ou escolha um provedor da lista.",
  INVALID_PORT: "Porta inválida. Use 587 (a maioria dos provedores) ou 465 se o provedor pedir.",
  INVALID_CREDENTIAL:
    "Chave, senha ou usuário em formato inválido, ou faltando. Cole de novo sem espaços nem quebras de linha; no primeiro cadastro, a chave é obrigatória.",
  INVALID_PIXEL_ID:
    "ID do Pixel inválido. Use só os números (5 a 20 dígitos) mostrados no Gerenciador de Eventos, em Fontes de dados.",
  INVALID_TEST_EVENT_CODE:
    "Código de teste inválido. Copie só as letras e números da aba Testar eventos, como TEST12345, ou deixe em branco.",
  INVALID_EVOLUTION_URL:
    "Endereço da Evolution inválido. Use o endereço completo com https://, como https://evolution.seudominio.com.br, ou deixe em branco para usar a Evolution do servidor.",
  TEMPLATE_PENDING:
    "A Meta ainda está analisando o modelo de mensagem do WhatsApp oficial, o que costuma levar alguns minutos. O envio é tentado de novo sozinho; se falhar, reenvie depois que Conexões mostrar Conectado.",
  CLOUD_TOKEN_INVALID:
    "A Meta não reconheceu o token. Gere um novo em Usuários do sistema, copie inteiro e cole de novo.",
  CLOUD_TOKEN_TEMPORARY:
    "Este token expira em algumas horas (é o temporário da tela Configuração da API). Gere um em Usuários do sistema com validade Nunca e cole de novo.",
  CLOUD_PERMISSION_MISSING:
    "O token não tem acesso à conta do WhatsApp. Em Usuários do sistema, atribua ao usuário a conta do WhatsApp com controle total e gere o token de novo marcando whatsapp_business_messaging e whatsapp_business_management.",
  CLOUD_NO_NUMBER:
    "A conta do WhatsApp não tem número. No painel do app, em WhatsApp > Configuração da API, adicione e verifique o número de vendas e clique em Conectar de novo.",
  CLOUD_APP_SECRET_INVALID:
    "A chave secreta do app não confere. Copie de novo em Configurações do app > Básico > Chave secreta do app (32 letras e números), do mesmo app do token.",
  CLOUD_WEBHOOK_FAILED:
    "A Meta não conseguiu acessar a loja para receber as respostas. A loja precisa estar no ar com https, no endereço de BASE_URL. Confira e clique em Conectar de novo.",
  CLOUD_PIN_REQUIRED:
    "Falta ativar o número na API da Meta. Digite no campo PIN 6 números: se o número já tem confirmação em duas etapas, o PIN dela; se não tem, invente um e guarde. Depois clique em Conectar de novo.",
  CLOUD_PIN_INVALID:
    "O PIN não confere. Use os 6 números da confirmação em duas etapas do número, ou redefina em WhatsApp Manager > Números de telefone > Configurações > Confirmação em duas etapas.",
  REPLY_WINDOW_CLOSED:
    "A API oficial do WhatsApp só aceita resposta até 24 horas depois da última mensagem do comprador. Quando ele escrever de novo, responda por aqui.",
  INVALID_WEBHOOK_SECRET:
    "O segredo do webhook da AbacatePay precisa ter pelo menos 32 caracteres, igual ao que você digitou ao criar o webhook lá.",
  PIX_PROVIDER_NOT_CONFIGURED:
    "Faltam chaves para ativar este provedor. Mercado Pago e AbacatePay pedem a chave da API e o segredo do webhook; a Woovi pede o AppID.",
  UPLOAD_FAILED: "O envio foi interrompido. Confira a internet e tente de novo; vídeos grandes levam alguns minutos.",
};

function formatPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length > 11) return value;
  if (digits.length > 6) return `(${digits.slice(0, 2)}) ${digits.slice(2, digits.length - 4)}-${digits.slice(-4)}`;
  if (digits.length > 2) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return digits;
}

function inputValue(form: HTMLFormElement, name: string) {
  const element = form.elements.namedItem(name);
  return element instanceof HTMLInputElement ? element.value : "";
}

function useFormAction(action: FormAction) {
  const form = useRef<HTMLFormElement>(null);
  const sent = useRef<FormData | null>(null);

  const [state, dispatch] = useActionState(
    (previous: ActionState, data: FormData) => {
      sent.current = data;
      return action(previous, data);
    },
    { code: null },
  );

  // React resets uncontrolled fields after every form action, so what the buyer typed comes back from what was sent.
  useEffect(() => {
    const data = sent.current;
    if (!data || !form.current) return;
    const invalid = state.code ? FIELD_CODES[state.code] : undefined;
    for (const element of Array.from(form.current.elements)) {
      if (!(element instanceof HTMLInputElement) || element.type === "hidden") continue;
      const value = data.get(element.name);
      if (element.type === "checkbox") element.checked = value !== null;
      else element.value = typeof value === "string" ? value : "";
      if (element.name === invalid) element.setAttribute("aria-invalid", "true");
      else element.removeAttribute("aria-invalid");
    }
  }, [state]);

  return { form, state, dispatch };
}

export function FieldMessage({ code, hint }: { code: Code; hint?: string }) {
  const view = useContext(FormContext);
  if (view.code !== code) return hint ?? null;
  return (
    <Text as="span" variant="body-sm" tone="danger">
      {ERROR_TEXT[code]}
    </Text>
  );
}

export function FormMessage({ done }: { done?: string }) {
  const view = useContext(FormContext);
  const general = view.code && !FIELD_CODES[view.code] ? view.code : null;

  return (
    <div aria-live="polite">
      {general ? (
        <Text variant="body-sm" tone="danger">
          {ERROR_TEXT[general]}
        </Text>
      ) : view.ok && done ? (
        <Text variant="body-sm" tone="success">
          {done}
        </Text>
      ) : null}
    </div>
  );
}

export function SubmitLabel({ idle, pending, again }: { idle: string; pending: string; again?: string }) {
  const { pending: busy } = useFormStatus();
  const view = useContext(FormContext);
  return busy ? pending : view.ok && again ? again : idle;
}

export function ActionForm({
  action,
  fields = {},
  children,
}: {
  action: FormAction;
  fields?: Record<string, string>;
  children: ReactNode;
}) {
  const { form, state, dispatch } = useFormAction(action);

  return (
    <form ref={form} action={dispatch}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <FormContext value={{ code: state.code, ok: Boolean(state.ok), withBump: false }}>{children}</FormContext>
    </form>
  );
}

export function ErrorText({ code }: { code: Code }) {
  return ERROR_TEXT[code];
}

export function CheckoutForm({
  slug,
  touch,
  bumpDefault,
  children,
}: {
  slug: string;
  touch: string;
  bumpDefault: boolean;
  children: ReactNode;
}) {
  const { form, state, dispatch } = useFormAction(createOrder);
  const [withBump, setWithBump] = useState(bumpDefault);

  useEffect(() => {
    const node = form.current;
    if (!node) return;
    try {
      const saved = new URLSearchParams(sessionStorage.getItem(CHECKOUT_STORAGE) ?? "");
      for (const name of ["name", "email", "phone"]) {
        const element = node.elements.namedItem(name);
        if (element instanceof HTMLInputElement && !element.value) element.value = saved.get(name) ?? "";
      }
    } catch {}
  }, [form]);

  return (
    <form
      ref={form}
      action={dispatch}
      id="buy"
      onChange={(event) => {
        const node = event.currentTarget;
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        if (target.name === "phone") target.value = formatPhone(target.value);
        if (target.name === "bump") setWithBump(target.checked);
        try {
          const saved = {
            name: inputValue(node, "name"),
            email: inputValue(node, "email"),
            phone: inputValue(node, "phone"),
          };

          sessionStorage.setItem(CHECKOUT_STORAGE, new URLSearchParams(saved).toString());
        } catch {}
      }}
    >
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="touch" value={touch} />
      <FormContext value={{ code: state.code, ok: Boolean(state.ok), withBump }}>{children}</FormContext>
    </form>
  );
}

export function CheckoutTotal({ price, bump }: { price: number; bump?: { name: string; price: number } }) {
  const { withBump } = useContext(FormContext);
  const added = withBump ? bump : undefined;

  return (
    <div aria-live="polite">
      <Text variant="metric">
        <Money cents={price + (added?.price ?? 0)} />
      </Text>
      {added ? (
        <Text variant="caption" tone="muted">
          com {added.name}
        </Text>
      ) : null}
    </div>
  );
}

export function RefreshWhilePending() {
  const router = useRouter();
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };

    const timer = setInterval(refresh, 5000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);
  return null;
}
