#!/usr/bin/env python3
"""Downloads the native game's realistic art from Poly Haven (all CC0, free for commercial use):
photo-scanned PBR materials (colour, normal, ambient-occlusion/roughness/metal), real HDR skies
and scanned props. Runs on GitHub Actions (.github/workflows/assets.yml), which commits the files
into native/assets/. Only the Python standard library is used.

Each material slot names a few preferred Poly Haven IDs; if none exist, the best-matching asset by
keywords (most downloaded first) is used instead. Every pick is written to native/assets/manifest.json
with its credit.
"""
import json
import os
import sys
import time
import urllib.request

API = 'https://api.polyhaven.com'
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '..', 'assets'))
UA = {'User-Agent': 'ProofOfDuty-AssetFetch/1.0 (github.com/theunknownv5-max)'}

# slot: (preferred ids, keywords, resolution)
MATERIALS = {
    'ground_sand': (['coast_sand_01', 'coast_sand_02', 'sand_01', 'sandy_gravel', 'aerial_sand'], ['sand'], '2k'),
    'ground_dirt': (['dry_ground_01', 'dirt_floor', 'brown_mud_02', 'forest_ground_04', 'aerial_ground_rock'], ['dirt', 'soil', 'ground'], '2k'),
    'ground_red': (['red_laterite_soil_stones', 'red_dirt_mud_01', 'red_sand', 'rocky_terrain_03'], ['laterite', 'red soil', 'red dirt', 'clay'], '2k'),
    'ground_gravel': (['gravel_floor', 'gravelly_sand', 'gravel_road', 'rocky_trail'], ['gravel', 'pebbles'], '2k'),
    'ground_mud': (['brown_mud', 'brown_mud_leaves_01', 'mud_forest', 'aerial_mud_1'], ['mud'], '2k'),
    'grass': (['sparse_grass', 'grass_path_2', 'forrest_ground_01', 'aerial_grass_rock'], ['grass'], '2k'),
    'asphalt': (['asphalt_02', 'asphalt_04', 'asphalt_floor', 'aerial_asphalt_01'], ['asphalt', 'road'], '1k'),
    'concrete': (['concrete_wall_008', 'concrete_wall_004', 'concrete_wall_006', 'concrete_floor_worn_001'], ['concrete'], '1k'),
    'plaster': (['painted_plaster_wall', 'beige_wall_001', 'plastered_wall_04', 'worn_plaster_wall', 'white_plaster_02'], ['plaster', 'stucco', 'painted wall'], '1k'),
    'brick': (['red_brick_03', 'brick_wall_001', 'red_brick_plaster_patch_02'], ['brick'], '1k'),
    'planks': (['weathered_planks', 'wood_planks', 'old_planks_02', 'wood_planks_grey', 'plank_flooring'], ['planks', 'plank', 'wood'], '1k'),
    'metal': (['metal_plate', 'metal_plate_02', 'blue_metal_plate', 'painted_metal_02'], ['metal plate', 'metal'], '1k'),
    'rust': (['rusty_metal_02', 'rusty_metal_sheet', 'rust_coarse_01', 'rusty_metal'], ['rust'], '1k'),
    'corrugated': (['corrugated_iron', 'corrugated_iron_02', 'corrugated_iron_03'], ['corrugated'], '1k'),
    'painted_metal': (['green_metal_rust', 'painted_metal_shutter', 'blue_painted_planks'], ['painted metal', 'shutter', 'container'], '1k'),
    'rock': (['rock_face', 'rocky_terrain_02', 'rock_wall_08', 'aerial_rocks_02', 'rock_boulder_dry'], ['rock', 'cliff', 'boulder'], '1k'),
    'bark': (['bark_brown_02', 'bark_brown_01', 'pine_bark', 'bark_willow'], ['bark'], '1k'),
    'paving': (['cobblestone_floor_01', 'paving_stones', 'patterned_paving', 'square_floor'], ['cobblestone', 'paving', 'pavement'], '1k'),
    'stone_wall': (['stone_wall', 'castle_wall_slates', 'stone_brick_wall_001', 'rock_wall_02'], ['stone wall', 'stone'], '1k'),
    'mud_wall': (['clay_plaster', 'rough_plaster_brick', 'dry_mud', 'brown_mud_dry'], ['clay', 'adobe', 'mud'], '1k'),
    'fabric': (['fabric_pattern_07', 'denim_fabric', 'cotton_jersey', 'jogging_melange'], ['fabric', 'cloth', 'denim', 'cotton'], '1k'),
    'burlap': (['burlap', 'jute', 'hessian'], ['burlap', 'sack', 'jute', 'hessian', 'woven'], '1k'),
    'tiles_roof': (['roof_tiles', 'clay_roof_tiles', 'roof_tiles_14'], ['roof'], '1k'),
    'leather': (['leather_red_02', 'brown_leather', 'leather_white'], ['leather'], '1k'),
}
MAPS = {'albedo': ['Diffuse', 'diff'], 'normal': ['nor_gl'], 'arm': ['arm']}

# HDR skies: pure sky (no ground) versions, for the sky and the lighting.
SKIES = {
    'clear': (['kloofendal_43d_clear_puresky', 'syferfontein_18d_clear_puresky', 'qwantani_noon_puresky', 'kloofendal_43d_clear'], ['clear', 'midday']),
    'cloudy': (['kloofendal_48d_partly_cloudy_puresky', 'kloofendal_28d_misty_puresky', 'kloofendal_48d_partly_cloudy'], ['partly cloudy', 'cloudy']),
    'overcast': (['kloofendal_overcast_puresky', 'overcast_soil_puresky', 'kloofendal_overcast'], ['overcast']),
    'golden': (['qwantani_sunset_puresky', 'kloofendal_misty_morning_puresky', 'qwantani_late_afternoon_puresky', 'spruit_sunrise'], ['sunset', 'sunrise', 'golden hour']),
}

# Scanned props: keywords and how many of each.
PROPS = [
    (['barrel'], 2), (['crate', 'wooden box'], 2), (['jerrycan', 'jerry can', 'fuel can'], 1), (['pallet'], 1),
    (['boulder', 'rock'], 4), (['tree', 'palm'], 4), (['shrub', 'bush', 'fern', 'plant'], 4), (['grass'], 2),
    (['fence'], 2), (['tire', 'tyre', 'wheel'], 1), (['bench'], 1), (['plastic chair', 'chair'], 1), (['table'], 1),
    (['street lamp', 'lamp post', 'lamp'], 1), (['sign'], 1), (['barrier', 'road block'], 1), (['cone'], 1),
    (['generator'], 1), (['bucket'], 1), (['cinder', 'brick'], 1), (['sandbag', 'sack'], 1), (['wheelbarrow', 'cart'], 1),
    (['ladder'], 1), (['gas', 'cylinder', 'tank'], 1), (['trash', 'bin'], 1), (['log', 'stump'], 2), (['ruin', 'wall'], 1),
]
MAX_PROP_MB = 30


def get(url, tries=4):
    for k in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except Exception as e:  # network hiccup: wait and retry
            if k == tries - 1:
                raise
            print('  retry', url, e)
            time.sleep(2 + k * 3)


def jget(url):
    return json.loads(get(url))


def save(url, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return
    data = get(url)
    with open(path, 'wb') as f:
        f.write(data)


def text(a):
    return ' '.join([a.get('name', ''), ' '.join(a.get('tags', [])), ' '.join(a.get('categories', []))]).lower()


def rank(assets, keywords, used):
    hits = []
    for aid, a in assets.items():
        if aid in used:
            continue
        t = text(a) + ' ' + aid.replace('_', ' ').lower()
        if any(k in t for k in keywords):
            hits.append((a.get('download_count', 0), aid))
    hits.sort(reverse=True)
    return [h[1] for h in hits]


def pick_material(assets, prefs, keywords, res, used):
    for aid in prefs + rank(assets, keywords, used):
        if aid not in assets or aid in used:
            continue
        try:
            files = jget(f'{API}/files/{aid}')
        except Exception:
            continue
        urls = {}
        for out, keys in MAPS.items():
            for key in keys:
                f = files.get(key, {})
                r = f.get(res) or f.get('1k')
                if r and 'jpg' in r:
                    urls[out] = r['jpg']['url']
                    break
        if 'albedo' in urls and 'normal' in urls:
            return aid, urls
    return None, {}


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = {'source': 'Poly Haven (polyhaven.com), all assets CC0', 'materials': {}, 'skies': {}, 'props': {}}
    used = set()
    tex = jget(f'{API}/assets?t=textures')
    print(len(tex), 'textures on Poly Haven')
    for slot, (prefs, kws, res) in MATERIALS.items():
        aid, urls = pick_material(tex, prefs, kws, res, used)
        if not aid:
            print('!! no material for', slot)
            continue
        used.add(aid)
        for m, u in urls.items():
            save(u, os.path.join(OUT, 'pbr', slot, f'{m}.jpg'))
        manifest['materials'][slot] = {'id': aid, 'name': tex[aid].get('name'), 'authors': list(tex[aid].get('authors', {}).keys()), 'res': res, 'maps': sorted(urls)}
        print(f'{slot:14s} <- {aid} ({res})')

    hdr = jget(f'{API}/assets?t=hdris')
    print(len(hdr), 'HDRIs on Poly Haven')
    for slot, (prefs, kws) in SKIES.items():
        cands = prefs + [a for a in rank(hdr, kws, used) if 'puresky' in a] + rank(hdr, kws, used)
        done = False
        for aid in cands:
            if aid not in hdr or aid in used:
                continue
            try:
                files = jget(f'{API}/files/{aid}')
                url = files['hdri']['2k']['hdr']['url']
            except Exception:
                continue
            save(url, os.path.join(OUT, 'sky', f'{slot}.hdr'))
            used.add(aid)
            manifest['skies'][slot] = {'id': aid, 'name': hdr[aid].get('name'), 'authors': list(hdr[aid].get('authors', {}).keys())}
            print(f'sky {slot:9s} <- {aid}')
            done = True
            break
        if not done:
            print('!! no sky for', slot)

    models = jget(f'{API}/assets?t=models')
    print(len(models), 'models on Poly Haven')
    for kws, n in PROPS:
        got = 0
        for aid in rank(models, kws, used):
            if got >= n:
                break
            try:
                files = jget(f'{API}/files/{aid}')
                g = files['gltf']['1k']['gltf']
            except Exception:
                continue
            total = g.get('size', 0) + sum(v.get('size', 0) for v in g.get('include', {}).values())
            if total > MAX_PROP_MB * 1024 * 1024:
                continue
            base = os.path.join(OUT, 'props', aid)
            try:
                save(g['url'], os.path.join(base, os.path.basename(g['url'])))
                for rel, inc in g.get('include', {}).items():
                    save(inc['url'], os.path.join(base, rel))
            except Exception as e:
                print('  skip', aid, e)
                continue
            used.add(aid)
            got += 1
            manifest['props'][aid] = {'name': models[aid].get('name'), 'keywords': kws, 'file': os.path.basename(g['url']), 'authors': list(models[aid].get('authors', {}).keys()), 'mb': round(total / 1048576, 1)}
            print(f'prop {aid} ({kws[0]}, {total / 1048576:.1f} MB)')

    with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=1)
    with open(os.path.join(OUT, 'CREDITS.txt'), 'w') as f:
        f.write('Art from Poly Haven (https://polyhaven.com), licensed CC0 (public domain). Thank you to its artists.\n\n')
        for kind in ('materials', 'skies', 'props'):
            for k, v in manifest[kind].items():
                f.write(f"{kind[:-1]}: {k} = {v.get('name')} ({v.get('id', k)}) by {', '.join(v.get('authors', []))}\n")
    print('done:', len(manifest['materials']), 'materials,', len(manifest['skies']), 'skies,', len(manifest['props']), 'props')


if __name__ == '__main__':
    sys.exit(main())
