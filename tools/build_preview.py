"""Construit la version « page d'aperçu » du configurateur (hébergement Artifact claude.ai).

Contraintes de cet hébergement : pas de .glb servi, pas de requête vers une URI data:, pas de
téléchargement, et la page peut être affichée sans ses fichiers voisins. On produit donc une page
autonome : index.html avec CSS, JS, fiche produit et master GLB (base64) intégrés
(window.SKLUBS_INLINE). Le produit en JSON et le .b64.txt sont aussi écrits à côté, en secours.
Usage : python3 tools/build_preview.py <dossier_sortie>
"""
import base64, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1]
os.makedirs(os.path.join(OUT, 'products', 'cricket-bottle'), exist_ok=True)
os.makedirs(os.path.join(OUT, 'model'), exist_ok=True)

glb = open(os.path.join(ROOT, 'bottle-master', 'export', 'SKLUBS_BOTTLE_MASTER.glb'), 'rb').read()
open(os.path.join(OUT, 'model', 'SKLUBS_BOTTLE_MASTER.glb.b64.txt'), 'w').write(base64.b64encode(glb).decode())
p = json.load(open(os.path.join(ROOT, 'products', 'cricket-bottle', 'product.json')))
p['master']['model'] = 'model/SKLUBS_BOTTLE_MASTER.glb.b64.txt'
json.dump(p, open(os.path.join(OUT, 'products', 'cricket-bottle', 'product.json'), 'w'), ensure_ascii=False, indent=1)
inline = {'products/cricket-bottle/product.json': json.dumps(p, ensure_ascii=False),
          'model/SKLUBS_BOTTLE_MASTER.glb.b64.txt': base64.b64encode(glb).decode()}

# JS : un seul module en ligne (imports relatifs retirés, exports déclassés)
js = ''
for f in ('pricing.js', 'artwork.js', 'viewer.js', 'data.js', 'main.js'):
    s = open(os.path.join(ROOT, 'js', f)).read()
    s = re.sub(r"^import [^;]*from '\./[^']+';\n", '', s, flags=re.M)
    s = re.sub(r'^export ', '', s, flags=re.M)
    js += f'\n// ---- {f}\n' + s
# les imports « three » restent, regroupés en tête
imports = sorted(set(re.findall(r"^import [^;]*from 'three[^']*';$", js, flags=re.M)))
js = re.sub(r"^import [^;]*from 'three[^']*';\n", '', js, flags=re.M)
js = '\n'.join(imports) + '\n' + js

h = open(os.path.join(ROOT, 'configurateur.html')).read(); css = open(os.path.join(ROOT, 'styles.css')).read()
css = css.replace('height: 100dvh; }', 'height: 100%; }')
head = re.search(r'<head>(.*)</head>', h, re.S).group(1); body = re.search(r'<body>(.*)</body>', h, re.S).group(1)
head = re.sub(r'\s*<meta[^>]*>', '', head)
head = re.sub(r'\s*<link rel="(modulepreload|preload)"[^>]*>', '', head)
head = head.replace('<title>SKLUBS — Configurateur Bouteille 3D</title>', '<title>Configurateur Bouteille SKLUBS</title>')
head = head.replace('<link rel="stylesheet" href="styles.css">', '<style>\n' + css + '\n</style>')
body = body.replace('<script type="module" src="js/main.js"></script>',
                    '<script>window.SKLUBS_PREVIEW = true;\nwindow.SKLUBS_INLINE = ' + json.dumps(inline, ensure_ascii=False).replace('</', '<\\/') + ';</script>\n  <script type="module">\n' + js.replace('</script', '<\\/script') + '\n  </script>')
open(os.path.join(OUT, 'index.html'), 'w').write(head.strip() + '\n' + body.strip() + '\n')
print('ok', OUT)
