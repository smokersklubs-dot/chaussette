-- SKLUBS Configurateur : base de données (Supabase / Postgres)
-- Produits (fiche complète), prix (paliers + suppléments, tables séparées éditables), catégories,
-- projets clients (devis, commandes, projets enregistrés), administrateurs.
-- Lecture publique : catalogue et produits en ligne (RPC catalog / product).
-- Écriture : administrateurs (Supabase Auth + table admins) ; projets via la fonction Edge « submit ».

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tables
create table if not exists public.categories (
  id          text primary key check (id ~ '^[a-z0-9-]{2,40}$'),
  label       text not null,
  description text not null default '',
  sort        int  not null default 0
);

create table if not exists public.products (
  id                 text primary key check (id ~ '^[a-z0-9-]{2,60}$'),
  status             text not null default 'draft' check (status in ('draft', 'publish')),
  sort               int  not null default 0,
  data               jsonb not null,                       -- fiche produit hors prix (format products/<id>/product.json)
  currency           text not null default 'EUR',
  price_mode         text not null default 'instant' check (price_mode in ('instant', 'estimated')),
  tax_label          text not null default '' check (tax_label in ('', 'HT', 'TTC')),
  moq                int  check (moq is null or moq > 0),  -- vide = premier palier
  lead_time          text,                                 -- ex. « 15 jours ouvrés »
  quantity_discounts jsonb,                                -- ancien format [{min, discount}]
  updated_at         timestamptz not null default now()
);

-- Paliers de prix : à partir de min_qty pièces, prix unitaire de base (vide = sur devis)
create table if not exists public.price_tiers (
  id          bigint generated always as identity primary key,
  product_id  text not null references public.products(id) on delete cascade,
  variant_id  text not null,
  min_qty     int  not null check (min_qty > 0),
  unit_price  numeric(12, 4) check (unit_price is null or unit_price >= 0),
  popular     boolean not null default false,
  unique (product_id, variant_id, min_qty)
);

-- Suppléments par unité et frais fixes (vide = sur devis, 0 = gratuit)
--   material | finish | ring | method (prix marquage / u) | setup (frais de calage) | custom_color | base (prix de base, ancien format) | extra_zone
create table if not exists public.price_options (
  product_id  text not null references public.products(id) on delete cascade,
  kind        text not null check (kind in ('material', 'finish', 'ring', 'method', 'setup', 'custom_color', 'base', 'extra_zone')),
  option_id   text not null default '',
  amount      numeric(12, 4) check (amount is null or amount >= 0),
  primary key (product_id, kind, option_id)
);

create table if not exists public.projects (
  id           uuid primary key default gen_random_uuid(),
  reference    text not null unique,
  intent       text not null default 'quote' check (intent in ('quote', 'order', 'save')),
  status       text not null default 'new' check (status in ('new', 'in_progress', 'quoted', 'ordered', 'done', 'cancelled')),
  product_id   text references public.products(id) on delete set null,
  quantity     int,
  price_server jsonb,          -- prix recalculé côté serveur
  project      jsonb not null, -- configuration complète (sans les images)
  files        jsonb not null default '{}'::jsonb, -- chemins dans le bucket « projects »
  wc_order_id  bigint,
  created_at   timestamptz not null default now()
);
create index if not exists projects_created_idx on public.projects (created_at desc);

create table if not exists public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ---------------------------------------------------------------- sécurité (RLS)
alter table public.categories    enable row level security;
alter table public.products      enable row level security;
alter table public.price_tiers   enable row level security;
alter table public.price_options enable row level security;
alter table public.projects      enable row level security;
alter table public.admins        enable row level security;

drop policy if exists categories_read on public.categories;
create policy categories_read on public.categories for select using (true);
drop policy if exists categories_admin on public.categories;
create policy categories_admin on public.categories for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists products_read on public.products;
create policy products_read on public.products for select using (status = 'publish' or public.is_admin());
drop policy if exists products_admin on public.products;
create policy products_admin on public.products for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists tiers_read on public.price_tiers;
create policy tiers_read on public.price_tiers for select using (
  public.is_admin() or exists (select 1 from public.products p where p.id = product_id and p.status = 'publish'));
drop policy if exists tiers_admin on public.price_tiers;
create policy tiers_admin on public.price_tiers for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists options_read on public.price_options;
create policy options_read on public.price_options for select using (
  public.is_admin() or exists (select 1 from public.products p where p.id = product_id and p.status = 'publish'));
drop policy if exists options_admin on public.price_options;
create policy options_admin on public.price_options for all using (public.is_admin()) with check (public.is_admin());

-- projets : écrits par la fonction Edge (clé service), lus et suivis par les administrateurs
drop policy if exists projects_admin on public.projects;
create policy projects_admin on public.projects for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists admins_self on public.admins;
create policy admins_self on public.admins for select using (user_id = auth.uid());

-- retire les clés nulles du premier niveau seulement (les options à prix vide restent visibles)
create or replace function public.jsonb_strip_top_nulls(j jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from jsonb_each(j) where value <> 'null'::jsonb;
$$;

-- ---------------------------------------------------------------- fiche produit complète (format du configurateur)
create or replace function public.product_json(p public.products) returns jsonb
language sql stable set search_path = public as $$
  with sizes as (
    select coalesce(jsonb_agg(s->>'id'), '[]'::jsonb) ids from jsonb_array_elements(coalesce(p.data->'sizes', '[]'::jsonb)) s
  ),
  tiers as (
    select coalesce(jsonb_object_agg(v.id, coalesce((
      select jsonb_agg(jsonb_build_object('min', t.min_qty, 'unit', t.unit_price::float8, 'popular', t.popular) order by t.min_qty)
      from public.price_tiers t where t.product_id = p.id and t.variant_id = v.id), '[]'::jsonb)), '{}'::jsonb) obj
    from (select jsonb_array_elements_text(ids) id from sizes) v
  ),
  opts as (
    select kind, jsonb_object_agg(option_id, amount::float8) obj from public.price_options where product_id = p.id group by kind
  )
  select (p.data - 'pricing' - 'production')
    || jsonb_build_object('id', p.id, 'status', p.status)
    || jsonb_build_object('quantity', coalesce(p.data->'quantity', '{}'::jsonb) || jsonb_build_object('moq', p.moq))
    || jsonb_build_object('production', jsonb_build_object('leadTime', p.lead_time))
    || jsonb_build_object('pricing', public.jsonb_strip_top_nulls(jsonb_build_object(
         'currency', p.currency, 'priceMode', p.price_mode, 'taxLabel', p.tax_label,
         'tiers', (select obj from tiers),
         'materialSurcharge', (select obj from opts where kind = 'material'),
         'finishSurcharge',   (select obj from opts where kind = 'finish'),
         'ringSurcharge',     (select obj from opts where kind = 'ring'),
         'methodUnitPrice',   (select obj from opts where kind = 'method'),
         'setupFee',          (select obj from opts where kind = 'setup'),
         'basePriceBySize',   (select obj from opts where kind = 'base'),
         'quantityDiscounts', p.quantity_discounts))
       || coalesce((select jsonb_build_object('customColorSurcharge', obj->'') from opts where kind = 'custom_color'), '{}'::jsonb)
       || coalesce((select jsonb_build_object('extraZoneUnitPrice', obj->'') from opts where kind = 'extra_zone'), '{}'::jsonb));
$$;

-- Lecture publique (clé anon) -------------------------------------------------
create or replace function public.product(p_id text) returns jsonb
language sql stable set search_path = public as $$
  select public.product_json(p) from public.products p where p.id = p_id; -- RLS : en ligne seulement (sauf admin)
$$;

create or replace function public.catalog() returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'label', c.label, 'desc', c.description) order by c.sort, c.label) from public.categories c), '[]'::jsonb),
    'models', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'category', coalesce(p.data->>'category', ''), 'name', coalesce(p.data->>'name', p.id),
        'subtitle', coalesce(p.data#>>'{card,subtitle}', ''), 'capacity', coalesce(p.data#>>'{card,capacity}', ''),
        'material', coalesce(p.data#>>'{card,material}', ''), 'thumbnail', coalesce(p.data#>>'{card,thumbnail}', ''),
        'tags', coalesce(p.data#>'{card,tags}', '[]'::jsonb), 'order', p.sort, 'status', 'available')
      order by p.sort, p.data->>'name') from public.products p where p.status = 'publish'), '[]'::jsonb));
$$;

-- Administration ---------------------------------------------------------------
create or replace function public.admin_products() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Accès réservé aux administrateurs' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', coalesce(data->>'name', id), 'category', coalesce(data->>'category', ''),
    'status', status, 'variants', jsonb_array_length(coalesce(data->'sizes', '[]'::jsonb)), 'modified', updated_at) order by sort, data->>'name')
    from public.products), '[]'::jsonb);
end $$;

create or replace function public.admin_product(p_id text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r public.products;
begin
  if not public.is_admin() then raise exception 'Accès réservé aux administrateurs' using errcode = '42501'; end if;
  select * into r from public.products where id = p_id;
  if not found then raise exception 'Produit introuvable' using errcode = 'P0002'; end if;
  return jsonb_build_object('status', r.status, 'product', public.product_json(r));
end $$;

-- Enregistre une fiche complète (même format que le configurateur) : les prix vont dans price_tiers / price_options.
-- upsert_product : usage interne (amorçage, clé service) ; save_product : administrateurs.
create or replace function public.upsert_product(p_id text, p_status text, p_product jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  pr jsonb := coalesce(p_product->'pricing', '{}'::jsonb);
  k text; m text; tbl text; obj jsonb; v jsonb; rows jsonb; t jsonb;
  map constant jsonb := '{"materialSurcharge":"material","finishSurcharge":"finish","ringSurcharge":"ring","methodUnitPrice":"method","setupFee":"setup","basePriceBySize":"base"}';
  num numeric;
begin
  if p_id !~ '^[a-z0-9-]{2,60}$' then raise exception 'Identifiant invalide : lettres minuscules, chiffres et tirets.'; end if;
  if coalesce(p_product->>'name', '') = '' then raise exception 'Le nom est obligatoire.'; end if;
  if jsonb_typeof(p_product->'sizes') is distinct from 'array' or jsonb_array_length(p_product->'sizes') = 0 then raise exception 'Il faut au moins une variante.'; end if;
  if jsonb_typeof(p_product->'materials') is distinct from 'array' or jsonb_array_length(p_product->'materials') = 0 then raise exception 'Il faut au moins une matière.'; end if;

  insert into public.products as x (id, status, sort, data, currency, price_mode, tax_label, moq, lead_time, quantity_discounts, updated_at)
  values (p_id, case when p_status = 'publish' then 'publish' else 'draft' end,
          coalesce((p_product#>>'{card,order}')::int, 0),
          (p_product - 'pricing' - 'production' - 'status') || jsonb_build_object('id', p_id, 'quantity', coalesce(p_product->'quantity', '{}'::jsonb) - 'moq'),
          coalesce(nullif(pr->>'currency', ''), 'EUR'),
          case when pr->>'priceMode' = 'estimated' then 'estimated' else 'instant' end,
          case when pr->>'taxLabel' in ('HT', 'TTC') then pr->>'taxLabel' else '' end,
          case when (p_product#>>'{quantity,moq}') ~ '^[0-9]+$' and (p_product#>>'{quantity,moq}')::int > 0 then (p_product#>>'{quantity,moq}')::int end,
          nullif(p_product#>>'{production,leadTime}', ''),
          case when jsonb_typeof(pr->'quantityDiscounts') = 'array' then pr->'quantityDiscounts' end,
          now())
  on conflict (id) do update set status = excluded.status, sort = excluded.sort, data = excluded.data, currency = excluded.currency,
    price_mode = excluded.price_mode, tax_label = excluded.tax_label, moq = excluded.moq, lead_time = excluded.lead_time,
    quantity_discounts = excluded.quantity_discounts, updated_at = now();

  delete from public.price_tiers where product_id = p_id;
  for k, rows in select * from jsonb_each(coalesce(pr->'tiers', '{}'::jsonb)) loop
    if jsonb_typeof(rows) <> 'array' then continue; end if;
    for t in select * from jsonb_array_elements(rows) loop
      if (t->>'min') !~ '^[0-9]+$' or (t->>'min')::int <= 0 then continue; end if;
      insert into public.price_tiers (product_id, variant_id, min_qty, unit_price, popular)
      values (p_id, k, (t->>'min')::int,
              case when jsonb_typeof(t->'unit') = 'number' then (t->>'unit')::numeric
                   when (t->>'unit') ~ '^[0-9]+([.,][0-9]+)?$' then replace(t->>'unit', ',', '.')::numeric end,
              coalesce((t->>'popular')::boolean, false))
      on conflict (product_id, variant_id, min_qty) do update set unit_price = excluded.unit_price, popular = excluded.popular;
    end loop;
  end loop;

  delete from public.price_options where product_id = p_id;
  for k, tbl in select key, value #>> '{}' from jsonb_each(map) loop
    obj := pr->k;
    if jsonb_typeof(obj) <> 'object' then continue; end if;
    for m, v in select * from jsonb_each(obj) loop
      num := case when jsonb_typeof(v) = 'number' then (v #>> '{}')::numeric end;
      insert into public.price_options (product_id, kind, option_id, amount) values (p_id, tbl, m, num);
    end loop;
  end loop;
  if pr ? 'customColorSurcharge' then
    insert into public.price_options values (p_id, 'custom_color', '', case when jsonb_typeof(pr->'customColorSurcharge') = 'number' then (pr->>'customColorSurcharge')::numeric end);
  end if;
  if pr ? 'extraZoneUnitPrice' then
    insert into public.price_options values (p_id, 'extra_zone', '', case when jsonb_typeof(pr->'extraZoneUnitPrice') = 'number' then (pr->>'extraZoneUnitPrice')::numeric end);
  end if;
end $$;

create or replace function public.save_product(p_id text, p_status text, p_product jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Accès réservé aux administrateurs' using errcode = '42501'; end if;
  perform public.upsert_product(p_id, p_status, p_product);
  return public.admin_product(p_id);
end $$;

create or replace function public.delete_product(p_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Accès réservé aux administrateurs' using errcode = '42501'; end if;
  delete from public.products where id = p_id;
end $$;

create or replace function public.save_categories(p_categories jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; i int := 0;
begin
  if not public.is_admin() then raise exception 'Accès réservé aux administrateurs' using errcode = '42501'; end if;
  delete from public.categories where id not in (select x->>'id' from jsonb_array_elements(p_categories) x);
  for c in select * from jsonb_array_elements(p_categories) loop
    i := i + 1;
    insert into public.categories (id, label, description, sort) values (c->>'id', coalesce(nullif(c->>'label', ''), c->>'id'), coalesce(c->>'desc', ''), i)
    on conflict (id) do update set label = excluded.label, description = excluded.description, sort = excluded.sort;
  end loop;
  return (public.catalog())->'categories';
end $$;

-- Droits d'exécution
revoke all on function public.upsert_product(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.save_product(text, text, jsonb), public.delete_product(text), public.save_categories(jsonb), public.admin_product(text), public.admin_products() from public, anon;
grant execute on function public.catalog(), public.product(text), public.product_json(public.products) to anon, authenticated;
grant execute on function public.save_product(text, text, jsonb), public.delete_product(text), public.save_categories(jsonb), public.admin_product(text), public.admin_products(), public.is_admin() to authenticated;
grant select on public.categories, public.products, public.price_tiers, public.price_options to anon, authenticated;
grant insert, update, delete on public.categories, public.products, public.price_tiers, public.price_options, public.projects to authenticated;
grant select on public.projects, public.admins to authenticated;

-- ---------------------------------------------------------------- fichiers des projets (aperçus, visuels, logos)
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public) values ('projects', 'projects', false) on conflict (id) do nothing;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'sklubs_projects_admin_read') then
      create policy sklubs_projects_admin_read on storage.objects for select using (bucket_id = 'projects' and public.is_admin());
    end if;
  end if;
end $$;
