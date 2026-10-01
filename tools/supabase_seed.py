"""Génère supabase/seed.sql à partir des fichiers du dépôt (products/catalog.json, products/<id>/product.json).
Aucun prix inventé : les valeurs vides restent vides (« sur devis »). À relancer après modification des fichiers.
Usage : python3 tools/supabase_seed.py
"""
import json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
q = lambda s: "'" + str(s).replace("'", "''") + "'"
cat = json.load(open(os.path.join(ROOT, 'products', 'catalog.json'), encoding='utf-8'))
out = ['-- Généré par tools/supabase_seed.py : catégories et produits du dépôt (sans écraser les produits déjà en base).', 'begin;']
for i, c in enumerate(cat['categories']):
    out.append(f"insert into public.categories (id, label, description, sort) values ({q(c['id'])}, {q(c['label'])}, {q(c.get('desc', ''))}, {i + 1}) on conflict (id) do nothing;")
for m in cat['models']:
    p = json.load(open(os.path.join(ROOT, 'products', m['id'], 'product.json'), encoding='utf-8'))
    p.setdefault('card', {})
    status = 'publish' if m.get('status') == 'available' else 'draft'
    out.append(f"select public.upsert_product({q(p['id'])}, {q(status)}, {q(json.dumps(p, ensure_ascii=False))}::jsonb)"
               f" where not exists (select 1 from public.products where id = {q(p['id'])});")
out.append('commit;')
open(os.path.join(ROOT, 'supabase', 'seed.sql'), 'w', encoding='utf-8').write('\n'.join(out) + '\n')
print('ok supabase/seed.sql', len(cat['models']), 'produit(s)')
