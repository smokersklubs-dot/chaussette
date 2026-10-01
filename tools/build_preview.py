"""Construit la « page d'aperçu » (hébergement Artifact claude.ai) : accueil + configurateur dans une seule page.

Contraintes de cet hébergement : pas de .glb servi, pas de requête vers une URI data:, pas de
téléchargement, et la page peut être affichée sans ses fichiers voisins. On produit donc une page
autonome : index.html avec CSS, JS, catalogue, fiche produit, vignette et master GLB (base64) intégrés
(window.SKLUBS_INLINE). L'accueil s'affiche d'abord ; « Configurer » ouvre le configurateur dans la même
page (paramètres passés par window.SKLUBS_PREVIEW_PARAMS), « SKLUBS » revient à l'accueil.
Le produit en JSON et le .b64.txt sont aussi écrits à côté, en secours.
Usage : python3 tools/build_preview.py <dossier_sortie>
"""
import base64, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = sys.argv[1]
PID = 'cricket-bottle'
os.makedirs(os.path.join(OUT, 'products', PID), exist_ok=True)
os.makedirs(os.path.join(OUT, 'model'), exist_ok=True)
read = lambda *p: open(os.path.join(ROOT, *p), encoding='utf-8').read()

glb = open(os.path.join(ROOT, 'bottle-master', 'export', 'SKLUBS_BOTTLE_MASTER.glb'), 'rb').read()
glb64 = base64.b64encode(glb).decode()
open(os.path.join(OUT, 'model', 'SKLUBS_BOTTLE_MASTER.glb.b64.txt'), 'w').write(glb64)
p = json.loads(read('products', PID, 'product.json'))
p['master']['model'] = 'model/SKLUBS_BOTTLE_MASTER.glb.b64.txt'
json.dump(p, open(os.path.join(OUT, 'products', PID, 'product.json'), 'w'), ensure_ascii=False, indent=1)

# catalogue : vignettes intégrées (data: autorisé pour les images)
cat = json.loads(read('products', 'catalog.json'))
for m in cat['models']:
    t = m.get('thumbnail')
    if t and os.path.exists(os.path.join(ROOT, t)):
        m['thumbnail'] = 'data:image/webp;base64,' + base64.b64encode(open(os.path.join(ROOT, t), 'rb').read()).decode()
inline = {f'products/{PID}/product.json': json.dumps(p, ensure_ascii=False),
          'products/catalog.json': json.dumps(cat, ensure_ascii=False),
          'model/SKLUBS_BOTTLE_MASTER.glb.b64.txt': glb64}

# JS : un seul module en ligne (imports relatifs retirés, exports déclassés).
# main.js et home.js sont enfermés dans un bloc (noms locaux identiques) ; le configurateur démarre à la demande.
def module(f):
    s = read('js', f)
    s = re.sub(r"^import [^;]*from '\./[^']+';\n", '', s, flags=re.M)
    s = re.sub(r'^export ', '', s, flags=re.M)
    if f == 'main.js':
        assert 'init().catch((err) => {' in s
        s = s.replace('init().catch((err) => {', 'window.__sklubsStart = () => init().catch((err) => {', 1)
    if f in ('main.js', 'home.js'):
        s = '{\n' + s + '\n}'
    return f'\n// ---- {f}\n' + s
js = ''.join(module(f) for f in ('pricing.js', 'artwork.js', 'glb.js', 'viewer.js', 'data.js', 'hero3d.js', 'main.js', 'home.js'))
imports = sorted(set(re.findall(r"^import [^;]*from 'three[^']*';$", js, flags=re.M)))
js = re.sub(r"^import [^;]*from 'three[^']*';\n", '', js, flags=re.M)
# un même nom importé depuis plusieurs fichiers : une seule déclaration
names, merged = {}, []
for line in imports:
    m = re.match(r"import \{ ([^}]*) \} from '([^']+)';", line)
    if m:
        names.setdefault(m.group(2), set()).update(x.strip() for x in m.group(1).split(','))
    else:
        merged.append(line)
merged += [f"import {{ {', '.join(sorted(v))} }} from '{k}';" for k, v in sorted(names.items())]
js = '\n'.join(merged) + '\n' + js

# navigation accueil <-> configurateur dans la même page
router = r"""
const pv = (on) => { document.documentElement.classList.toggle('pv-cfg', on); document.getElementById('pv-home').hidden = on; document.getElementById('pv-cfg').hidden = !on; };
let started = false;
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href]');
  if (!a) return;
  const href = a.getAttribute('href');
  if (href.startsWith('configurateur.html')) {
    e.preventDefault();
    window.SKLUBS_PREVIEW_PARAMS = href.includes('?') ? href.slice(href.indexOf('?')) : '';
    pv(true); scrollTo(0, 0);
    if (!started) { started = true; window.__sklubsStart(); } else window.SKLUBS_APPLY_URL_COLORS?.();
  } else if (href === './' && document.documentElement.classList.contains('pv-cfg')) {
    e.preventDefault(); pv(false); scrollTo(0, 0);
  }
}, true);
"""

ih, ch = read('index.html'), read('configurateur.html')
home_body = re.search(r'<body[^>]*>(.*)</body>', ih, re.S).group(1)
cfg_body = re.search(r'<body[^>]*>(.*)</body>', ch, re.S).group(1)
home_body = re.sub(r'\s*<script type="module" src="js/home.js"></script>', '', home_body)
cfg_body = re.sub(r'\s*<script type="module" src="js/main.js"></script>', '', cfg_body)
fonts = re.search(r'<link href="https://fonts.googleapis.com[^>]*>', ih).group(0)
importmap = re.search(r'<script type="importmap">.*?</script>', ih, re.S).group(0)
css = read('styles.css').replace('height: 100dvh; }', 'height: 100%; }') + '\n' + read('home.css') + """
/* page d'aperçu : l'accueil défile, le configurateur occupe l'écran */
html:not(.pv-cfg), html:not(.pv-cfg) body { height: auto; overflow: auto; }
html:not(.pv-cfg) body { background: #F6F6F4; }
#pv-cfg { height: 100%; }
"""
inline_js = json.dumps(inline, ensure_ascii=False).replace('</', '<\\/')
module_js = js.replace('</script', '<\\/script')
page = f"""<title>SKLUBS — Custom drinkware</title>
{fonts}
<style>
{css}
</style>
{importmap}
<div id="pv-home">{home_body}</div>
<div id="pv-cfg" hidden>{cfg_body}</div>
<script>window.SKLUBS_PREVIEW = true;
window.SKLUBS_INLINE = {inline_js};</script>
<script>{router}</script>
<script type="module">
{module_js}
</script>
"""
open(os.path.join(OUT, 'index.html'), 'w').write(page)
print('ok', OUT)
