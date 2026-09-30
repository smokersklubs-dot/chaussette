"""Production du SKLUBS_BOTTLE_MASTER à partir de la géométrie validée (étapes A/B/C).
Matériaux, variantes couleur, UV, zones d'impression, pivot d'anse, caméras, éclairage, exports, rendus."""
import bpy, bmesh, json, math, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_master as B

ROOT = B.ROOT
OUT = os.path.join(ROOT, 'export'); REN = os.path.join(ROOT, 'renders'); os.makedirs(OUT, exist_ok=True); os.makedirs(REN, exist_ok=True)
FAST = '--fast' in sys.argv
ENV = float(next((a.split('=')[1] for a in sys.argv if a.startswith('--env=')), 0.11))
KEYP = float(next((a.split('=')[1] for a in sys.argv if a.startswith('--key=')), 115))

P = B.load_params()
B.ZMAP_A = P.get('zmap_a', 1.0)
B.CAM.update(h=P['camera']['h'], d=P['camera']['d'])
B.HANDLE_ADJ.update(dz=P['handle'].get('adj_dz', 0), sx=P['handle'].get('adj_sx', 1))
rf = P['body_bottom_fillet']
s, objs, C, z_sh0 = B.setup_scene(P, 'FULL', 0, rf)
G = C['01_GEOMETRY']

def hex2lin(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c)

# ------------------------------------------------ topologie / shading
for ob in objs.values():
    me = ob.data
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bm.to_mesh(me); bm.free()
    try: me.set_sharpness_by_angle(angle=math.radians(40))
    except Exception: pass
    for p in me.polygons: p.use_smooth = True

# ------------------------------------------------ pivot de l'anse (origine sur l'axe des charnières)
zp = B.zm(P['hinge']['z'])
H = objs['HANDLE']
H.data.transform(__import__('mathutils').Matrix.Translation((0, 0, -zp)))
H.location = (0, 0, zp)
H.rotation_mode = 'XYZ'
act = bpy.data.actions.new('HANDLE_UP_DOWN')
H.animation_data_create(); H.animation_data.action = act
for f, ang in ((1, 0.0), (24, -90.0)):  # rotation négative autour de X : l'anse bascule vers l'arrière (+Y Blender)
    H.rotation_euler = (math.radians(ang), 0, 0); H.keyframe_insert('rotation_euler', index=0, frame=f)
H.rotation_euler = (0, 0, 0)
s.frame_set(1)
H['pivot_note'] = 'HANDLE_UP = frame 1 (0°) ; HANDLE_DOWN = frame 24 (90° vers l arrière). Butées réelles : REFERENCE_REQUIRED'

# ------------------------------------------------ matériaux
def principled(name, base, metallic=0.0, rough=0.5, coat=0.0, spec=0.5):
    m = bpy.data.materials.new(name); m.use_nodes = True
    bs = m.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value = (*base, 1)
    bs.inputs['Metallic'].default_value = metallic
    bs.inputs['Roughness'].default_value = rough
    if 'Coat Weight' in bs.inputs: bs.inputs['Coat Weight'].default_value = coat
    if 'Specular IOR Level' in bs.inputs: bs.inputs['Specular IOR Level'].default_value = spec
    return m
colors = {k: v for k, v in P['colors'].items() if not k.startswith('_')}
BODY_MAT = principled('BODY_MAT_MASTER', hex2lin(colors['BLUE']), 0.0, 0.42, 0.0)
BODY_MAT['note'] = 'Base Color = variable. Metallic : peinture poudre supposée non métallique (matériau réel TO_DEFINE_FACTORY). Roughness calée visuellement (satiné).'
RING_MAT = principled('METAL_RING_MAT', (0.91, 0.91, 0.90), 1.0, 0.1)
CAP_MAT = principled('CAP_BLACK_MASTER', (0.012, 0.012, 0.012), 0.0, 0.38)
HINGE_MAT = principled('HINGE_MAT', (0.02, 0.02, 0.02), 0.0, 0.3)
assign = {'BODY': BODY_MAT, 'NECK': BODY_MAT, 'METAL_RING': RING_MAT, 'CAP': CAP_MAT, 'HANDLE': CAP_MAT, 'HINGE_L': HINGE_MAT, 'HINGE_R': HINGE_MAT}
for n, ob in objs.items():
    ob.data.materials.clear(); ob.data.materials.append(assign[n])
variant_mats = {}
for k, hx in colors.items():
    vm = BODY_MAT.copy(); vm.name = f'BODY_{k}'
    vm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*hex2lin(hx), 1)
    variant_mats[k] = vm
    C['03_MATERIALS'].objects  # (les matériaux ne sont pas des objets ; la collection sert de repère)

# ------------------------------------------------ zones d'impression (patchs non rendus, silhouette inchangée)
R = P['body_radius']
z0p, z1p = rf + 0.035, z_sh0 - 0.02
def patch(name, a_center, a_width):
    seg = 96; nz = 24; off = 0.0008
    verts, faces, uvs = [], [], []
    for i in range(nz + 1):
        z = z0p + (z1p - z0p) * i / nz
        for j in range(seg + 1):
            a = a_center - a_width / 2 + a_width * j / seg
            verts.append(((R + off) * math.sin(a), -(R + off) * math.cos(a), z))
    for i in range(nz):
        for j in range(seg):
            q = i * (seg + 1) + j; faces.append((q, q + 1, q + seg + 2, q + seg + 1))
    me = bpy.data.meshes.new(name); me.from_pydata(verts, [], faces); me.update()
    uvl = me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index; i, j = divmod(vi, seg + 1)
            uvl.data[li].uv = (j / seg, i / nz)
    ob = bpy.data.objects.new(name, me); C['02_PRINT'].objects.link(ob)
    ob.hide_render = True; ob.display_type = 'WIRE'
    m = bpy.data.materials.get('PRINT_ZONE_MAT') or principled('PRINT_ZONE_MAT', (1, 0.42, 0), 0, 0.5)
    m.blend_method = 'BLEND' if hasattr(m, 'blend_method') else None
    me.materials.append(m)
    ob['zone'] = dict(z_min=round(z0p, 4), z_max=round(z1p, 4), angle_center_deg=round(math.degrees(a_center), 1), angle_width_deg=round(math.degrees(a_width), 1),
                      note='Proposition géométrique (partie droite du corps, hors congé et épaulement). Dimensions imprimables réelles : TO_DEFINE_FACTORY')
    return ob
PZ = {'PRINT_FRONT': patch('PRINT_FRONT', 0.0, math.radians(120)), 'PRINT_BACK': patch('PRINT_BACK', math.pi, math.radians(120)),
      'PRINT_WRAP_360': patch('PRINT_WRAP_360', math.pi, 2 * math.pi)}

# ------------------------------------------------ éclairage studio + sol
W = bpy.data.worlds.new('STUDIO'); s.world = W; W.use_nodes = True
nt = W.node_tree; bgn = nt.nodes['Background']; out = nt.nodes['World Output']
# fond blanc vu par la caméra, ambiance plus sombre pour l'éclairage (garde les noirs et la saturation)
bg_cam = nt.nodes.new('ShaderNodeBackground'); bg_cam.inputs['Color'].default_value = (0.708, 0.651, 0.624, 1); bg_cam.inputs['Strength'].default_value = 1.0
bgn.inputs['Color'].default_value = (0.9, 0.9, 0.9, 1); bgn.inputs['Strength'].default_value = ENV
lp = nt.nodes.new('ShaderNodeLightPath'); mix = nt.nodes.new('ShaderNodeMixShader')
nt.links.new(lp.outputs['Is Camera Ray'], mix.inputs[0]); nt.links.new(bgn.outputs[0], mix.inputs[1]); nt.links.new(bg_cam.outputs[0], mix.inputs[2])
nt.links.new(mix.outputs[0], out.inputs['Surface'])
def area(name, loc, rot, size, power, col=(1, 1, 1)):
    l = bpy.data.lights.new(name, 'AREA'); l.size = size; l.energy = power; l.color = col
    o = bpy.data.objects.new(name, l); C['05_LIGHTING'].objects.link(o); o.location = loc; o.rotation_euler = rot; return o
area('KEY', (-2.2, -2.6, 2.2), (math.radians(55), 0, math.radians(-40)), 2.2, KEYP)
area('FILL', (2.6, -2.2, 1.2), (math.radians(70), 0, math.radians(50)), 3.0, KEYP * 0.35, (0.96, 0.98, 1.0))
area('RIM', (0.4, 2.6, 2.4), (math.radians(-55), 0, math.radians(170)), 1.5, KEYP * 0.8)
bpy.ops.mesh.primitive_plane_add(size=20, location=(0, 0, 0)); floor = bpy.context.active_object; floor.name = 'FLOOR'
for c in floor.users_collection: c.objects.unlink(floor)
C['05_LIGHTING'].objects.link(floor); floor.is_shadow_catcher = True

# ------------------------------------------------ caméras
def cam(name, loc, target, lens=85):
    cd = bpy.data.cameras.new(name); cd.lens = lens
    o = bpy.data.objects.new(name, cd); C['04_CAMERAS'].objects.link(o); o.location = loc
    d = __import__('mathutils').Vector(target) - o.location
    o.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler(); return o
T = (0, 0, 0.69); Dd = 5.2
CAMS = {
  'CAM_FRONT': cam('CAM_FRONT', (0, -Dd, 0.75), T), 'CAM_BACK': cam('CAM_BACK', (0, Dd, 0.75), T),
  'CAM_LEFT': cam('CAM_LEFT', (-Dd, 0, 0.75), T), 'CAM_RIGHT': cam('CAM_RIGHT', (Dd, 0, 0.75), T),
  'CAM_TOP': cam('CAM_TOP', (0, -0.01, 4.6), (0, 0, 1.0), 70),
  'CAM_3Q_LEFT': cam('CAM_3Q_LEFT', (-Dd * 0.68, -Dd * 0.74, 1.35), T), 'CAM_3Q_RIGHT': cam('CAM_3Q_RIGHT', (Dd * 0.68, -Dd * 0.74, 1.35), T),
  'CAM_DETAIL_CAP': cam('CAM_DETAIL_CAP', (-0.75, -1.45, 1.42), (0, 0, 1.12), 85), 'CAM_DETAIL_HANDLE': cam('CAM_DETAIL_HANDLE', (1.1, -1.1, 1.55), (0.12, 0, 1.27), 85),
}
refcam = bpy.data.objects['REF_CAMERA']
refcam.users_collection[0].objects.unlink(refcam); C['04_CAMERAS'].objects.link(refcam)
refcam.name = 'CAM_REFERENCE'
C['00_REFERENCE'].objects.link(refcam)  # aussi rangée dans 00_REFERENCE (REF_CAMERA)

# ------------------------------------------------ variantes : instances liées (même mesh, matériau par objet)
lineup = bpy.data.collections.new('COLOR_VARIANTS_TEST'); C['06_EXPORT'].children.link(lineup)
order = ['BLACK', 'YELLOW', 'BLUE', 'ORANGE', 'OLIVE', 'PINK']
for i, k in enumerate(order):
    for n, ob in objs.items():
        inst = ob.copy()  # données partagées (linked duplicate)
        inst.name = f'{k}_{n}'; inst.location = (ob.location.x + (i - 2.5) * 0.47, ob.location.y, ob.location.z)
        if inst.animation_data: inst.animation_data_clear()
        if n in ('BODY', 'NECK'):
            inst.material_slots[0].link = 'OBJECT'; inst.material_slots[0].material = variant_mats[k]
        lineup.objects.link(inst)
lineup.hide_render = True; lineup.hide_viewport = True
json.dump({'variants': colors, 'mode': 'instances liées : un seul mesh BODY, matériau surchargé par objet'}, open(os.path.join(OUT, 'color_variants.json'), 'w'), indent=1)

# ------------------------------------------------ rendus
def rset(res=(1200, 1600), samples=64):
    s.render.engine = 'CYCLES'; s.cycles.device = 'CPU'; s.cycles.samples = 24 if FAST else samples
    s.cycles.use_denoising = True
    s.render.film_transparent = False; s.render.resolution_x, s.render.resolution_y = res
    s.view_settings.view_transform = 'Standard'; s.view_settings.look = 'None'; s.view_settings.exposure = 0.0
def shoot(camname, fname, res=(1200, 1600), frame=1):
    s.camera = bpy.data.objects[camname]; s.frame_set(frame); rset(res)
    s.render.filepath = os.path.join(REN, fname); bpy.ops.render.render(write_still=True)

ONLY = next((a.split('=')[1] for a in sys.argv if a.startswith('--only=')), None)
if ONLY == 'handle_down':
    shoot('CAM_3Q_RIGHT', 'handle_down.png', frame=24)
if '--test' in sys.argv:
    shoot('CAM_REFERENCE', 'test_ref.png', res=(450, 600)); shoot('CAM_DETAIL_CAP', 'test_cap.png', res=(450, 600)); sys.exit(0)
if '--render' in sys.argv:
    for c, f in (('CAM_FRONT', 'front.png'), ('CAM_BACK', 'back.png'), ('CAM_LEFT', 'left.png'), ('CAM_RIGHT', 'right.png'), ('CAM_TOP', 'top.png'),
                 ('CAM_3Q_LEFT', '3q_left.png'), ('CAM_3Q_RIGHT', '3q_right.png'), ('CAM_DETAIL_CAP', 'cap_macro.png'), ('CAM_DETAIL_HANDLE', 'handle_macro.png')):
        shoot(c, f)
    shoot('CAM_3Q_RIGHT', 'handle_down.png', frame=24)
    # rendu caméra de référence, même cadrage que la photo
    shoot('CAM_REFERENCE', 'reference_camera.png', res=(900, 1200))
    # alignement six couleurs
    lineup.hide_render = False
    for ob in objs.values(): ob.hide_render = True
    lc = cam('CAM_LINEUP', (0, -9.5, 0.85), (0, 0, 0.68), 60); s.camera = lc; rset((1800, 1000)); s.render.filepath = os.path.join(REN, 'color_variants.png'); bpy.ops.render.render(write_still=True)
    lineup.hide_render = True
    for ob in objs.values(): ob.hide_render = False

# ------------------------------------------------ sauvegarde + exports
s.camera = bpy.data.objects['CAM_REFERENCE']; s.frame_set(1)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'SKLUBS_BOTTLE_MASTER.blend'), compress=True)
def export(path, web=False):
    bpy.ops.object.select_all(action='DESELECT')
    for ob in list(objs.values()) + list(PZ.values()): ob.select_set(True)
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
              export_animations=True, export_extras=True, export_cameras=False, export_lights=False)
    if web:
        kw.update(export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=6)
    try: bpy.ops.export_scene.gltf(**kw)
    except TypeError as e:
        print('export option ignorée :', e); kw.pop('export_draco_mesh_compression_enable', None); kw.pop('export_draco_mesh_compression_level', None); bpy.ops.export_scene.gltf(**kw)
for ob in PZ.values(): ob.hide_viewport = False; ob.hide_set(False)
export(os.path.join(OUT, 'SKLUBS_BOTTLE_MASTER.glb'))
export(os.path.join(OUT, 'SKLUBS_BOTTLE_WEB.glb'), web=True)
print('MASTER OK', {n: len(o.data.polygons) for n, o in objs.items()})
