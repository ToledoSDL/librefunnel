-- The demo catalog: two products with course content and the automations. The public demo loads it before showcase.sql,
-- and the tests load it alone as their fixtures. Real installs never run it.
INSERT INTO product (slug, name, price_cents, tagline, pix_key, pix_name, pix_city, cover, position) VALUES (
  'planilha-preco', 'Planilha de Preço da Confeitaria', 4700,
  'Você lança o custo dos ingredientes e ela devolve o preço de cada pote, com embalagem e margem.',
  'demo@exemplo.com', 'LibreFunnel Demo', 'Florianopolis', '/demo/sheet-cover.webp', 2
);
--> statement-breakpoint
INSERT INTO product (slug, name, price_cents, tagline, pix_key, pix_name, pix_city, offer_ends_at, guarantee_days,
  bump_product, bump_price_cents, bump_headline, vsl_video, cta_seconds, cta_text, banner, cover, faq, position) VALUES (
  'bolo-no-pote', 'Bolo no Pote: da receita à primeira venda', 9700,
  'Massa, recheios e o preço certo para vender bolo no pote no seu bairro, com encomendas pelo WhatsApp.',
  'demo@exemplo.com', 'LibreFunnel Demo', 'Florianopolis', NULL, 7,
  'planilha-preco', 1990, 'Sim, quero a Planilha de Preço por R$ 19,90',
  '/demo/vsl-demo.mp4', 8, 'Quero garantir minha vaga', '/demo/course-banner.webp', '/demo/course-cover.webp',
  jsonb_build_array(
    jsonb_build_object('q', 'Como recebo o acesso?', 'a', 'Assim que o Pix é confirmado, o link da área de membros chega no seu e-mail. Se informar o WhatsApp, você recebe também o aviso de pagamento confirmado.'),
    jsonb_build_object('q', 'E se eu não gostar?', 'a', 'Você tem 7 dias para pedir o reembolso, sem precisar explicar o motivo.'),
    jsonb_build_object('q', 'Preciso de batedeira?', 'a', 'Não. A massa é batida à mão e o recheio vai ao fogo numa panela comum.')
  ),
  1
);
--> statement-breakpoint
INSERT INTO module (product, title, cover, position) VALUES
  ('bolo-no-pote', 'Módulo 1: massa e montagem', '/demo/course-module-1.webp', 1),
  ('bolo-no-pote', 'Módulo 2: recheios', '/demo/course-module-2.webp', 2),
  ('planilha-preco', 'A planilha', '/demo/sheet-module.webp', 1);
--> statement-breakpoint
INSERT INTO lesson (module_id, slug, title, text, position)
SELECT module.id, seed.slug, seed.title, seed.text, seed.position
FROM (VALUES
  ('bolo-no-pote', 1, 'm1a1', 'Massa de chocolate que não resseca', '4 ovos, 1 xícara de açúcar, 1 de farinha, 1/2 de chocolate em pó, 1/2 de leite morno, 1/2 de óleo e 1 colher de sopa de fermento. Asse em assadeira rasa a 180 °C por 25 minutos e corte os discos com a boca do pote.', 1),
  ('bolo-no-pote', 1, 'm1a2', 'Montagem sem vazar', 'Massa, recheio, massa, recheio. Deixe 1 cm livre até a tampa e leve à geladeira por 2 horas antes de tampar.', 2),
  ('bolo-no-pote', 2, 'm2a1', 'Brigadeiro de colher', '1 lata de leite condensado, 1 caixa de creme de leite, 2 colheres de sopa de chocolate em pó e 1 de manteiga. Fogo baixo até soltar do fundo da panela.', 1),
  ('planilha-preco', 1, 'pl1', 'Como preencher', 'Lance o preço que você paga em cada ingrediente e quanto vai em cada pote. A planilha soma embalagem e gás e mostra o preço para a margem que você escolher.', 1)
) AS seed (product, module_position, slug, title, text, position)
JOIN module ON module.product = seed.product AND module.position = seed.module_position;
--> statement-breakpoint
INSERT INTO recovery_step (after_minutes, channel, text) VALUES
  (15, 'whatsapp', 'Oi {name}! Vi que você começou a compra do {product} e não finalizou. O Pix continua valendo: {link}'),
  (240, 'email', E'Seu acesso ao {product} está reservado\n\nOi {name}, seu pedido ainda está aberto. Finalize aqui: {link}'),
  (1440, 'whatsapp', '{name}, seu pedido do {product} ({amount}) vence em breve. Pix copia e cola: {pix}');
--> statement-breakpoint
INSERT INTO reply (keywords, text) VALUES
  (ARRAY['quero', 'eu quero', 'link'], 'Que bom! Aqui está o link: {base}/v/bolo-no-pote'),
  (ARRAY['acesso', 'senha', 'login'], 'Seu acesso chega no e-mail da compra. Não achou? Peça um link novo em {base}/m com o e-mail que você usou.');
