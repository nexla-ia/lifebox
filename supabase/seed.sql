-- LifeBox · seed BASE — vai para produção.
-- Só o que é estrutural ou configuração operacional. Catálogo (pratos, planos,
-- preços, adicionais, ZIPs, formas de pagamento) nasce VAZIO: quem cadastra é
-- a LifeBox (§1). Para desenvolver com tela cheia, use seeds/exemplo_catalogo.sql.

-- ------------------------------------------------------------------ settings
insert into settings (key, value, description) values
  ('tax_rate',                '0.07',            'Taxa sobre itens tributáveis (§5.6)'),
  ('delivery_fee_cents',      '1000',            'Delivery por pedido, 1x (§5.6)'),
  ('service_fee_cents',       '175',             'Service já embutido no preço do plano — informativo (§5.1)'),
  ('cutoff_weekday',          '4',               'Dia do cutoff, ISO 1=seg..7=dom (§4)'),
  ('cutoff_time',             '"18:00"',         'Hora do cutoff no fuso operacional (§4)'),
  ('timezone',                '"America/New_York"', 'Fuso de toda regra de semana e cutoff (§2)'),
  ('follow_up_weeks',         '3',               'Semanas que um lead segue em follow-up (§6.3)'),
  ('pickup_charges_delivery', 'false',           'Pick-up cobra delivery? (§6.6, em aberto)'),
  ('custom_charges_tax',      'true',            'Personalizado é tributável (§5.3)'),
  ('custom_charges_delivery', 'true',            'Personalizado cobra delivery (§5.3)'),
  ('bag_stock_total',         '0',               'Estoque total de bags térmicas (§6.7)'),
  ('bag_default_qty',         '1',               'Bags por pedido, editável por pedido (§6.7, em aberto)'),
  ('bag_collect_after_weeks', '3',               'Semanas em posse que jogam na lista de coleta (§6.7)'),
  ('delivery_window',         '{"start":"12:30","end":"20:00"}', 'Janela de entrega de domingo (§4)'),
  ('pickup_window',           '{"start":"10:00","end":"13:00"}', 'Janela de retirada de domingo (tela 11f)'),
  ('receipt_auto_confirm',    'false',           'Modo sombra ligado: o sistema decide, a equipe confirma (§9.3)'),
  ('receipt_confidence_min',  '0.90',            'Confiança mínima da extração para confirmar (§9.3)'),
  ('menu_cycle_length',       '4',               'Menus em rotação automática (§4)');

-- ------------------------------------------------------------------- sizes
-- Medium cadastrado e INATIVO: aparece em pedidos antigos (W37 real,
-- Marlborough pedido 18, "10 MEALS MEDIUM") mas não consta nas regras oficiais (§5.1).
insert into sizes (code, name, position, active) values
  ('S', 'Small',  1, true),
  ('M', 'Medium', 2, false),
  ('L', 'Large',  3, true);

-- ------------------------------------------------------------------ routes
-- As rotas não são estritamente geográficas: Ashland é atendida pela
-- South Shore (§6.1, confirmado na planilha real da W37).
insert into routes (name, position) values
  ('Boston',      1),
  ('Marlborough', 2),
  ('South Shore', 3);

-- ----------------------------------------------------------------- sources
insert into sources (name, kind) values
  ('Ads',           'channel'),
  ('Campanhas',     'channel'),
  ('Indicações',    'channel'),
  ('Cliente Antigo','channel'),
  ('Instagram',     'channel'),
  ('Facebook',      'channel'),
  ('Site',          'channel'),
  ('Others',        'channel');

-- -------------------------------------------------------------- dish_tags
-- §5.5 fala em GF e LF; o protótipo (tela 5e) mostra também High Protein,
-- Low Carb, Best Seller e Vegetariano. A tela tem "＋ Nova tag", então a
-- LifeBox adiciona outras sem migration.
insert into dish_tags (code, label_pt, label_en, icon, position) values
  ('GF',           'Sem glúten',     'Gluten-Free',  '🌾', 1),
  ('LF',           'Sem lactose',    'Lactose-Free', '🥛', 2),
  ('HIGH_PROTEIN', 'Rico em proteína','High Protein','💪', 3),
  ('LOW_CARB',     'Low carb',       'Low Carb',     '🥬', 4),
  ('VEGETARIAN',   'Vegetariano',    'Vegetarian',   '🌱', 5),
  ('BEST_SELLER',  'Mais pedido',    'Best Seller',  '🔥', 6);

-- -------------------------------------------------------------- allergens
insert into allergens (code, label_pt, label_en, icon) values
  ('DAIRY',   'Leite',          'Dairy',    '🥛'),
  ('EGGS',    'Ovos',           'Eggs',     '🥚'),
  ('SESAME',  'Gergelim',       'Sesame',   '🌰'),
  ('GLUTEN',  'Glúten',         'Gluten',   '🌾'),
  ('SEAFOOD', 'Frutos do mar',  'Seafood',  '🦐'),
  ('NUTS',    'Castanhas',      'Tree Nuts','🌰'),
  ('SOY',     'Soja',           'Soy',      '🫘');

-- ------------------------------------------------------------------- menus
-- Ciclo de 4 em rotação automática (§4). Os pratos de cada um são cadastrados
-- pela LifeBox na tela Catálogo > Menus do ciclo.
insert into menus (name, cycle_position) values
  ('Menu 1', 1), ('Menu 2', 2), ('Menu 3', 3), ('Menu 4', 4);

-- --------------------------------------------------------- message_templates
-- Mensagem de confirmação do WhatsApp (§9.2, tela 6p). Vai no seed BASE porque
-- sem template a automação não tem o que enviar — e o texto é editável na tela
-- de Configurações, como todo o resto.
--
-- As variáveis entre chaves são substituídas pelo n8n na hora do envio. Nada
-- de valor monetário aqui: {total} vem do pedido, {instrucoes_pagamento} e
-- {link_pagamento} vêm da forma de pagamento cadastrada.
insert into message_templates (key, language, body) values
  ('order_confirmation', 'pt',
'Olá, {nome}!

✅ Recebemos seu pedido {numero_pedido} da {semana}.

📦 {plano} · {tamanho}
🍽️ {lista_pratos}
➕ {adicionais}

💵 {total} · {forma_pagamento} · {status_pagamento}

🔑 Como pagar
{instrucoes_pagamento}
{link_pagamento}

📸 Depois de pagar, envie o comprovante aqui nesta conversa.

🚚 {data_entrega}

Qualquer ajuste, responda aqui. 💚'),
  ('order_confirmation', 'en',
'Hi, {nome}!

✅ We received your order {numero_pedido} for {semana}.

📦 {plano} · {tamanho}
🍽️ {lista_pratos}
➕ {adicionais}

💵 {total} · {forma_pagamento} · {status_pagamento}

🔑 How to pay
{instrucoes_pagamento}
{link_pagamento}

📸 Once you pay, send the receipt here in this chat.

🚚 {data_entrega}

Any changes, just reply here. 💚')
on conflict (key, language) do nothing;
