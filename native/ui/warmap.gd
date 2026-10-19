extends Control
## The war map of the chosen country: its real region shapes and a hex tile for every region
## (Nigeria by zone colours, other countries by biome), glowing where battles are live.
## Regions far from the mainland (overseas) sit in a column on the right. Tap one to pick it.

signal picked(state_id: String)

const ZONE_COL := {"NC": Color("#2f7a4c"), "NE": Color("#8a6a24"), "NW": Color("#9a5426"), "SE": Color("#22707e"), "SS": Color("#28588e"), "SW": Color("#6a4890")}
const BIOME_COL := {"sahel": Color("#9a6a2a"), "desert": Color("#a8823a"), "savanna": Color("#7a7a2c"), "plateau": Color("#6a5a8a"), "rainforest": Color("#2f7a4c"), "creeks": Color("#28688e"), "urban": Color("#8a3a4a"), "temperate": Color("#3f7a3a"), "snow": Color("#5a7a9a")}
const W := 1000.0
const H := 860.0

var tiles: Array = []   # {id, x, y, col, name, away}
var shapes: Array = []  # [PackedVector2Array (map units), Color, id]
var outline: Array = [] # PackedVector2Array per ring
var selected := ""
var live := {}          # id -> lobby entry
var t := 0.0
var font: Font
var R := 30.0
var country := {}

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
	font = Kit.font_bold

func set_country(data: Dictionary) -> void:
	country = data
	_layout()
	queue_redraw()

func _layout() -> void:
	tiles.clear()
	shapes.clear()
	outline.clear()
	var regs: Array = country.get("regions", [])
	if regs.is_empty():
		return
	var is_ng: bool = country.get("cc", "") == "NG"
	var bb: Array = country.get("bbox", [0, 0, 1, 1])
	var lab: Array = country.get("label", [(bb[0] + bb[2]) / 2.0, (bb[1] + bb[3]) / 2.0])
	var L0: float = lab[0]
	var L1: float = lab[1]
	if L0 < float(bb[0]):
		L0 += 360.0
	var cl := cos(deg_to_rad(L1))
	var dists: Array = []
	for r in regs:
		dists.append(Vector2((float(r.lon) - L0) * cl, float(r.lat) - L1).length())
	var sorted := dists.duplicate()
	sorted.sort()
	var limit: float = max(8.0, float(sorted[sorted.size() / 2]) * 3.0)
	var main: Array = []
	var away: Array = []
	for i in regs.size():
		(main if float(dists[i]) <= limit else away).append(regs[i])
	# Fit the mainland shapes.
	var mn := Vector2(INF, INF)
	var mx := Vector2(-INF, -INF)
	for r in main:
		for flat in r.get("poly", []):
			for k in range(0, flat.size(), 2):
				mn.x = min(mn.x, float(flat[k]))
				mx.x = max(mx.x, float(flat[k]))
				mn.y = min(mn.y, float(flat[k + 1]))
				mx.y = max(mx.y, float(flat[k + 1]))
	if mn.x == INF:
		mn = Vector2(bb[0], bb[1])
		mx = Vector2(bb[2], bb[3])
	var kx := cos(deg_to_rad((mn.y + mx.y) / 2.0))
	var right := 150.0 if not away.is_empty() else 0.0
	var pad := 46.0
	var sc: float = min((W - right - pad * 2) / max(0.01, (mx.x - mn.x) * kx), (H - pad * 2) / max(0.01, mx.y - mn.y))
	var ox: float = pad + (W - right - pad * 2 - (mx.x - mn.x) * kx * sc) / 2.0
	var oy: float = pad + (H - pad * 2 - (mx.y - mn.y) * sc) / 2.0
	var proj := func(lon: float, lat: float) -> Vector2: return Vector2(ox + (lon - mn.x) * kx * sc, oy + (mx.y - lat) * sc)
	for flat in country.get("outline", []):
		var pl := PackedVector2Array()
		for k in range(0, flat.size(), 2):
			pl.append(proj.call(float(flat[k]), float(flat[k + 1])))
		outline.append(pl)
	for r in main:
		var col: Color = ZONE_COL.get(r.get("zone", ""), Color.GRAY) if is_ng else BIOME_COL.get(r.get("biome", ""), Color("#5a6a7a"))
		for flat in r.get("poly", []):
			var pl := PackedVector2Array()
			for k in range(0, flat.size(), 2):
				pl.append(proj.call(float(flat[k]), float(flat[k + 1])))
			if pl.size() >= 3:
				shapes.append([pl, col, r.id])
		var p: Vector2 = proj.call(float(r.lon), float(r.lat))
		tiles.append({"id": r.id, "name": r.name, "col": col, "x": p.x, "y": p.y, "hx": p.x, "hy": p.y, "away": false})
	R = clamp(sqrt((W - right) * H / max(1, main.size())) * 0.3, 13.0, 44.0)
	var mind := R * 1.86
	for it in 160:
		for i in tiles.size():
			for j in range(i + 1, tiles.size()):
				var a: Dictionary = tiles[i]
				var b: Dictionary = tiles[j]
				var dx: float = b.x - a.x
				var dy: float = b.y - a.y
				var d: float = max(0.01, sqrt(dx * dx + dy * dy))
				if d < mind:
					var push := (mind - d) / 2.0
					a.x -= dx / d * push
					a.y -= dy / d * push
					b.x += dx / d * push
					b.y += dy / d * push
		for p in tiles:
			p.x += (p.hx - p.x) * 0.02
			p.y += (p.hy - p.y) * 0.02
	var cols := int(ceil(away.size() / 12.0))
	for i in away.size():
		var r: Dictionary = away[i]
		var col: int = i % max(1, cols)
		var row: int = i / max(1, cols)
		var x: float = W - right + 30.0 + col * 64.0
		var y: float = 70.0 + row * min(64.0, (H - 90.0) / ceil(float(away.size()) / max(1, cols)))
		tiles.append({"id": r.id, "name": r.name, "col": BIOME_COL.get(r.get("biome", ""), Color("#5a6a7a")), "x": x, "y": y, "hx": x, "hy": y, "away": true})

func _xf() -> Array:
	var sc: float = min(size.x / W, size.y / H)
	var off := (size - Vector2(W, H) * sc) / 2.0
	return [sc, off]

func _to_screen(p: Vector2) -> Vector2:
	var x := _xf()
	return p * x[0] + x[1]

func _process(delta: float) -> void:
	t += delta
	queue_redraw()

func _gui_input(e: InputEvent) -> void:
	if not (e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_LEFT):
		return
	var pos: Vector2 = e.position
	var x := _xf()
	var best := ""
	var bd := 1e9
	for tl in tiles:
		var r: float = (22.0 if tl.away else R) * x[0]
		var sp: Vector2 = Vector2(tl.x, tl.y) * x[0] + x[1]
		var d := sp.distance_to(pos)
		if d < bd and d < max(r * 1.3, 22.0):
			bd = d
			best = tl.id
	# Or the region shape under the finger.
	if best == "":
		var mp: Vector2 = (pos - x[1]) / x[0]
		for s in shapes:
			if Geometry2D.is_point_in_polygon(mp, s[0]):
				best = s[2]
				break
	if best != "":
		selected = best
		Sfx.ui("click")
		picked.emit(best)
		accept_event()

func _hex(c: Vector2, r: float) -> PackedVector2Array:
	var pts := PackedVector2Array()
	for i in 6:
		var a := PI / 3.0 * i + PI / 6.0
		pts.append(c + Vector2(cos(a), sin(a)) * r)
	return pts

func _draw() -> void:
	if tiles.is_empty():
		var msg := "Loading the war map…"
		draw_string(Kit.font_bold, size / 2.0 - Vector2(120, 0), msg, HORIZONTAL_ALIGNMENT_LEFT, -1, 20, Kit.MUTED)
		return
	var x := _xf()
	var sc: float = x[0]
	var xform := Transform2D(0.0, Vector2(sc, sc), 0.0, x[1])
	draw_set_transform_matrix(xform)
	for pl in outline:
		if pl.size() >= 3:
			var closed: PackedVector2Array = pl.duplicate()
			closed.append(pl[0])
			draw_polyline(closed, Color(1, 0.59, 0.24, 0.5), 3.0, true)
	for s in shapes:
		var c: Color = s[1]
		var sel: bool = s[2] == selected
		var fill := Color(c.r, c.g, c.b, 0.45 if sel else 0.26)
		var tris := Geometry2D.triangulate_polygon(s[0])
		if tris.size() >= 3:
			var cols := PackedColorArray()
			cols.resize(s[0].size())
			cols.fill(fill)
			RenderingServer.canvas_item_add_triangle_array(get_canvas_item(), tris, s[0], cols)
		var ring: PackedVector2Array = s[0].duplicate()
		ring.append(s[0][0])
		draw_polyline(ring, Kit.POD if sel else Color(1, 1, 1, 0.16), 2.0 if sel else 1.0, true)
	draw_set_transform_matrix(Transform2D.IDENTITY)
	if tiles.any(func(tl): return tl.away):
		draw_string(font, _to_screen(Vector2(W - 140, 34)), "OVERSEAS", HORIZONTAL_ALIGNMENT_LEFT, -1, int(max(10.0, 12.0 * sc)), Kit.MUTED)
	for tl in tiles:
		var c := _to_screen(Vector2(tl.x, tl.y))
		var r: float = (22.0 if tl.away else R) * sc
		var col: Color = tl.col
		var lv: Dictionary = live.get(tl.id, {})
		var humans := int(lv.get("humans", 0))
		var sel: bool = tl.id == selected
		if humans > 0:
			var pulse := 0.5 + 0.5 * sin(t * 4.0)
			draw_colored_polygon(_hex(c, r * (1.18 + pulse * 0.08)), Color(1, 0.5, 0.15, 0.25 + pulse * 0.2))
		draw_colored_polygon(_hex(c, r), col.darkened(0.15) if not sel else col.lightened(0.25))
		var ring := _hex(c, r)
		ring.append(ring[0])
		draw_polyline(ring, Kit.POD if sel else Color(1, 1, 1, 0.25), (3.0 if sel else 1.2) * sc, true)
		var fs := int(max(8.0, (13.0 if r > 20 else 10.0) * sc * (1.0 if r > 14 else 0.85)))
		var maxc: int = max(4, int(r * 2.1 / (fs * 0.56)))
		var nm: String = str(tl.name)
		if nm.length() > maxc:
			nm = nm.substr(0, maxc - 1) + "."
		var tw := font.get_string_size(nm, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
		draw_string(font, c + Vector2(-tw / 2.0, fs * 0.35), nm, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color.WHITE)
		if humans > 0:
			var badge := c + Vector2(r * 0.62, -r * 0.62)
			draw_circle(badge, 9.0 * max(sc, 0.8), Kit.POD)
			var ns := str(humans)
			var bs := int(max(9.0, 11.0 * sc))
			var bw := font.get_string_size(ns, HORIZONTAL_ALIGNMENT_LEFT, -1, bs).x
			draw_string(font, badge + Vector2(-bw / 2.0, bs * 0.35), ns, HORIZONTAL_ALIGNMENT_LEFT, -1, bs, Color("#1a0d02"))
