#!/usr/bin/env python3
"""Build the world battlefield data from Natural Earth (public domain).

Usage:
  git clone --depth 1 --filter=blob:none --sparse https://github.com/nvkelso/natural-earth-vector.git ne
  (cd ne && git sparse-checkout set --no-cone /geojson/ne_10m_admin_1_states_provinces.geojson /geojson/ne_10m_admin_0_countries.geojson)
  python3 tools/build-world.py ne/geojson

Writes:
  shared/world-index.js        every country: code, name, continent, label point, region count, payment provider
  shared/world/outline.json    a light world outline for the country picker
  shared/world/<cc>.json       one country: outline, and its regions (shape, label point, biome, resources, landmark)

Every region becomes its own battlefield. Countries with more than 60 first-level divisions are merged
into their official groups (or nearby clusters) so the war map stays playable. Nigeria keeps the
hand-made state data (resources and landmarks) from shared/states.js.
"""
import json, math, os, re, sys, unicodedata, random, subprocess

SRC = sys.argv[1] if len(sys.argv) > 1 else 'ne/geojson'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'shared', 'world')
MAX_REGIONS = 60
CLUSTERS = 36

AFRICA_PAYSTACK = 'Africa'

# ---------- geometry ----------

def rings_of(geom):
    if geom is None:
        return []
    if geom['type'] == 'Polygon':
        return [geom['coordinates'][0]]
    if geom['type'] == 'MultiPolygon':
        return [p[0] for p in geom['coordinates']]
    return []

def area(ring):
    a = 0.0
    for i in range(len(ring) - 1):
        a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
    return abs(a) / 2

def dp(points, tol):
    """Douglas-Peucker simplification (iterative)."""
    if len(points) < 4:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = points[a]
        bx, by = points[b]
        dx, dy = bx - ax, by - ay
        L = math.hypot(dx, dy) or 1e-12
        best, idx = 0.0, -1
        for i in range(a + 1, b):
            px, py = points[i]
            d = abs(dy * px - dx * py + bx * ay - by * ax) / L if L > 1e-12 else math.hypot(px - ax, py - ay)
            if d > best:
                best, idx = d, i
        if best > tol and idx > 0:
            keep[idx] = True
            stack.append((a, idx))
            stack.append((idx, b))
    return [p for p, k in zip(points, keep) if k]

def shape(rings, tol, nd, min_frac=0.004, max_parts=12):
    """Simplify the outer rings, dropping specks; flat [lon, lat, lon, lat, ...] per ring."""
    rings = [r for r in rings if len(r) >= 4]
    if not rings:
        return []
    rings.sort(key=area, reverse=True)
    total = sum(area(r) for r in rings) or 1
    out = []
    for i, r in enumerate(rings[:max_parts]):
        if i and area(r) / total < min_frac:
            continue
        s = dp(r, tol)
        if len(s) < 4:
            # keep a tiny island as a triangle so it can still be tapped
            s = r[:: max(1, len(r) // 3)][:3] + [r[0]]
        flat = []
        for x, y in s:
            flat += [round(x, nd), round(y, nd)]
        out.append(flat)
    return out

def bbox(rings):
    xs = [p[0] for r in rings for p in r]
    ys = [p[1] for r in rings for p in r]
    return [min(xs), min(ys), max(xs), max(ys)]

def shift_rings(rings):
    return [[[x + 360 if x < 0 else x, y] for x, y in r] for r in rings]

def slug(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-') or 'region'

# ---------- climate (biome) ----------

def inbox(lon, lat, b):
    return b[0] <= lon <= b[2] and b[1] <= lat <= b[3]

DESERT = [(-17, 17, 33, 30.5), (34, 15, 60, 31), (44, 25, 64, 36), (60, 24, 72, 32), (68, 24, 74, 29.5),
          (50, 38, 68, 46), (75, 37, 106, 45), (114, -31, 146, -19), (11, -29, 22, -18), (-72, -28, -68, -16),
          (-117, 26, -105, 36.5), (-71, -50, -65, -40), (36, 17, 44, 22)]
SAHEL = [(-17, 12.5, 40, 17), (40, 2, 51, 12)]
RAIN = [(-76, -13, -47, 5), (8.5, -5, 31, 5.5), (-13, 4, 8.5, 7.5), (94, -11, 156, 11), (-92, 7, -76, 17.5),
        (-60, 2, -52, 8), (43, -26, 51, -12), (72, 6, 81, 13), (-80, -2, -76, 9)]
CREEKS = [(104.5, 8.5, 107, 11), (88, 21.5, 91.5, 23.5), (29.5, 30.6, 32.4, 31.6), (-91.5, 28.9, -88.8, 30.4),
          (-52, -2, -48, 0.5), (90, 21, 92.5, 22.8), (99.5, 13, 101, 14.3)]
SNOW = [(78, 28, 102, 38), (-75, -55, -66, -46)]

def biome_for(lon, lat, kind, small):
    a = abs(lat)
    if re.search(r'capital|federal district|metropol|city|special administrative|autonomous city|distrito', kind or '', re.I):
        return 'urban'
    for b in CREEKS:
        if inbox(lon, lat, b):
            return 'creeks'
    for b in SNOW:
        if inbox(lon, lat, b):
            return 'snow'
    if a >= 60 or (lat >= 52 and lon >= 55) or (lat >= 55 and -170 <= lon <= -50) or (lat <= -50):
        return 'snow'
    for b in DESERT:
        if inbox(lon, lat, b):
            return 'desert'
    for b in SAHEL:
        if inbox(lon, lat, b):
            return 'sahel'
    for b in RAIN:
        if inbox(lon, lat, b):
            return 'rainforest'
    if a >= 34:
        # Highlands: Alps, Caucasus, Rockies, Andes south, Anatolia east.
        for b in [(5.5, 45.3, 15.5, 47.8), (40, 40, 49, 43.5), (-116, 37, -104, 49), (38, 37, 45, 41), (68, 34, 78, 37.5)]:
            if inbox(lon, lat, b):
                return 'plateau'
        return 'temperate'
    if a >= 23:
        return 'temperate' if lat > 0 and lon > 100 else 'savanna'
    # tropics
    for b in [(-80, -20, -64, 2), (34, -11, 41, 10), (-104, 15, -96, 21), (95, 18, 105, 28)]:
        if inbox(lon, lat, b):
            return 'plateau'
    return 'savanna'

RES_BY_BIOME = {
    'desert': ['crude', 'gas', 'salt', 'phosphate', 'gold', 'copper', 'iron', 'gypsum', 'potash', 'solar'],
    'sahel': ['gold', 'gumarabic', 'cattle', 'salt', 'sesame', 'cotton', 'uranium', 'groundnut'],
    'savanna': ['cattle', 'cotton', 'gold', 'groundnut', 'cashew', 'sesame', 'coffee', 'limestone', 'granite'],
    'rainforest': ['timber', 'rubber', 'cocoa', 'gold', 'crude', 'coffee', 'diamonds', 'hydro', 'palmoil'],
    'creeks': ['crude', 'gas', 'fish', 'rice', 'port'],
    'plateau': ['tin', 'gold', 'copper', 'silver', 'hydro', 'tea', 'coffee', 'granite', 'lithium'],
    'temperate': ['coal', 'iron', 'wheat', 'timber', 'grapes', 'cattle', 'limestone', 'hydro', 'gas', 'nickel'],
    'snow': ['timber', 'iron', 'nickel', 'gas', 'crude', 'gold', 'hydro', 'fish', 'diamonds', 'coal'],
    'urban': ['port', 'gas', 'limestone', 'granite', 'hydro'],
}
LM_BY_BIOME = {
    'desert': ['rock', 'gate', 'palace', 'flare'], 'sahel': ['gate', 'palace', 'rock'], 'savanna': ['rock', 'hills', 'lake', 'palace'],
    'rainforest': ['falls', 'rock', 'lake'], 'creeks': ['flare', 'lake'], 'plateau': ['hills', 'falls', 'rock'],
    'temperate': ['tower', 'gate', 'palace', 'lake', 'falls', 'hills'], 'snow': ['hills', 'lake', 'tower', 'falls'], 'urban': ['tower', 'palace', 'gate'],
}
LM_NAME = {'rock': 'Lookout Rock', 'hills': 'Highlands', 'gate': 'Old City Gate', 'flare': 'Gas Flare', 'tower': 'Broadcast Tower',
           'falls': 'Falls', 'lake': 'Lake Shore', 'palace': 'Old Palace'}

def seeded(s):
    h = 2166136261
    for ch in s:
        h = ((h ^ ord(ch)) * 16777619) & 0xffffffff
    return random.Random(h)

def flavour(rid, name, biome, coastal):
    r = seeded(rid)
    pool = list(RES_BY_BIOME[biome])
    if coastal and 'port' not in pool:
        pool.append('port')
    r.shuffle(pool)
    res = pool[:3]
    lmt = r.choice(LM_BY_BIOME[biome])
    short = re.sub(r'\s*\(.*\)$', '', name)
    return res, {'name': f'{short} {LM_NAME[lmt]}', 'type': lmt}

# ---------- clustering for countries with too many divisions ----------

def kmeans(points, k, seed=7):
    r = random.Random(seed)
    cents = r.sample(points, k)
    for _ in range(40):
        groups = [[] for _ in range(k)]
        for i, (x, y, w) in enumerate(points):
            j = min(range(k), key=lambda c: (x - cents[c][0]) ** 2 + (y - cents[c][1]) ** 2)
            groups[j].append(i)
        new = []
        for j, g in enumerate(groups):
            if not g:
                new.append(cents[j])
                continue
            W = sum(points[i][2] for i in g) or 1
            new.append((sum(points[i][0] * points[i][2] for i in g) / W, sum(points[i][1] * points[i][2] for i in g) / W, 1))
        if new == cents:
            break
        cents = new
    return [g for g in groups if g]

# ---------- main ----------

def main():
    a0 = json.load(open(os.path.join(SRC, 'ne_10m_admin_0_countries.geojson'), encoding='utf8'))
    a1 = json.load(open(os.path.join(SRC, 'ne_10m_admin_1_states_provinces.geojson'), encoding='utf8'))
    os.makedirs(OUT, exist_ok=True)
    ng = nigeria_states()
    places = load_places(os.path.join(SRC, 'ne_10m_populated_places_simple.geojson'))
    by_cc = {}
    for f in a1['features']:
        # Group by the ISO 3166-2 code (internationally recognised borders), else the country code.
        iso = f['properties'].get('iso_3166_2') or ''
        cc = iso[:2] if re.match(r'^[A-Z]{2}-', iso) else f['properties']['iso_a2']
        by_cc.setdefault(cc, []).append(f)
    index = []
    outline_world = []
    for f in a0['features']:
        p = f['properties']
        cc = p['ISO_A2_EH']
        if cc in ('-99', None) or len(cc) != 2:
            continue
        cc = cc.upper()
        if any(c['cc'] == cc for c in index):
            continue
        rings = rings_of(f['geometry'])
        if not rings:
            continue
        bb = bbox(rings)
        # Countries across the 180th meridian (Russia, Fiji, the USA's Aleutians): move the western
        # half by +360 degrees so the country is drawn in one piece.
        world_rings = rings
        wrap = bb[2] - bb[0] > 180
        if wrap:
            rings = shift_rings(rings)
            bb = bbox(rings)
        span = max(bb[2] - bb[0], bb[3] - bb[1])
        tol = max(0.002, span * 0.0035)
        nd = 3 if span < 4 else 2
        name = p.get('NAME_EN') or p['NAME']
        continent = p['CONTINENT'] if p['CONTINENT'] != 'Seven seas (open ocean)' else 'Oceania'
        country_outline = shape(rings, tol, nd, 0.002, 30)
        outline_world.append({'cc': cc, 'p': shape(world_rings, 0.35, 1, 0.01, 6)})
        feats = by_cc.get(cc, [])
        if wrap:
            for ft in feats:
                ft['geometry'] = {'type': 'MultiPolygon', 'coordinates': [[r] for r in shift_rings(rings_of(ft['geometry']))]}
                if ft['properties']['longitude'] is not None and ft['properties']['longitude'] < 0:
                    ft['properties']['longitude'] += 360
        regions = build_regions(cc, name, feats, rings, tol, nd, ng if cc == 'NG' else None, span, places.get(cc, []))
        lx, ly = p.get('LABEL_X'), p.get('LABEL_Y')
        if lx is None:
            lx, ly = (bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2
            lx = lx - 360 if lx > 180 else lx
        clx = lx + 360 if wrap and lx < 0 else lx
        data = {'cc': cc, 'name': name, 'continent': continent, 'bbox': [round(v, 3) for v in bb], 'label': [round(clx, 2), round(ly, 2)], 'outline': country_outline, 'regions': regions}
        with open(os.path.join(OUT, f'{cc.lower()}.json'), 'w', encoding='utf8') as fh:
            json.dump(data, fh, separators=(',', ':'), ensure_ascii=False)
        index.append({'cc': cc, 'name': name, 'continent': continent, 'sub': p.get('SUBREGION') or '', 'lon': round(lx, 2), 'lat': round(ly, 2),
                      'n': len(regions), 'pay': 'paystack' if continent == AFRICA_PAYSTACK else 'stripe', 'first': regions[0]['id'] if regions else None})
    index.sort(key=lambda c: c['name'])
    with open(os.path.join(OUT, 'outline.json'), 'w', encoding='utf8') as fh:
        json.dump(outline_world, fh, separators=(',', ':'))
    js = ['// Generated by tools/build-world.py from Natural Earth (public domain). Do not edit by hand.',
          '// Every country you can fight in: code, name, continent, label point, number of regions and',
          '// which payment provider serves it (Paystack in Africa, Stripe everywhere else).',
          'export const COUNTRIES = [']
    for c in index:
        js.append('  ' + json.dumps(c, ensure_ascii=False) + ',')
    js.append('];')
    js.append('')
    js.append('export const COUNTRY_BY_CC = Object.fromEntries(COUNTRIES.map((c) => [c.cc, c]));')
    js.append('')
    with open(os.path.join(ROOT, 'shared', 'world-index.js'), 'w', encoding='utf8') as fh:
        fh.write('\n'.join(js))
    total = sum(c['n'] for c in index)
    size = sum(os.path.getsize(os.path.join(OUT, x)) for x in os.listdir(OUT))
    print(f'{len(index)} countries, {total} regions, {size / 1e6:.1f} MB')

def nigeria_states():
    """The hand-made Nigerian states (ids, resources, landmarks) from shared/states.js."""
    code = "import { STATES } from './shared/states.js'; console.log(JSON.stringify(STATES));"
    out = subprocess.check_output(['node', '--input-type=module', '-e', code], cwd=ROOT)
    return json.loads(out)

def build_regions(cc, cname, feats, crings, tol, nd, ng, span, places):
    if not feats:
        lon = sum(p[0] for r in crings for p in r) / sum(len(r) for r in crings)
        lat = sum(p[1] for r in crings for p in r) / sum(len(r) for r in crings)
        units = [{'name': cname, 'type': 'Country', 'lon': lon, 'lat': lat, 'rings': crings, 'members': [cname]}]
    else:
        units = [{'name': f['properties']['name_en'] or f['properties']['name'] or f['properties']['woe_name'] or f['properties']['gn_name'] or f['properties']['iso_3166_2'] or cname, 'type': f['properties']['type_en'] or '', 'group': f['properties']['region'],
                  'lon': f['properties']['longitude'], 'lat': f['properties']['latitude'], 'rings': rings_of(f['geometry']),
                  'rank': f['properties']['scalerank'] or 9} for f in feats]
        units = [u for u in units if u['rings'] and u['lon'] is not None]
        for u in units:
            u['area'] = sum(area(r) for r in u['rings'])
        if len(units) > MAX_REGIONS:
            groups = {}
            for u in units:
                groups.setdefault(u['group'], []).append(u)
            if None not in groups and 8 <= len(groups) <= MAX_REGIONS:
                parts = [(g, us) for g, us in groups.items()]
            else:
                cl = math.cos(math.radians(sum(u['lat'] for u in units) / len(units)))
                pts = [(u['lon'] * cl, u['lat'], 1) for u in units]
                parts = [(None, [units[i] for i in g]) for g in kmeans(pts, min(CLUSTERS, len(units)))]
            merged = []
            for g, us in parts:
                us.sort(key=lambda u: (u['rank'], -u['area']))
                W = sum(u['area'] for u in us) or 1
                merged.append({'name': g if g else (us[0]['name'] if len(us) == 1 else f"{us[0]['name']} Region"), 'type': 'Region',
                               'lon': sum(u['lon'] * u['area'] for u in us) / W, 'lat': sum(u['lat'] * u['area'] for u in us) / W,
                               'rings': [r for u in us for r in u['rings']], 'members': [u['name'] for u in us]})
            units = merged
    total_area = sum(sum(area(r) for r in u['rings']) for u in units) or 1
    regions = []
    used = set()
    ng_by_name = {}
    if ng:
        for s in ng:
            ng_by_name[slug(s['name'].replace(' (FCT)', ''))] = s
        ng_by_name['federal-capital-territory'] = next(s for s in ng if s['id'] == 'fct')
        ng_by_name['nassarawa'] = next(s for s in ng if s['id'] == 'nasarawa')
    for u in units:
        frac = sum(area(r) for r in u['rings']) / total_area
        poly = shape(u['rings'], tol, nd, 0.01, 8)
        lon, lat = round(u['lon'], 3), round(u['lat'], 3)
        if ng:
            s = ng_by_name.get(re.sub(r'-state$', '', slug(u['name'])))
            if not s:
                print('NG unmatched', u['name'])
                continue
            reg = {'id': s['id'], 'name': s['name'], 'type': 'State', 'capital': s['capital'], 'zone': s['zone'], 'biome': s['biome'],
                   'lat': s['lat'], 'lon': s['lon'], 'resources': s['resources'], 'landmark': s['landmark'], 'poly': poly}
            if s.get('capitalTerritory'):
                reg['capitalTerritory'] = True
        else:
            rid = f"{cc.lower()}.{slug(u['name'])}"
            n = 2
            while rid in used:
                rid = f"{cc.lower()}.{slug(u['name'])}-{n}"
                n += 1
            cap = capital_of(u['rings'], places)
            big_city = cap and (cap['rank'] == 0 or cap['pop'] >= 4_000_000)
            sq = sum(area(r) for r in u['rings']) * math.cos(math.radians(lat))
            biome = 'urban' if big_city and sq < 1.2 else biome_for(lon, lat, u['type'], False)
            coastal = False
            res, lm = flavour(rid, u['name'], biome, coastal)
            reg = {'id': rid, 'name': u['name'], 'type': u['type'] or 'Region', 'capital': cap['name'] if cap else u['name'], 'biome': biome, 'lat': lat, 'lon': lon, 'resources': res, 'landmark': lm, 'poly': poly}
            if u.get('group'):
                reg['zone'] = u['group']
        used.add(reg['id'])
        regions.append(reg)
    # Two divisions with the same name (a city and the province around it): say which is which.
    seen = {}
    for r in regions:
        seen.setdefault(r['name'], []).append(r)
    for name, rs in seen.items():
        if len(rs) > 1:
            for i, r in enumerate(rs):
                r['name'] = f"{name} ({r['type']})" if len({x['type'] for x in rs}) == len(rs) else f'{name} {i + 1}'
    regions.sort(key=lambda r: r['name'])
    return regions

def load_places(path):
    rank = {'Admin-0 capital': 0, 'Admin-0 capital alt': 1, 'Admin-1 region capital': 2, 'Admin-1 capital': 2, 'Admin-0 region capital': 2, 'Populated place': 5}
    out = {}
    for f in json.load(open(path, encoding='utf8'))['features']:
        p = f['properties']
        if p['featurecla'] not in rank:
            continue
        out.setdefault(p['iso_a2'], []).append({'name': p['name'], 'lon': p['longitude'], 'lat': p['latitude'], 'rank': rank[p['featurecla']], 'pop': p['pop_max'] or 0})
    return out

def inside(x, y, ring):
    c = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi:
            c = not c
        j = i
    return c

def capital_of(rings, places):
    """The most important town inside the region: national capital, then regional capital, then the biggest."""
    best = None
    bbs = [bbox([r]) for r in rings]
    for pl in places:
        for r, bb in zip(rings, bbs):
            if bb[0] <= pl['lon'] <= bb[2] and bb[1] <= pl['lat'] <= bb[3] and inside(pl['lon'], pl['lat'], r):
                if not best or (pl['rank'], -pl['pop']) < (best['rank'], -best['pop']):
                    best = pl
                break
    return best

if __name__ == '__main__':
    main()
