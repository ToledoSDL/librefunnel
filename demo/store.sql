-- The demo catalog: two products with course content and the automations. The public demo loads it before showcase.sql,
-- and the tests load it alone as their fixtures. Real installs never run it.
INSERT INTO product (slug, name, price_cents, tagline, pix_key, pix_name, pix_city, cover, position) VALUES (
  'planilha-metas', 'Planilha de Metas do Lançamento', 4700,
  'A planilha que calcula quanto investir em anúncio para bater a meta de vendas.',
  'demo@exemplo.com', 'LibreFunnel Demo', 'Florianopolis', '/demo/spreadsheet.svg', 2
);
--> statement-breakpoint
INSERT INTO product (slug, name, price_cents, tagline, pix_key, pix_name, pix_city, offer_ends_at, guarantee_days,
  bump_product, bump_price_cents, bump_headline, vsl_video, cta_seconds, cta_text, banner, cover, faq, position) VALUES (
  'metodo-demo', 'Método Demo: do zero à primeira venda', 9700,
  'O passo a passo para montar e vender sua primeira oferta online, sem pagar mensalidade de ferramenta.',
  'demo@exemplo.com', 'LibreFunnel Demo', 'Florianopolis', NULL, 7,
  'planilha-metas', 1990, 'Sim, quero a Planilha de Metas por apenas R$ 19,90',
  '/demo/vsl-demo.mp4', 8, 'Quero garantir minha vaga', '/demo/banner.svg', '/demo/cover.svg',
  jsonb_build_array(
    jsonb_build_object('q', 'Como recebo o acesso?', 'a', 'Assim que o Pix é confirmado, o link da área de membros chega no seu e-mail. Se informar o WhatsApp, você recebe também o aviso de pagamento confirmado.'),
    jsonb_build_object('q', 'E se eu não gostar?', 'a', 'Você tem 7 dias para pedir o reembolso, sem precisar explicar o motivo.'),
    jsonb_build_object('q', 'Preciso pagar alguma ferramenta?', 'a', 'Não. Tudo o que o curso usa é gratuito e de código aberto.')
  ),
  1
);
--> statement-breakpoint
INSERT INTO module (product, title, cover, position) VALUES
  ('metodo-demo', 'Módulo 1: a oferta', '/demo/module-1.svg', 1),
  ('metodo-demo', 'Módulo 2: o tráfego', '/demo/module-2.svg', 2),
  ('planilha-metas', 'A planilha', '/demo/spreadsheet.svg', 1);
--> statement-breakpoint
INSERT INTO lesson (module_id, slug, title, text, position)
SELECT module.id, seed.slug, seed.title, seed.text, seed.position
FROM (VALUES
  ('metodo-demo', 1, 'm1a1', 'Quem compra e por quê', 'Escreva a promessa em uma frase.', 1),
  ('metodo-demo', 1, 'm1a2', 'Preço e garantia', 'Garantia de 7 dias é exigência do CDC para compra online.', 2),
  ('metodo-demo', 2, 'm2a1', 'UTM em todo link', 'Sem utm_source e utm_campaign o painel não sabe qual anúncio vendeu.', 1),
  ('planilha-metas', 1, 'pl1', 'Como preencher a meta', 'Comece pelo faturamento que você quer e volte até o custo por clique.', 1)
) AS seed (product, module_position, slug, title, text, position)
JOIN module ON module.product = seed.product AND module.position = seed.module_position;
--> statement-breakpoint
INSERT INTO recovery_step (after_minutes, channel, text) VALUES
  (15, 'whatsapp', 'Oi {name}! Vi que você começou a compra do {product} e não finalizou. O Pix continua valendo: {link}'),
  (240, 'email', E'Seu acesso ao {product} está reservado\n\nOi {name}, seu pedido ainda está aberto. Finalize aqui: {link}'),
  (1440, 'whatsapp', '{name}, seu pedido do {product} ({amount}) vence em breve. Pix copia e cola: {pix}');
--> statement-breakpoint
INSERT INTO reply (keywords, text) VALUES
  (ARRAY['quero', 'eu quero', 'link'], 'Que bom! Aqui está o link: {base}/v/metodo-demo'),
  (ARRAY['acesso', 'senha', 'login'], 'Seu acesso chega no e-mail da compra. Não achou? Peça um link novo em {base}/m com o e-mail que você usou.');
