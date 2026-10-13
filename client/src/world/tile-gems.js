// Healing gemstones on the ground advert tiles: faceted crystals that spin and glow in their
// own colour (ruby, emerald, sapphire, golden topaz). Walk over one to heal or armour up.
import * as THREE from 'three';
import * as T from '../core/textures.js';
import { TILE_GEMS } from '../../../shared/config.js';
import { tileGemSpots } from '../../../shared/map.js';

const SHAPES = {
  ruby: () => new THREE.OctahedronGeometry(0.3, 0).scale(1, 1.25, 1),
  emerald: () => new THREE.CylinderGeometry(0.22, 0.28, 0.5, 8),
  sapphire: () => new THREE.DodecahedronGeometry(0.3, 0),
  topaz: () => new THREE.IcosahedronGeometry(0.34, 0)
};

export class TileGems {
  constructor(scene, map, state) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.geos = Object.fromEntries(Object.entries(SHAPES).map(([k, f]) => [k, f()]));
    this.mats = Object.fromEntries(
      Object.entries(TILE_GEMS.types).map(([k, t]) => [k, new THREE.MeshPhysicalMaterial({ color: t.color, emissive: t.color, emissiveIntensity: 0.9, roughness: 0.05, metalness: 0.1, clearcoat: 1, transmission: 0.15, transparent: true, opacity: 0.95 })])
    );
    const glowTex = T.softDot();
    this.gems = tileGemSpots(map).map((s, i) => {
      const g = new THREE.Group();
      g.position.set(s.x, 0.55, s.z);
      const crystal = new THREE.Mesh(this.geos.ruby, this.mats.ruby);
      crystal.castShadow = true;
      g.add(crystal);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ffffff', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8 }));
      glow.scale.setScalar(1.3);
      g.add(glow);
      const pad = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.62, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5, depthWrite: false }));
      pad.position.y = -0.5;
      g.add(pad);
      this.group.add(g);
      const st = state[i] || ['ruby', 0];
      const gem = { g, crystal, glow, pad, type: null, at: st[1], phase: i * 1.7 };
      this.setType(gem, st[0]);
      return gem;
    });
  }

  setType(gem, type) {
    if (gem.type === type || !TILE_GEMS.types[type]) return;
    gem.type = type;
    gem.crystal.geometry = this.geos[type];
    gem.crystal.material = this.mats[type];
    gem.glow.material.color.set(TILE_GEMS.types[type].color);
    gem.pad.material.color.set(TILE_GEMS.types[type].color);
  }

  // Server event: someone took gem i; it comes back at `at` as `type`.
  taken(i, at, type) {
    const gem = this.gems[i];
    if (!gem) return;
    gem.at = at;
    gem.burst = 1;
    gem.next = type;
  }

  update(dt, t, serverNow) {
    for (const gem of this.gems) {
      const ready = gem.at <= serverNow;
      if (ready && gem.next) {
        this.setType(gem, gem.next);
        gem.next = null;
      }
      gem.crystal.visible = ready;
      gem.pad.visible = ready;
      if (ready) {
        gem.crystal.rotation.y += dt * 1.8;
        gem.crystal.position.y = Math.sin(t * 2.2 + gem.phase) * 0.1;
        gem.glow.material.opacity = 0.55 + Math.sin(t * 4 + gem.phase) * 0.2;
        gem.glow.scale.setScalar(1.3);
      } else gem.glow.material.opacity = 0;
      if (gem.burst > 0) {
        gem.burst = Math.max(0, gem.burst - dt * 1.6);
        gem.glow.scale.setScalar(1.3 + (1 - gem.burst) * 5);
        gem.glow.material.opacity = gem.burst;
      }
    }
  }

  dispose() {
    this.scene.remove(this.group);
  }
}
