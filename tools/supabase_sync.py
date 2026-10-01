"""Recopie js/pricing.js dans supabase/functions/_shared/pricing.js (le serveur calcule exactement comme le configurateur)."""
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = open(os.path.join(ROOT, 'js', 'pricing.js'), encoding='utf-8').read()
dst = os.path.join(ROOT, 'supabase', 'functions', '_shared', 'pricing.js')
open(dst, 'w', encoding='utf-8').write('// COPIE de js/pricing.js (même calcul que le configurateur). Ne pas modifier ici : lancer tools/supabase_sync.py.\n' + src)
print('ok', dst)
