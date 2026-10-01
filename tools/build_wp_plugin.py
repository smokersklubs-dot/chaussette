"""Construit le ZIP de l'extension WordPress « SKLUBS Configurateur » avec le configurateur 3D inclus.

L'extension sert alors le site statique depuis wp-content/plugins/sklubs-configurator/site/ :
pas besoin d'hébergement séparé (Vercel) ni de sous-domaine. La page « Configurateur 3D » est créée
à l'activation ; le code court [sklubs_configurateur] l'affiche ailleurs.
Usage : python3 tools/build_wp_plugin.py [sortie.zip]   (défaut : dist/sklubs-configurator.zip)
"""
import os, re, sys, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLUGIN = os.path.join(ROOT, 'integration', 'wordpress', 'sklubs-configurator')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'dist', 'sklubs-configurator.zip')

SITE = ['index.html', 'configurateur.html', 'home.css', 'styles.css', 'products/catalog.json',
        'bottle-master/export/SKLUBS_BOTTLE_WEB.glb']
SITE += ['js/' + f for f in sorted(os.listdir(os.path.join(ROOT, 'js'))) if f.endswith('.js')]
for pid in sorted(os.listdir(os.path.join(ROOT, 'products'))):
    d = os.path.join(ROOT, 'products', pid)
    if os.path.isdir(d):
        SITE += [f'products/{pid}/{f}' for f in sorted(os.listdir(d)) if f.endswith(('.json', '.webp', '.png', '.jpg'))]

def site_file(rel):
    data = open(os.path.join(ROOT, rel), 'rb').read()
    if rel.endswith('.html'):
        s = data.decode()
        # même domaine que WordPress : API relative ; liens d'accueil explicites (pas d'index de dossier)
        s = re.sub(r'<meta name="sklubs-api" content="[^"]*">', '<meta name="sklubs-api" content="/wp-json/sklubs/v1">', s)
        s = s.replace('href="./"', 'href="index.html"')
        data = s.encode()
    return data

os.makedirs(os.path.dirname(OUT), exist_ok=True)
with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
    for base, _, files in os.walk(PLUGIN):
        for f in sorted(files):
            full = os.path.join(base, f)
            z.write(full, os.path.join('sklubs-configurator', os.path.relpath(full, PLUGIN)))
    for rel in SITE:
        z.writestr(os.path.join('sklubs-configurator', 'site', rel), site_file(rel))
print('ok', OUT, f'{os.path.getsize(OUT) // 1024} Ko', len(SITE), 'fichiers du site')
