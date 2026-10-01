// Chargement des masters 3D (GLB), partagé par l'accueil et le configurateur. Un modèle n'est chargé qu'une fois.
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

const cache = new Map();

export function loadGLB(url) {
  if (!cache.has(url)) cache.set(url, load(url).catch((e) => { cache.delete(url); throw e; }));
  return cache.get(url);
}

async function load(url) {
  const loader = new GLTFLoader();
  if (url.endsWith('.b64.txt')) {
    // GLB encodé en base64 dans un fichier texte : pour les hébergeurs qui ne servent pas .glb
    // et bloquent les URI data: (page d'aperçu). Décodé ici, puis analysé sans requête réseau.
    let text = window.SKLUBS_INLINE?.[url];
    if (!text) {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Modèle 3D introuvable (${res.status})`);
      text = await res.text();
    }
    const bin = atob(text.trim());
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return (await new Promise((resolve, reject) => loader.parse(bytes.buffer, '', resolve, reject))).scene;
  }
  const draco = new DRACOLoader();
  draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/');
  loader.setDRACOLoader(draco);
  return (await loader.loadAsync(url)).scene;
}
