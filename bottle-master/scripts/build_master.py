"""SKLUBS — BOTTLE MASTER : reconstruction contrainte depuis la référence.

Toutes les cotes sont en unités de ratio : BODY_HEIGHT = 1.000
(fond de la bouteille -> bas de la bague métallique). Aucune cote usine.
Usage : python3 build_master.py <stage A|B|C|FULL> [--phi DEG] [--rf R] [--out DIR] [--save]
"""
import bpy, bmesh, json, math, sys, os, argparse
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# ---------------------------------------------------------------- paramètres
ZMAP_A = None
CAM = {'h': 1.0, 'd': 12.0}
HANDLE_ADJ = {'dz': 0.0, 'sx': 1.0}
SHOULDER_FIT = {}
def zm(z):
    """hauteur mesurée dans l'image -> hauteur 3D (point fixe : bas de la bague z = 1)"""
    return ZMAP_A * z + (1 - ZMAP_A)

def load_params():
    P = json.load(open(os.path.join(ROOT, 'data', 'params.json')))
    return P

def smooth(a, w=5):
    a = np.asarray(a, float)
    k = np.ones(w) / w
    pad = np.pad(a, (w // 2, w // 2), mode='edge')
    return np.convolve(pad, k, mode='valid')

def body_profile(P, rf):
    """profil (r, z) du corps + col, du centre du fond jusqu'à z = 1.0"""
    z = zm(np.array(P['body_profile']['z'])); r = np.array(P['body_profile']['r'])
    R = P['body_radius']; RN = P['neck_radius']
    ok = ~np.isnan(r)
    z, r = z[ok], r[ok]
    # épaulement : Bézier cubique ajustée aux moindres carrés sur le profil médian mesuré,
    # tangente verticale côté corps et côté col (pas de bruit pixel -> pas de stries)
    sh = (z > 0.70) & (z < 0.995)
    zs, rs = z[sh], r[sh]
    def bez(z0, z1, a, c, n=64):
        t = np.linspace(0, 1, n)[:, None]
        P0, P1, P2, P3 = np.array([R, z0]), np.array([R, z0 + a]), np.array([RN, z1 - c]), np.array([RN, z1])
        return ((1 - t) ** 3) * P0 + 3 * ((1 - t) ** 2) * t * P1 + 3 * (1 - t) * t * t * P2 + (t ** 3) * P3
    def cost(p):
        z0, z1, a, c = p
        if not (0.70 < z0 < z1 - 0.03 and z1 < 0.99 and 0 < a < z1 - z0 and 0 < c < z1 - z0): return 1e9
        cv = bez(z0, z1, a, c, 400)
        rr = np.interp(zs, cv[:, 1], cv[:, 0], left=R, right=RN)
        return float(np.mean((rr - rs) ** 2))
    best = (1e9, None)
    for z0 in np.arange(0.78, 0.88, 0.005):
        for z1 in np.arange(0.92, 0.975, 0.005):
            for a in np.arange(0.01, 0.16, 0.01):
                for c in np.arange(0.005, 0.08, 0.005):
                    v = cost((z0, z1, a, c))
                    if v < best[0]: best = (v, (z0, z1, a, c))
    z0b, z1b, ab, cb = best[1]
    SHOULDER_FIT.update(z0=float(z0b), z1=float(z1b), a=float(ab), c=float(cb), rms=float(np.sqrt(best[0])))
    curve = bez(z0b, z1b, ab, cb, 40)
    z_sh0 = float(z0b)
    pts = [(0.0, 0.0)]
    # fond plat puis congé de rayon rf
    for i in range(0, 13):
        a = -math.pi / 2 + (math.pi / 2) * i / 12
        pts.append((R - rf + rf * math.cos(a), rf + rf * math.sin(a)))
    # corps droit (quelques boucles pour les UV)
    for zz in np.linspace(rf + 0.02, z_sh0, 12):
        pts.append((R, float(zz)))
    for rr, zz in curve[1:]:
        pts.append((float(rr), float(zz)))
    for zz in np.linspace(z1b, 1.0, 4)[1:]:
        pts.append((RN, float(zz)))
    return pts, z_sh0

# ---------------------------------------------------------------- utilitaires mesh
def lathe(name, prof, seg=160, close_top=False, close_bottom=False, uv=None):
    """prof : liste (r, z). Seam UV à l'arrière (-Y), u = 0.5 à l'avant (+Y face caméra -Y ? cf. note)."""
    verts, faces = [], []
    n = len(prof)
    for (r, z) in prof:
        for j in range(seg):
            a = 2 * math.pi * j / seg
            verts.append((r * math.sin(a), -r * math.cos(a), z))  # j=0 -> face avant (-Y, vers la caméra)
    for i in range(n - 1):
        for j in range(seg):
            a = i * seg + j; b = i * seg + (j + 1) % seg
            faces.append((a, b, b + seg, a + seg))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    # UV cylindriques : u = 0.5 face avant, couture à l'arrière ; v = z (unités BODY_HEIGHT)
    uvl = me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        us = []
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index; j = vi % seg
            us.append(((j / seg) + 0.5) % 1.0)
        if max(us) - min(us) > 0.5: us = [u + 1.0 if u < 0.5 else u for u in us]
        for li, u in zip(poly.loop_indices, us):
            vi = me.loops[li].vertex_index
            uvl.data[li].uv = (u, prof[vi // seg][1])
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-7)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me)
    for p in me.polygons: p.use_smooth = True
    return ob

def link(ob, coll):
    coll.objects.link(ob)
    return ob

def coll(name, parent):
    c = bpy.data.collections.new(name); parent.children.link(c); return c

def mat_flat(name, rgb):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    e = nt.nodes.new('ShaderNodeEmission'); e.inputs['Color'].default_value = (*rgb, 1); e.inputs['Strength'].default_value = 1
    o = nt.nodes.new('ShaderNodeOutputMaterial'); nt.links.new(e.outputs[0], o.inputs[0])
    return m

# ---------------------------------------------------------------- pièces
def build_body(P, rf, C):
    prof, z_sh0 = body_profile(P, rf)
    # BODY jusqu'à z = 0.96 (col déjà droit), NECK de 0.96 à 1.0 : couture sur une zone verticale
    cut = 0.96
    body_prof = [p for p in prof if p[1] <= cut] + [(P['neck_radius'], cut)]
    neck_prof = [(P['neck_radius'], cut), (P['neck_radius'], 1.0), (P['neck_radius'] - 0.006, 1.0)]
    body = link(lathe('BODY', body_prof), C)
    neck = link(lathe('NECK', neck_prof), C)
    return body, neck, z_sh0

def build_ring(P, C):
    RN = P['ring'].get('r', P['neck_radius']); z0, z1 = P['ring']['z0'], zm(P['ring']['z1'])
    b = 0.0025
    prof = [(P['neck_radius'] - 0.006, z0), (RN - b, z0), (RN, z0 + b), (RN, z1 - b), (RN - b, z1), (P['neck_radius'] - 0.006, z1)]
    return link(lathe('METAL_RING', prof), C)

def build_cap(P, C):
    c = P['cap']; z0 = zm(P['ring']['z1']); top = zm(c['top'])
    rl, ru, f = c['r_lower'], c['r_upper'], c['top_fillet']
    zt0, zt1 = zm(c['taper_z0']), zm(c['taper_z1'])
    prof = [(P['neck_radius'] - 0.006, z0), (rl - 0.0045, z0), (rl, z0 + 0.0045), (rl, zt0), (ru, zt1), (ru, top - f)]
    for i in range(1, 9):
        a = (math.pi / 2) * i / 8
        prof.append((ru - f + f * math.cos(a), top - f + f * math.sin(a)))
    prof.append((0.0, top))
    return link(lathe('CAP', prof, seg=160), C)

def resample(poly, n):
    poly = np.asarray(poly, float)
    d = np.r_[0, np.cumsum(np.linalg.norm(np.diff(poly, axis=0), axis=1))]
    t = np.linspace(0, d[-1], n)
    return np.c_[np.interp(t, d, poly[:, 0]), np.interp(t, d, poly[:, 1])]

def handle_curves(P):
    h = P['handle']; sx = P['top_scale_x']
    zp = zm(P['hinge']['z'])
    outer = [(0.0, zm(h['apex_outer']))] + sorted([(x * sx, zm(z)) for z, x in h['outer'] if x > 0.02], key=lambda t: -t[1])
    inner = [(0.0, zm(h['apex_inner']))] + sorted([(x * sx, zm(z)) for z, x in h['inner'] if x > 0.03], key=lambda t: -t[1])
    xo, xi = h['arm_outer'] * sx, h['arm_inner'] * sx
    outer = [p for p in outer if p[1] > zm(h['arm_z']) + 0.004] + [(xo, zm(h['arm_z'])), (xo, zp)]
    inner = [p for p in inner if p[1] > zm(h['arm_z']) - 0.006] + [(xi, zm(h['arm_z']) - 0.01), (xi, zp)]
    dz, sa = HANDLE_ADJ['dz'], HANDLE_ADJ['sx']
    za = zm(h['arm_z'])
    adj = lambda p: (p[0] * sa if p[1] > za else p[0], p[1] + dz * min(1.0, max(0.0, (p[1] - zp) / (za - zp))) if p[1] <= za else p[1] + dz)
    outer = [adj(p) for p in outer]; inner = [adj(p) for p in inner]
    O = resample(outer, 90); I = resample(inner, 90)
    # lissage des arcs (quantification pixel), extrémités figées
    for A in (O, I):
        for k in (0, 1):
            s = smooth(A[:, k], 7); A[3:-12, k] = s[3:-12]
    return O, I

def build_handle(P, C):
    O, I = handle_curves(P)
    d2 = P['handle']['depth'] / 2
    zp = zm(P['hinge']['z'])
    secs = []  # (xo, zo, xi, zi, half_depth)
    for (xo, zo), (xi, zi) in zip(O, I):
        secs.append((xo, zo, xi, zi, d2))
    # extrémité arrondie de la sangle autour du pivot (demi-disque dans le plan YZ)
    xo, xi = O[-1][0], I[-1][0]
    for k in range(1, 13):
        a = (math.pi / 2) * k / 12
        secs.append((xo, zp - d2 * math.sin(a), xi, zp - d2 * math.sin(a), max(d2 * math.cos(a), 0.002)))
    full = [(-s[0], s[1], -s[2], s[3], s[4]) for s in reversed(secs[1:])] + secs  # gauche -> droite
    verts, faces = [], []
    for (xo, zo, xi, zi, hd) in full:
        verts += [(xo, -hd, zo), (xo, hd, zo), (xi, hd, zi), (xi, -hd, zi)]
    n = len(full)
    for k in range(n - 1):
        a = 4 * k; b = 4 * (k + 1)
        for q in range(4):
            faces.append((a + q, a + (q + 1) % 4, b + (q + 1) % 4, b + q))
    faces.append((0, 3, 2, 1)); faces.append((4 * (n - 1), 4 * (n - 1) + 1, 4 * (n - 1) + 2, 4 * (n - 1) + 3))
    me = bpy.data.meshes.new('HANDLE'); me.from_pydata(verts, [], faces); me.update()
    ob = link(bpy.data.objects.new('HANDLE', me), C)
    bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(me); bm.free()
    mod = ob.modifiers.new('bevel', 'BEVEL'); mod.width = 0.0035; mod.segments = 3; mod.limit_method = 'ANGLE'
    for p in me.polygons: p.use_smooth = True
    # pivot de l'anse au niveau des axes de charnière
    return ob

def build_hinges(P, C):
    h = P['hinge']; sx = P['top_scale_x']
    xo = P['handle']['arm_outer'] * sx
    out = []
    for side, name in ((1, 'HINGE_R'), (-1, 'HINGE_L')):
        me = bpy.data.meshes.new(name)
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=48, radius1=h['radius'], radius2=h['radius'], depth=h['outer_x'] * sx - xo + 0.004)
        bm.to_mesh(me); bm.free()
        ob = link(bpy.data.objects.new(name, me), C)
        ob.rotation_euler = (0, math.pi / 2, 0)
        ob.location = (side * ((h['outer_x'] * sx + xo - 0.004) / 2), 0, zm(h['z']))
        mod = ob.modifiers.new('bevel', 'BEVEL'); mod.width = 0.0015; mod.segments = 2
        for p in me.polygons: p.use_smooth = True
        out.append(ob)
    return out

# ---------------------------------------------------------------- scène
def setup_scene(P, stage, phi, rf):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    root = bpy.data.collections.new('SKLUBS_BOTTLE_MASTER'); s.collection.children.link(root)
    C = {k: coll(k, root) for k in ('00_REFERENCE', '01_GEOMETRY', '02_PRINT', '03_MATERIALS', '04_CAMERAS', '05_LIGHTING', '06_EXPORT')}
    G = C['01_GEOMETRY']
    objs = {}
    body, neck, z_sh0 = build_body(P, rf, G); objs.update(BODY=body, NECK=neck)
    if stage in ('B', 'C', 'FULL'):
        objs['METAL_RING'] = build_ring(P, G); objs['CAP'] = build_cap(P, G)
    if stage in ('C', 'FULL'):
        objs['HANDLE'] = build_handle(P, G)
        for hg in build_hinges(P, G): objs[hg.name] = hg
    # REF_CAMERA
    cam = bpy.data.objects.new('REF_CAMERA', bpy.data.cameras.new('REF_CAMERA'))
    C['00_REFERENCE'].objects.link(cam)
    # caméra à plan d'image vertical (pas de bascule), hauteur cam_h, distance cam_d ; décentrement pour cadrer
    D, hc = CAM['d'], CAM['h']
    cam.data.sensor_fit = 'VERTICAL'; cam.data.sensor_height = 24
    cam.data.lens = 24 * D / 1.75
    cam.location = (0.0, -D, hc)
    cam.rotation_euler = (math.pi / 2, 0, 0)
    cam.data.shift_y = (0.69 - hc) / 1.75
    s.camera = cam
    img_path = os.path.join(ROOT, 'reference', 'ref_panel.png')
    if os.path.exists(img_path):
        img = bpy.data.images.load(img_path); img.pack(); img.name = 'REF_IMAGE'
        cam.data.show_background_images = True
        bg = cam.data.background_images.new(); bg.image = img; bg.alpha = 0.5
    return s, objs, C, z_sh0

def silhouette_materials(objs):
    cols = {'BODY': (1, 0, 0), 'NECK': (1, 0, 0), 'METAL_RING': (0, 1, 0), 'CAP': (0, 0, 1), 'HANDLE': (1, 1, 0), 'HINGE_L': (1, 0, 1), 'HINGE_R': (1, 0, 1)}
    for n, ob in objs.items():
        m = mat_flat('SIL_' + n, cols[n]); ob.data.materials.clear(); ob.data.materials.append(m)

def render(s, path, res=(900, 1200), samples=16):
    s.render.engine = 'CYCLES'; s.cycles.device = 'CPU'; s.cycles.samples = samples
    s.cycles.use_denoising = False; s.render.film_transparent = True
    s.render.resolution_x, s.render.resolution_y = res; s.render.resolution_percentage = 100
    s.render.image_settings.file_format = 'PNG'; s.render.image_settings.color_mode = 'RGBA'
    s.view_settings.view_transform = 'Standard'
    s.render.filepath = path
    bpy.ops.render.render(write_still=True)

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('stage'); ap.add_argument('--phi', type=float, default=4.5); ap.add_argument('--rf', type=float, default=None)
    ap.add_argument('--out', default='/tmp/sil'); ap.add_argument('--tag', default='')
    ap.add_argument('--za', type=float, default=None); ap.add_argument('--ch', type=float, default=None); ap.add_argument('--cd', type=float, default=None); ap.add_argument('--hdz', type=float, default=None); ap.add_argument('--hsx', type=float, default=None)
    a = ap.parse_args()
    P = load_params()
    ZMAP_A = a.za if a.za is not None else P.get('zmap_a', 1.0)
    CAM['h'] = a.ch if a.ch is not None else P.get('camera', {}).get('h', 1.0)
    CAM['d'] = a.cd if a.cd is not None else P.get('camera', {}).get('d', 12.0)
    if a.rf is None: a.rf = P.get('body_bottom_fillet', 0.035)
    HANDLE_ADJ['dz'] = a.hdz if a.hdz is not None else P['handle'].get('adj_dz', 0.0)
    HANDLE_ADJ['sx'] = a.hsx if a.hsx is not None else P['handle'].get('adj_sx', 1.0)
    s, objs, C, z_sh0 = setup_scene(P, a.stage, a.phi, a.rf)
    silhouette_materials(objs)
    os.makedirs(a.out, exist_ok=True)
    render(s, os.path.join(a.out, f'sil_{a.stage}{a.tag}.png'))
    print('z_shoulder_start', round(z_sh0, 4), 'fit', SHOULDER_FIT)
