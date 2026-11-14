(() => {
  // src/dom.ts
  function byId(id) {
    const el = document.getElementById(id);
    if (!el) throw new Error(`#${id} not found`);
    return el;
  }

  // src/landing.ts
  var STAGES = [
    ["visita", "visita"],
    ["play", "play"],
    ["cta", "CTA"],
    ["checkout", "checkout"],
    ["compra", "compra"],
  ];
  var STEPS = [
    {
      module: "tracker",
      action: "Clica no anúncio do Facebook",
      time: "T+0s",
      text: "A Ana chega pela campanha black-friday. A página lê a URL e grava a origem: o painel mostra tanto o anúncio que a trouxe primeiro quanto o último clique antes da compra.",
      code: `visitante  v_8Kp2…  utm_source=facebook
                     utm_campaign=black-friday
                     fbclid=IwAR3…
evento     visita   produto=metodo-demo`,
      replacesHtml: "Substitui o <b>tracker de atribuição</b>.",
      counts: { visita: 1 },
    },
    {
      module: "vsl",
      action: "Dá play e assiste metade do vídeo",
      time: "T+2min",
      text: "A página de VSL manda um evento no play e em cada quartil assistido. A retenção vira número por campanha, não um gráfico em outra ferramenta.",
      code: `evento  vsl_play
evento  vsl_25
evento  vsl_50`,
      replacesHtml: "Substitui o <b>player de VSL</b> com métricas.",
      counts: { visita: 1, play: 1 },
    },
    {
      module: "vsl",
      action: "O botão aparece no segundo 20",
      time: "T+20s de vídeo",
      text: "O botão fica escondido até o segundo definido em cta_segundos. Quando aparece, grava cta_visto; quando ela clica, cta_clique.",
      code: `"vsl": { "cta_segundos": 20,
         "cta_texto": "Quero garantir minha vaga" }

evento  cta_visto
evento  cta_clique`,
      replacesHtml: "O <b>CTA atrasado</b> é configuração, não código.",
      counts: { visita: 1, play: 1, cta: 1 },
    },
    {
      module: "checkout",
      action: "Preenche nome, e-mail e WhatsApp",
      time: "T+6min",
      text: "O pedido nasce pendente e ligado ao mesmo visitante. A Meta recebe InitiateCheckout pelo servidor, com e-mail e telefone em sha256.",
      code: `pedido   ped_aB7e…  R$ 97,00  pendente
evento   checkout
CAPI  →  InitiateCheckout
         em=[sha256(ana@exemplo.com)]
         fbc=fb.1.1763060000000.IwAR3…`,
      replacesHtml: "Substitui o <b>checkout</b> e o <b>pixel server-side</b>.",
      counts: { visita: 1, play: 1, cta: 1, checkout: 1 },
    },
    {
      module: "checkout",
      action: "Vê o Pix e não paga",
      time: "T+7min",
      abandoned: true,
      text: "O código Pix sai para a chave do vendedor, com o número do pedido dentro. A Ana fecha a aba. O pedido continua pendente.",
      code: `pixCode({ key, name, city,
           amount: 9700, txid: "k3v9q2…" })
→ 000201…540597.00…6304 + CRC16`,
      replacesHtml: "Sem gateway e sem taxa por venda.",
      counts: { visita: 1, play: 1, cta: 1, checkout: 1 },
    },
    {
      module: "recuperação",
      action: "Recebe um WhatsApp 15 minutos depois",
      time: "T+22min",
      text: "A cada minuto o laço de recuperação procura pedidos pendentes cuja próxima etapa venceu. A primeira etapa é WhatsApp aos 15 minutos, com o link do mesmo Pix.",
      code: `"recuperacao": [
  {"apos_minutos": 15,   "canal": "whatsapp"},
  {"apos_minutos": 240,  "canal": "email"},
  {"apos_minutos": 1440, "canal": "whatsapp"} ]

mensagem  whatsapp  recuperacao  enviado`,
      replacesHtml: "Substitui a <b>recuperação de carrinho</b> e a régua de remarketing.",
      counts: { visita: 1, play: 1, cta: 1, checkout: 1 },
    },
    {
      module: "robô",
      action: "Responde “quero” no WhatsApp",
      time: "T+25min",
      text: "A resposta chega ao robô. A palavra quero abre um fluxo; cada nova mensagem avança um passo. O fluxo é um objeto no config.json.",
      code: `POST /api/webhooks/whatsapp  {"texto": "quero"}
→ "Que bom! Antes do link: qual é hoje
   o seu maior desafio para vender online?"`,
      replacesHtml: "Substitui o <b>Manychat</b>.",
      counts: { visita: 1, play: 1, cta: 1, checkout: 1 },
    },
    {
      module: "pagamento",
      action: "Paga o Pix",
      time: "T+31min",
      text: "O banco avisa por webhook assinado. A liberação é idempotente: se o aviso chegar três vezes, conta uma venda e manda um acesso. A sequência de recuperação para sozinha.",
      code: `POST /api/webhooks/payment
     X-Assinatura: hmac_sha256(segredo, corpo)
pedido   ped_aB7e…  pago
evento   compra  R$ 97,00
CAPI  →  Purchase  value=97.00 BRL`,
      replacesHtml: "A venda volta para a Meta e otimiza a campanha certa.",
      counts: { visita: 1, play: 1, cta: 1, checkout: 1, compra: 1 },
    },
    {
      module: "membros",
      action: "Abre a área de membros",
      time: "T+32min",
      text: "O link de acesso chega por e-mail e WhatsApp. A área mostra os módulos do produto comprado e guarda a aula que ela marcou como vista.",
      code: `membro    m_Q2…  token=UkOa…
acesso    metodo-demo
progresso m1a1  “Quem compra e por quê”`,
      replacesHtml: "Substitui a <b>área de membros</b>.",
      counts: { visita: 1, play: 1, cta: 1, checkout: 1, compra: 1 },
    },
    {
      module: "painel",
      action: "O dono vê de onde veio a venda",
      time: "no painel",
      text: "Uma consulta junta visitante e evento: visitas, plays, CTAs, checkouts, compras e receita por origem e campanha. Quem abandonou vira público de remarketing em hash.",
      code: `origem    campanha       visita play CTA ckout compra receita
facebook  black-friday     1     1    1    1     1   97,00
google    pesquisa         1     0    0    1     0    0,00`,
      replacesHtml: "Substitui o <b>dashboard</b> e exporta o <b>público de remarketing</b>.",
      counts: { visita: 1, play: 1, cta: 1, checkout: 1, compra: 1 },
    },
  ];
  var list = byId("passos");
  var prevButton = byId("ant");
  var nextButton = byId("prox");
  var isLast = (i) => i === STEPS.length - 1;
  var current = 0;
  function renderStepList() {
    STEPS.forEach((step, i) => {
      const item = document.createElement("li");
      item.classList.toggle("abandono", Boolean(step.abandoned));
      const button = document.createElement("button");
      button.type = "button";
      const dot = Object.assign(document.createElement("span"), { className: "ponto", textContent: String(i + 1) });
      const module = Object.assign(document.createElement("span"), { className: "mod", textContent: step.module });
      const action = Object.assign(document.createElement("span"), { className: "acao", textContent: step.action });
      const label = document.createElement("span");
      label.append(module, document.createElement("br"), action);
      button.append(dot, label);
      button.addEventListener("click", () => show(i));
      item.append(button);
      list.append(item);
    });
  }
  function renderScoreboard(step) {
    const cells = STAGES.map(([stage, label]) => {
      const count = step.counts[stage] ?? 0;
      const cell = document.createElement("div");
      if (count) cell.className = "on";
      cell.append(
        Object.assign(document.createElement("b"), { textContent: String(count) }),
        Object.assign(document.createElement("span"), { textContent: label }),
      );
      return cell;
    });
    byId("placar").replaceChildren(...cells);
  }
  function show(index) {
    current = Math.max(0, Math.min(STEPS.length - 1, index));
    const step = STEPS[current];
    if (!step) return;
    Array.from(list.children).forEach((item, i) => {
      item.classList.toggle("feito", i < current);
      item.classList.toggle("atual", i === current);
    });
    byId("d-tempo").textContent = `Passo ${current + 1} de ${STEPS.length} · ${step.time}`;
    byId("d-titulo").textContent = step.action;
    byId("d-texto").textContent = step.text;
    byId("d-codigo").textContent = step.code;
    byId("d-subs").innerHTML = step.replacesHtml;
    renderScoreboard(step);
    prevButton.disabled = current === 0;
    nextButton.textContent = isLast(current) ? "Recomeçar" : "Próximo passo →";
  }
  prevButton.addEventListener("click", () => show(current - 1));
  nextButton.addEventListener("click", () => show(isLast(current) ? 0 : current + 1));
  renderStepList();
  show(0);
})();
