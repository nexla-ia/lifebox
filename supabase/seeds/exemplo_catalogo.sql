-- LifeBox · seed de EXEMPLO — apenas ambiente de dev/teste. NÃO rodar em produção.
--
-- Nada aqui é definitivo: a LifeBox cadastra e edita tudo pela tela de Catálogo.
-- Serve só para desenvolver com tela cheia.
--   · planos e preços: valores iniciais do LIFEBOX_PROJECT.md §5.1–§5.4
--   · pratos: menu REAL da W37, extraído da planilha (aba PICK-UP, "MENU EXTRA")
--   · ZIPs: amostra das cidades que aparecem na W37 — a lista oficial ainda
--     não veio da LifeBox (ver DECISOES-ABERTAS.md)

-- =============================================================== ZIP codes
insert into zip_codes (zip, city, route_id) values
  ('02151','Revere',      (select id from routes where name='Boston')),
  ('02472','Watertown',   (select id from routes where name='Boston')),
  ('02139','Cambridge',   (select id from routes where name='Boston')),
  ('02143','Somerville',  (select id from routes where name='Boston')),
  ('02148','Malden',      (select id from routes where name='Boston')),
  ('02149','Everett',     (select id from routes where name='Boston')),
  ('01960','Peabody',     (select id from routes where name='Boston')),
  ('01915','Beverly',     (select id from routes where name='Boston')),
  ('01801','Woburn',      (select id from routes where name='Boston')),
  ('01821','Billerica',   (select id from routes where name='Boston')),
  ('01852','Lowell',      (select id from routes where name='Boston')),
  ('01702','Framingham',  (select id from routes where name='Marlborough')),
  ('01752','Marlborough', (select id from routes where name='Marlborough')),
  ('01581','Westborough', (select id from routes where name='Marlborough')),
  ('01532','Northborough',(select id from routes where name='Marlborough')),
  ('01608','Worcester',   (select id from routes where name='Marlborough')),
  ('01757','Milford',     (select id from routes where name='Marlborough')),
  ('02053','Medway',      (select id from routes where name='Marlborough')),
  ('01721','Ashland',     (select id from routes where name='South Shore')),
  ('02339','Hanover',     (select id from routes where name='South Shore')),
  ('02370','Rockland',    (select id from routes where name='South Shore')),
  ('02188','Weymouth',    (select id from routes where name='South Shore')),
  ('02382','Whitman',     (select id from routes where name='South Shore'));

-- ================================================================= planos
insert into plans (name_pt, name_en, meals_qty, breakfasts_qty, position) values
  ('5 Refeições',                 '5 Meals',                   5,  0, 1),
  ('10 Refeições',                '10 Meals',                 10,  0, 2),
  ('5 Refeições + 5 Breakfasts',  '5 Meals + 5 Breakfasts',    5,  5, 3),
  ('10 Refeições + 5 Breakfasts', '10 Meals + 5 Breakfasts',  10,  5, 4);

-- preço BASE pré-tax, service $1.75 já embutido (§5.1)
insert into plan_prices (plan_id, size_id, base_price_cents)
select p.id, s.id, v.cents
from (values
  ('5 Meals',                  'S',  5600),
  ('5 Meals',                  'L',  6505),
  ('10 Meals',                 'S', 10745),
  ('10 Meals',                 'L', 12585),
  ('5 Meals + 5 Breakfasts',   'S',  7750),
  ('5 Meals + 5 Breakfasts',   'L',  9635),
  ('10 Meals + 5 Breakfasts',  'S', 12860),
  ('10 Meals + 5 Breakfasts',  'L', 15715)
) as v(plan, size, cents)
join plans p on p.name_en = v.plan
join sizes s on s.code    = v.size;

-- extras §5.2. Refeição: faixa 5 vs faixa 10. Breakfast Large está em
-- conflito no material ($6.26 no .md, $5.15 na tela 5a) — usei o .md.
insert into extra_prices (plan_id, size_id, item_kind, unit_price_cents)
select p.id, s.id, v.kind::extra_kind, v.cents
from (values
  ('5 Meals',                 'S', 'meal',      1120),
  ('5 Meals',                 'L', 'meal',      1301),
  ('5 Meals + 5 Breakfasts',  'S', 'meal',      1120),
  ('5 Meals + 5 Breakfasts',  'L', 'meal',      1301),
  ('10 Meals',                'S', 'meal',      1075),
  ('10 Meals',                'L', 'meal',      1259),
  ('10 Meals + 5 Breakfasts', 'S', 'meal',      1075),
  ('10 Meals + 5 Breakfasts', 'L', 'meal',      1259),
  ('5 Meals',                 'S', 'breakfast',  430),
  ('5 Meals',                 'L', 'breakfast',  626),
  ('5 Meals + 5 Breakfasts',  'S', 'breakfast',  430),
  ('5 Meals + 5 Breakfasts',  'L', 'breakfast',  626),
  ('10 Meals',                'S', 'breakfast',  423),
  ('10 Meals',                'L', 'breakfast',  626),
  ('10 Meals + 5 Breakfasts', 'S', 'breakfast',  423),
  ('10 Meals + 5 Breakfasts', 'L', 'breakfast',  626)
) as v(plan, size, kind, cents)
join plans p on p.name_en = v.plan
join sizes s on s.code    = v.size;

-- Personalizado §5.3 — unitário por tamanho (valores da tela 6c)
insert into custom_unit_prices (size_id, unit_price_cents)
select s.id, v.cents
from (values ('S', 930), ('L', 1150)) as v(size, cents)
join sizes s on s.code = v.size;

-- ============================================================= adicionais
-- Todos sem tax e sem delivery (§5.4).
insert into addons (name_pt, name_en, desc_pt, desc_en, category, price_cents,
                    charges_tax, charges_delivery, requires_plan,
                    includes_meals_qty, position) values
  ('5 Sucos',       '5 Juices',       'Pacote de 5 sucos prensados a frio', 'Pack of 5 cold-pressed juices',
   'juice',  2990, false, false, true,  0, 1),
  ('Detox 1 Dia',   '1-Day Detox',    '6 sucos',  '6 juices',
   'detox',  5990, false, false, false, 0, 2),
  ('Health Booster','Health Booster', '10 sucos', '10 juices',
   'detox',  8990, false, false, false, 0, 3),
  ('Detox 3 Dias',  '3-Day Detox',    '18 sucos', '18 juices',
   'detox', 12624, false, false, false, 0, 4),
  ('Detox 5 Dias',  '5-Day Detox',    '20 sucos + 10 sopas', '20 juices + 10 soups',
   'detox', 17974, false, false, false, 0, 5),
  -- §5.4 ⚠️ resolvido pela W37 real: as 5 refeições são escolhidas do menu da
  -- semana e entram na folha da cozinha (South Shore, pedido 2).
  ('Super Detox',   'Super Detox',    '20 sucos + 5 sopas + 5 refeições', '20 juices + 5 soups + 5 meals',
   'detox', 20174, false, false, false, 5, 6);

-- variações = composição do kit, não item com preço (tela 11e)
insert into addon_variants (addon_id, name_pt, name_en, position)
select a.id, v.pt, v.en, v.pos
from (values
  ('5 Juices',    'Green #1','Green #1',1), ('5 Juices',   'Green #3','Green #3',2),
  ('5 Juices',    'Red',     'Red',     3), ('5 Juices',   'Orange',  'Orange',  4),
  ('1-Day Detox', 'Green #1','Green #1',1), ('1-Day Detox','Green #3','Green #3',2),
  ('1-Day Detox', 'Red',     'Red',     3), ('1-Day Detox','Orange',  'Orange',  4),
  ('3-Day Detox', 'Green #1','Green #1',1), ('3-Day Detox','Green #3','Green #3',2),
  ('3-Day Detox', 'Red',     'Red',     3), ('3-Day Detox','Orange',  'Orange',  4),
  ('5-Day Detox', 'Green #1','Green #1',1), ('5-Day Detox','Green #3','Green #3',2),
  ('5-Day Detox', 'Red',     'Red',     3), ('5-Day Detox','Orange',  'Orange',  4),
  ('5-Day Detox', 'Sopa de beterraba','Beet soup',      5),
  ('5-Day Detox', 'Sopa de abóbora',  'Butternut soup', 6),
  ('5-Day Detox', 'Sopa de espinafre','Spinach soup',   7),
  ('Super Detox', 'Green #1','Green #1',1), ('Super Detox','Green #3','Green #3',2),
  ('Super Detox', 'Red',     'Red',     3), ('Super Detox','Orange',  'Orange',  4),
  ('Super Detox', 'Sopa de beterraba','Beet soup',      5),
  ('Super Detox', 'Sopa de abóbora',  'Butternut soup', 6),
  ('Super Detox', 'Sopa de espinafre','Spinach soup',   7)
) as v(addon, pt, en, pos)
join addons a on a.name_en = v.addon;

-- ==================================================== formas de pagamento
insert into payment_methods (name_pt, name_en, instructions_pt, instructions_en,
                             recipient_keys, position) values
  ('Zelle', 'Zelle',
   'Envie por Zelle para pagamentos@exemplo.com',
   'Send via Zelle to pagamentos@exemplo.com',
   array['pagamentos@exemplo.com'], 1),
  ('Cartão','Card', 'Pague pelo link', 'Pay with the link', '{}', 2),
  ('Venmo', 'Venmo', '@exemplo', '@exemplo', array['@exemplo'], 3);

-- ================================================= pratos · menu real W37
-- Categoria 'classico' = aba Clássico do cardápio; 'brasileiro' = linha
-- "arroz & feijão". Nutrição não existe na planilha: fica nula até a LifeBox
-- preencher pela tela 5e.
insert into dishes (name_pt, name_en, category, protein_tag) values
  ('Chicken pesto and pasta bowl (frango, espinafre, tomate cereja, rotini, parmesão, pesto)',
   'Chicken Pesto Pasta Bowl', 'classico', 'frango'),
  ('Salmão assado ao pesto cremoso e mix de vegetais',
   'Baked Salmon in Creamy Pesto with Veggies', 'classico', 'seafood'),
  ('Chicken broccoli alfredo',
   'Chicken Broccoli Alfredo', 'classico', 'frango'),
  ('Beef fajitas com arroz branco e green beans',
   'Beef Fajitas with White Rice & Green Beans', 'classico', 'carne'),
  ('Frango assado com creme de espinafre, arroz branco e mix de vegetais',
   'Roasted Chicken in Spinach Cream with Rice & Veggies', 'classico', 'frango'),
  ('Moqueca com arroz branco e green beans',
   'Moqueca with White Rice & Green Beans', 'classico', 'seafood'),
  ('Estrogonofe de frango com arroz integral e broccoli',
   'Chicken Stroganoff with Brown Rice & Broccoli', 'classico', 'frango'),
  ('Carne de boi desfiada com purê de batata doce e espinafre',
   'Shredded Beef with Sweet Potato Mash & Spinach', 'classico', 'carne'),
  ('Ground turkey ao molho branco com espinafre e penne',
   'Ground Turkey in White Sauce with Spinach & Penne', 'classico', 'peru'),
  ('Feijoada saudável com arroz integral, couve, vinagrete e laranja',
   'Healthy Feijoada with Brown Rice, Collards & Orange', 'classico', 'porco'),
  ('Frango assado com creme de espinafre, arroz & feijão e mix de vegetais (abobrinha e cenoura)',
   'Roasted Chicken, Rice & Beans with Zucchini and Carrot', 'brasileiro', 'frango'),
  ('Tilápia assada com molho de limão, arroz & feijão e brócolis',
   'Baked Tilapia in Lemon Sauce, Rice & Beans with Broccoli', 'brasileiro', 'seafood'),
  ('Turkey moído, arroz & feijão e Kale',
   'Ground Turkey, Rice & Beans with Kale', 'brasileiro', 'peru'),
  ('Porco desfiado, arroz & feijão e espinafre refogado',
   'Pulled Pork, Rice & Beans with Sautéed Spinach', 'brasileiro', 'porco'),
  ('Frango em cubos grelhado, arroz & feijão e mix de vegetais (cenoura e green beans)',
   'Grilled Diced Chicken, Rice & Beans with Carrot and Green Beans', 'brasileiro', 'frango'),
  ('Panquecas de banana com frutas e mel',
   'Banana Pancakes with Fruit & Honey', 'breakfast', 'vegetariano'),
  ('Torta de frango com aveia',
   'Chicken & Oat Pie', 'breakfast', 'frango'),
  ('Bolo de laranja',
   'Orange Cake', 'breakfast', 'vegetariano'),
  ('Quesadillas de frango com queijo e espinafre',
   'Chicken Quesadillas with Cheese & Spinach', 'breakfast', 'frango'),
  ('Sanduíche de tuna salad',
   'Tuna Salad Sandwich', 'breakfast', 'seafood');

-- tags que vinham no nome do prato na planilha ("GF*", "GF/LF*")
insert into dish_tag_links (dish_id, tag_id)
select d.id, t.id from dishes d, dish_tags t
 where (d.name_en = 'Chicken Stroganoff with Brown Rice & Broccoli' and t.code = 'GF')
    or (d.name_en = 'Healthy Feijoada with Brown Rice, Collards & Orange' and t.code in ('GF','LF'))
    or (d.name_en = 'Banana Pancakes with Fruit & Honey' and t.code in ('GF','LF'));

-- todo prato disponível nos dois tamanhos ativos
insert into dish_sizes (dish_id, size_id)
select d.id, s.id from dishes d, sizes s where s.active;

-- a W37 rodou o Menu 2 do ciclo
insert into menu_dishes (menu_id, dish_id)
select (select id from menus where cycle_position = 2), d.id from dishes d;
