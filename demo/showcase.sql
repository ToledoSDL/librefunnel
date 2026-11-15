-- Public demo only (DEMO_MODE=1): runs after store.sql on a truncated database. Every date is relative to now(),
-- so each reset opens a store with a live offer and the last 30 days of activity. Buyers and numbers are demo data.
INSERT INTO setting (key, value) VALUES
  ('brand', 'Confeitaria da Lia'),
  ('owner_email', 'demo@librefunnel.com'),
  ('owner_whatsapp', ''),
  ('terms_url', 'https://librefunnel.com/docs/termos'),
  ('terms_version', '2026-11'),
  ('order_hours', '72'),
  ('logo', ''),
  ('icon', ''),
  ('accent', '#a8324a'),
  ('support_email', 'suporte@librefunnel.com'),
  ('support_whatsapp', ''),
  ('legal_name', 'LibreFunnel Demo'),
  ('document', ''),
  ('privacy_url', 'https://librefunnel.com/docs/privacidade'),
  ('powered_by', '1'),
  ('description', 'Loja de demonstração do LibreFunnel: uma confeitaria fictícia. Produtos, compradores e números são dados de exemplo.'),
  ('share_image', ''),
  ('home', ''),
  ('checkout_phone', 'optional'),
  ('confirm_email', '0'),
  ('checkout_theme', 'light'),
  ('checkout_button', 'Pagar com Pix'),
  ('checkout_notice', 'Loja de demonstração: nenhum Pix é cobrado. Na tela do Pix, use Simular pagamento.'),
  ('checkout_countdown', '1'),
  ('checkout_trust', '1'),
  ('checkout_guarantee', '1'),
  ('checkout_testimonials', '1'),
  ('thanks_url', 'https://librefunnel.com'),
  ('thanks_label', 'Conhecer o LibreFunnel')
ON CONFLICT (key) DO UPDATE SET value = excluded.value;
--> statement-breakpoint
UPDATE product SET pix_key = 'demo@librefunnel.com';
--> statement-breakpoint
UPDATE product SET
  offer_ends_at = now() + interval '3 days',
  captions = '/demo/vsl-demo.vtt',
  player_autoplay = true,
  player_resume = true,
  player_fast_bar = true,
  player_floating = true,
  player_button = true,
  player_speed = true,
  triggers = jsonb_build_array(
    jsonb_build_object('at', 9, 'until', 12, 'text', 'Três módulos com acesso na hora', 'button', false),
    jsonb_build_object('at', 20, 'until', 24, 'text', 'Quero garantir minha vaga', 'button', true)
  ),
  bar_text = 'Demonstração: preço de lançamento por tempo limitado',
  bar_color = '#a8324a',
  testimonials = jsonb_build_array(
    jsonb_build_object('name', 'Depoimento de exemplo', 'text', 'Eu vendia a R$ 8 sem saber o custo. Refiz a conta na aula de preço e hoje vendo a R$ 12 na mesma rua.', 'stars', 5),
    jsonb_build_object('name', 'Depoimento de exemplo', 'text', 'A massa da aula 1 não resseca mesmo depois de três dias na geladeira. Era o que me fazia perder pote.', 'stars', 5),
    jsonb_build_object('name', 'Depoimento de exemplo', 'text', 'Bom para quem está começando. Queria mais sabores de recheio.', 'stars', 4)
  )
WHERE slug = 'bolo-no-pote';
--> statement-breakpoint
UPDATE product SET
  faq = jsonb_build_array(
    jsonb_build_object('q', 'Em qual programa a planilha abre?', 'a', 'No Google Planilhas e no Excel.'),
    jsonb_build_object('q', 'Como recebo a planilha?', 'a', 'O link fica na área de membros assim que o Pix é confirmado.')
  ),
  testimonials = jsonb_build_array(
    jsonb_build_object('name', 'Depoimento de exemplo', 'text', 'Descobri que o pote de ninho me custava mais que o de brigadeiro. Mudei o preço no mesmo dia.', 'stars', 5)
  )
WHERE slug = 'planilha-preco';
--> statement-breakpoint
INSERT INTO product (slug, name, price_cents, tagline, pix_key, pix_name, pix_city, offer_ends_at, guarantee_days,
  bump_product, bump_price_cents, bump_headline, cover, faq, testimonials, position) VALUES (
  'mentoria-cardapio', 'Mentoria: revisão do seu cardápio', 29700,
  'Três encontros gravados em que o cardápio de uma confeiteira é revisado: preço de cada sabor, o que sai do cardápio e como chega o pedido.',
  'demo@librefunnel.com', 'LibreFunnel Demo', 'Florianopolis', now() + interval '36 hours', 30,
  'planilha-preco', 2490, 'Adicionar a Planilha de Preço por R$ 24,90',
  '/demo/mentoring-cover.webp',
  jsonb_build_array(
    jsonb_build_object('q', 'Os encontros são ao vivo?', 'a', 'Não. Os encontros ficam gravados na área de membros e você assiste quando quiser.'),
    jsonb_build_object('q', 'Qual é a garantia?', 'a', '30 dias. Peça o reembolso pelo e-mail de suporte, sem precisar explicar o motivo.')
  ),
  jsonb_build_array(
    jsonb_build_object('name', 'Depoimento de exemplo', 'text', 'Tirei dois sabores que quase não vendiam e passei a fechar as encomendas na quinta. Sobra muito menos bolo.', 'stars', 5)
  ),
  3
);
--> statement-breakpoint
INSERT INTO module (product, title, cover, position) VALUES
  ('bolo-no-pote', 'Bônus: vender pelo WhatsApp', '/demo/course-module-3.webp', 3),
  ('mentoria-cardapio', 'Encontro 1: diagnóstico', '/demo/mentoring-meeting-1.webp', 1),
  ('mentoria-cardapio', 'Encontro 2: preços', '/demo/mentoring-meeting-2.webp', 2),
  ('mentoria-cardapio', 'Encontro 3: pedidos da semana', '/demo/mentoring-meeting-3.webp', 3);
--> statement-breakpoint
INSERT INTO lesson (module_id, slug, title, video, text, position)
SELECT module.id, seed.slug, seed.title, seed.video, seed.text, seed.position
FROM (VALUES
  ('bolo-no-pote', 1, 'm1a0', 'Boas-vindas', '/demo/vsl-demo.mp4', 'Assista ao vídeo e separe potes de 250 ml com tampa antes da próxima aula.', 0),
  ('bolo-no-pote', 2, 'm2a2', 'Ninho com morango', '', 'Leite em pó, creme de leite e leite condensado batidos a frio. O morango entra picado na hora de montar, nunca antes: a fruta solta água.', 2),
  ('bolo-no-pote', 2, 'm2a3', 'O ponto do recheio', '/demo/vsl-demo.mp4', 'Na colher, o recheio escorre devagar. Mole demais vaza da camada; firme demais fica seco na geladeira.', 3),
  ('bolo-no-pote', 3, 'm3a1', 'Cardápio em uma imagem', '', 'Foto do pote aberto, três sabores e o preço. Mais sabores atrasam a decisão.', 1),
  ('bolo-no-pote', 3, 'm3a2', 'Encomendas da semana', '', 'Feche os pedidos na quinta e produza na sexta: sobra menos e o bolo chega fresco.', 2),
  ('planilha-preco', 1, 'pl2', 'Exemplo preenchido', '/demo/vsl-demo.mp4', 'O pote de brigadeiro de 250 ml do começo ao fim: custo de R$ 4,50, venda a R$ 12,00.', 2),
  ('mentoria-cardapio', 1, 'mt1a1', 'O cardápio como chegou', '/demo/vsl-demo.mp4', 'Três sabores a R$ 8 e R$ 9, encomendas pelo direct e nenhuma foto do pote aberto.', 1),
  ('mentoria-cardapio', 1, 'mt1a2', 'O que mudar primeiro', '', 'Preço abaixo do custo, sabor que não vende e pedido sem link. Nessa ordem.', 2),
  ('mentoria-cardapio', 2, 'mt2a1', 'Refazendo os preços', '/demo/vsl-demo.mp4', 'Com a planilha aberta, cada sabor ganha o preço que cobre ingredientes, embalagem e o seu tempo.', 1),
  ('mentoria-cardapio', 3, 'mt3a1', 'Um dia para fechar pedidos', '', 'Um link de WhatsApp com a mensagem pronta e um horário fixo para fechar as encomendas da semana.', 1)
) AS seed (product, module_position, slug, title, video, text, position)
JOIN module ON module.product = seed.product AND module.position = seed.module_position;
--> statement-breakpoint
INSERT INTO reply (keywords, text) VALUES
  (ARRAY['preço', 'valor', 'quanto custa'], 'O curso Bolo no Pote sai por R$ 97 no Pix, com 7 dias de garantia: {base}/v/bolo-no-pote');
--> statement-breakpoint
-- 48 buyers, one order each, one every 15 hours. The Pix code is the same static BR Code orders.brCode builds,
-- CRC16-CCITT included, so a pending demo order can still be paid by QR or copy and paste.
WITH RECURSIVE buyer AS (
  SELECT n,
    'demo' || lpad(n::text, 16, '0') AS id,
    'democustomer' || lpad(n::text, 8, '0') AS customer_id,
    (ARRAY['Ana', 'Bruno', 'Carla', 'Diego', 'Elisa', 'Felipe', 'Gabriela', 'Henrique', 'Isabela', 'João', 'Larissa', 'Marcos', 'Natália', 'Otávio', 'Paula', 'Rafael'])[n % 16 + 1]
      || ' ' || (ARRAY['Souza', 'Lima', 'Pereira', 'Costa', 'Almeida', 'Ribeiro', 'Carvalho', 'Gomes', 'Martins', 'Rocha', 'Barbosa', 'Teixeira'])[n % 12 + 1] AS name,
    (ARRAY['ana', 'bruno', 'carla', 'diego', 'elisa', 'felipe', 'gabriela', 'henrique', 'isabela', 'joao', 'larissa', 'marcos', 'natalia', 'otavio', 'paula', 'rafael'])[n % 16 + 1]
      || '.' || (ARRAY['souza', 'lima', 'pereira', 'costa', 'almeida', 'ribeiro', 'carvalho', 'gomes', 'martins', 'rocha', 'barbosa', 'teixeira'])[n % 12 + 1]
      || n || '@example.com' AS email,
    CASE n % 6 WHEN 4 THEN 'planilha-preco' WHEN 5 THEN 'mentoria-cardapio' ELSE 'bolo-no-pote' END AS product,
    n % 3 = 0 OR n % 12 = 5 AS with_bump,
    CASE WHEN n <= 3 THEN 'pending' WHEN n % 13 = 0 THEN 'refunded' WHEN n % 10 = 7 THEN 'expired' ELSE 'paid' END AS status,
    now() - n * interval '15 hours' - (n * 37 % 60) * interval '1 minute' AS created_at
  FROM generate_series(1, 48) AS n
),
customers AS (
  INSERT INTO customer (id, email, created_at) SELECT customer_id, email, created_at FROM buyer RETURNING id
),
priced AS (
  SELECT buyer.*, product.price_cents AS product_amount, product.pix_key, product.pix_name, product.pix_city,
    CASE WHEN with_bump THEN product.bump_product END AS bump,
    CASE WHEN with_bump THEN product.bump_price_cents END AS bump_amount,
    ((product.price_cents + CASE WHEN with_bump THEN product.bump_price_cents ELSE 0 END) / 100)::text || '.'
      || lpad(((product.price_cents + CASE WHEN with_bump THEN product.bump_price_cents ELSE 0 END) % 100)::text, 2, '0') AS amount_text
  FROM buyer JOIN product ON product.slug = buyer.product
),
coded AS (
  SELECT priced.*,
    '000201'
      || '26' || lpad((22 + length(pix_key))::text, 2, '0') || '0014br.gov.bcb.pix01' || lpad(length(pix_key)::text, 2, '0') || pix_key
      || '52040000' || '5303986'
      || '54' || lpad(length(amount_text)::text, 2, '0') || amount_text
      || '5802BR'
      || '59' || lpad(length(pix_name)::text, 2, '0') || pix_name
      || '60' || lpad(length(pix_city)::text, 2, '0') || pix_city
      || '62240520' || id
      || '6304' AS body
  FROM priced
),
crc (id, body, step, value) AS (
  SELECT id, body, 0, 65535 FROM coded
  UNION ALL
  SELECT id, body, step + 1,
    CASE WHEN bit.mixed & 32768 <> 0 THEN ((bit.mixed << 1) # 4129) & 65535 ELSE (bit.mixed << 1) & 65535 END
  FROM crc, LATERAL (
    SELECT CASE WHEN step % 8 = 0 THEN value # (get_byte(convert_to(body, 'UTF8'), step / 8) << 8) ELSE value END AS mixed
  ) AS bit
  WHERE step < 8 * octet_length(body)
)
INSERT INTO orders (id, customer_id, product, bump, product_amount, bump_amount, name, phone, status, txid, pix_code,
  expires_at, recovery_step, recovery_at, visitor_id, ip, user_agent, terms_version, created_at)
SELECT coded.id, customer_id, product, bump, product_amount, bump_amount, name,
  CASE WHEN n % 4 <> 0 THEN '551190000' || lpad(n::text, 4, '0') END,
  status, coded.id, coded.body || upper(lpad(to_hex(crc.value), 4, '0')),
  created_at + interval '72 hours',
  CASE WHEN status = 'expired' THEN 3 WHEN status = 'paid' AND n % 8 = 1 THEN 1 ELSE 0 END,
  CASE WHEN status = 'pending' THEN created_at + interval '15 minutes' END,
  'demo-visitor-' || n, '203.0.113.' || n,
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  '2026-11', created_at
FROM coded JOIN crc ON crc.id = coded.id AND crc.step = 8 * octet_length(coded.body);
--> statement-breakpoint
-- Orders that got a recovery message (recovery_step 1) pay three hours later, after it, so the panel counts them as recovered.
INSERT INTO payment (order_id, amount, source, external_id, created_at)
SELECT id, amount, 'webhook', 'demo-seed:' || id,
  created_at + CASE WHEN recovery_step = 1 THEN interval '3 hours' ELSE (2 + right(id, 16)::integer * 7 % 50) * interval '1 minute' END
FROM orders WHERE status IN ('paid', 'refunded');
--> statement-breakpoint
INSERT INTO payment (order_id, amount, source, created_at)
SELECT id, -amount, 'admin', created_at + interval '2 days' FROM orders WHERE status = 'refunded';
--> statement-breakpoint
INSERT INTO message (channel, address, kind, order_id, customer_id, body, status, error, external_id, attempts, created_at, sent_at)
SELECT draft.channel, draft.address, draft.kind, sale.id, CASE WHEN draft.kind <> 'owner' THEN sale.customer_id END,
  draft.body, draft.status, draft.error, CASE WHEN draft.status <> 'failed' THEN 'demo' END,
  CASE WHEN draft.status = 'failed' THEN 5 ELSE 1 END, sale.paid_at,
  CASE WHEN draft.status <> 'failed' THEN sale.paid_at + interval '20 seconds' END
FROM (
  SELECT orders.id, orders.customer_id, orders.name, orders.phone, customer.email, payment.created_at AS paid_at,
    split_part(orders.name, ' ', 1) AS first_name,
    main.name || COALESCE(' + ' || extra.name, '') AS title,
    'R$ ' || orders.amount / 100 || ',' || lpad((orders.amount % 100)::text, 2, '0') AS price,
    right(orders.id, 16)::integer AS n
  FROM orders
  JOIN customer ON customer.id = orders.customer_id
  JOIN payment ON payment.order_id = orders.id AND payment.amount > 0
  JOIN product main ON main.slug = orders.product
  LEFT JOIN product extra ON extra.slug = orders.bump
) AS sale
CROSS JOIN LATERAL (VALUES
  ('email', sale.email, 'access',
    'Seu acesso ao ' || sale.title || ' está liberado' || E'\n\nOi ' || sale.first_name
      || E', o pagamento foi confirmado.\n\nEntre na área de membros por este link (vale 7 dias e funciona uma vez): {login_link}',
    'sent', NULL),
  ('whatsapp', sale.phone, 'paid',
    'Oi ' || sale.first_name || '! O pagamento do ' || sale.title || ' foi confirmado. O link de acesso foi enviado para o seu e-mail.',
    CASE WHEN sale.n % 9 = 2 THEN 'failed' ELSE 'read' END, CASE WHEN sale.n % 9 = 2 THEN 'WHATSAPP_DISCONNECTED' END),
  ('email', 'demo@librefunnel.com', 'owner',
    'Nova venda: ' || sale.title || ' (' || sale.price || E')\n\n' || sale.name || ' (' || sale.email || ') pagou o pedido ' || sale.id || '.',
    'sent', NULL)
) AS draft (channel, address, kind, body, status, error)
WHERE draft.address IS NOT NULL;
--> statement-breakpoint
INSERT INTO message (channel, address, kind, step, order_id, customer_id, body, status, error, external_id, attempts, created_at, sent_at)
SELECT step.channel, CASE step.channel WHEN 'email' THEN customer.email ELSE orders.phone END, 'recovery', step.position - 1,
  orders.id, orders.customer_id,
  replace(replace(replace(replace(replace(step.text,
    '{name}', split_part(orders.name, ' ', 1)),
    '{product}', product.name),
    '{amount}', 'R$ ' || orders.amount / 100 || ',' || lpad((orders.amount % 100)::text, 2, '0')),
    '{link}', 'https://demo.librefunnel.com/c/' || orders.product || '?order=' || orders.id),
    '{pix}', orders.pix_code)
    || CASE step.channel WHEN 'whatsapp' THEN E'\n\nResponda SAIR para não receber mais mensagens.' ELSE '' END,
  CASE WHEN failed THEN 'failed' ELSE 'sent' END, CASE WHEN failed THEN 'SMTP_UNREACHABLE' END,
  CASE WHEN failed THEN NULL ELSE 'demo' END, CASE WHEN failed THEN 5 ELSE 1 END,
  orders.created_at + step.after_minutes * interval '1 minute',
  CASE WHEN failed THEN NULL ELSE orders.created_at + step.after_minutes * interval '1 minute' + interval '5 seconds' END
FROM orders
JOIN customer ON customer.id = orders.customer_id
JOIN product ON product.slug = orders.product
JOIN (
  SELECT channel, text, after_minutes, row_number() OVER (ORDER BY after_minutes, id) AS position FROM recovery_step
) AS step ON step.position <= orders.recovery_step
CROSS JOIN LATERAL (SELECT orders.status = 'expired' AND step.channel = 'email' AND right(orders.id, 16)::integer > 40 AS failed) AS outcome
WHERE orders.status <> 'pending' AND (step.channel = 'email' OR orders.phone IS NOT NULL);
--> statement-breakpoint
INSERT INTO message (channel, address, kind, body, status, external_id, created_at, sent_at)
SELECT 'whatsapp', orders.phone, chat.kind, chat.body, chat.status, chat.external_id,
  orders.created_at + chat.minutes * interval '1 minute',
  CASE WHEN chat.kind = 'reply' THEN orders.created_at + chat.minutes * interval '1 minute' + interval '3 seconds' END
FROM (VALUES
  (1, 'inbound', 'Oi, quero o link', 'received', 'demo-seed-inbound-1', 30),
  (1, 'reply', 'Que bom! Aqui está o link: https://demo.librefunnel.com/v/bolo-no-pote', 'read', 'demo', 30),
  (5, 'inbound', 'Não achei o acesso no meu e-mail', 'received', 'demo-seed-inbound-5', 90),
  (5, 'reply', 'Seu acesso chega no e-mail da compra. Não achou? Peça um link novo em https://demo.librefunnel.com/m com o e-mail que você usou.', 'read', 'demo', 90),
  (6, 'inbound', 'Vocês emitem nota fiscal?', 'received', 'demo-seed-inbound-6', 200)
) AS chat (n, kind, body, status, external_id, minutes)
JOIN orders ON orders.id = 'demo' || lpad(chat.n::text, 16, '0')
ORDER BY chat.n DESC, chat.kind;
--> statement-breakpoint
INSERT INTO progress (customer_id, product, lesson, done_at)
SELECT orders.customer_id, orders.product, lessons.slug, LEAST(now(), orders.created_at + lessons.rank * interval '1 day')
FROM orders
JOIN (
  SELECT module.product, lesson.slug, row_number() OVER (PARTITION BY module.product ORDER BY module.position, lesson.position) AS rank
  FROM lesson JOIN module ON module.id = lesson.module_id
) AS lessons ON lessons.product = orders.product AND lessons.rank <= right(orders.id, 16)::integer % 6
WHERE orders.status = 'paid';
--> statement-breakpoint
-- Each buyer arrived 40 minutes before ordering; 600 more visitors over 30 days did not buy. Seven origins in rotation,
-- and the sales video events thin out the way a real audience does (k is the visitor's place in a 20-step ladder).
WITH visit AS (
  SELECT visitor_id, product, 0 AS k, right(id, 16)::integer AS slot, created_at - interval '40 minutes' AS seen_at FROM orders
  UNION ALL
  SELECT 'demo-visit-' || v, CASE v % 10 WHEN 8 THEN 'planilha-preco' WHEN 9 THEN 'mentoria-cardapio' ELSE 'bolo-no-pote' END,
    v % 20, v, now() - v * interval '72 minutes'
  FROM generate_series(1, 600) AS v
),
touches AS (
  INSERT INTO touch (visitor_id, source, medium, campaign, content, click_kind, click_id, referrer_host, landing, first_seen_at, last_seen_at)
  SELECT visit.visitor_id, origin.source, origin.medium, origin.campaign, origin.content, origin.click_kind,
    CASE WHEN origin.click_kind = '' THEN '' ELSE 'demo-' || visit.visitor_id END, origin.referrer_host,
    CASE visit.product WHEN 'bolo-no-pote' THEN '/v/bolo-no-pote' ELSE '/c/' || visit.product END,
    visit.seen_at, visit.seen_at + interval '35 minutes'
  FROM visit
  JOIN (VALUES
    (0, 'instagram', 'social', 'perfil', 'bio', '', ''),
    (1, 'facebook', 'cpc', 'bolo-no-pote', 'video-curto', 'fbclid', ''),
    (2, 'google', 'cpc', 'marca', '', 'gclid', ''),
    (3, '', '', '', '', '', ''),
    (4, 'instagram', 'social', 'stories', 'oferta', '', ''),
    (5, '', '', '', '', '', 'youtube.com'),
    (6, 'facebook', 'cpc', 'remarketing', 'carrossel', 'fbclid', '')
  ) AS origin (slot, source, medium, campaign, content, click_kind, referrer_host) ON origin.slot = visit.slot % 7
)
INSERT INTO event (visitor_id, product, name, value, created_at)
SELECT visit.visitor_id, visit.product, milestone.name,
  CASE milestone.name WHEN 'video_watch' THEN 24 - visit.k ELSE 0 END,
  visit.seen_at + interval '1 minute' + milestone.second * interval '1 second'
FROM visit
JOIN (VALUES
  ('page_view', 20, 0),
  ('video_play', 14, 5),
  ('video_25', 12, 11),
  ('cta_view', 11, 13),
  ('video_50', 10, 17),
  ('video_75', 8, 23),
  ('video_100', 6, 29),
  ('video_watch', 14, 30),
  ('cta_click', 3, 40)
) AS milestone (name, reach, second) ON visit.k < milestone.reach
WHERE visit.product = 'bolo-no-pote' OR milestone.name = 'page_view';
--> statement-breakpoint
-- An earlier Instagram visit for every third buyer, so first-touch and last-touch attribution differ.
INSERT INTO touch (visitor_id, source, medium, campaign, content, landing, first_seen_at, last_seen_at)
SELECT visitor_id, 'instagram', 'social', 'perfil', 'link-na-bio', '/', created_at - interval '2 days', created_at - interval '2 days'
FROM orders WHERE right(id, 16)::integer % 3 = 0;
--> statement-breakpoint
INSERT INTO retention (product, second, views)
SELECT 'bolo-no-pote', second, 372 - second * 8 - CASE WHEN second >= 9 THEN 30 ELSE 0 END
FROM generate_series(0, 24) AS second;
