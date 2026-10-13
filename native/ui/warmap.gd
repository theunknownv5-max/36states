extends Control
## The war map: Nigeria's outline and a hex tile for every state (zone colours), glowing where
## battles are live. Tap a state to pick it.

signal picked(state_id: String)

const ZONE_COL := {"NC": Color("#2f7a4c"), "NE": Color("#8a6a24"), "NW": Color("#9a5426"), "SE": Color("#22707e"), "SS": Color("#28588e"), "SW": Color("#6a4890")}
const OUTLINE := [
	[2.69, 6.37], [2.72, 7.1], [2.76, 7.9], [2.85, 8.6], [3.12, 9.1], [3.58, 9.95], [3.65, 10.45], [3.58, 11.1],
	[3.62, 11.7], [3.85, 12.3], [4.1, 13.05], [4.4, 13.65], [5.0, 13.8], [5.6, 13.86], [6.2, 13.65], [6.75, 13.3],
	[7.45, 13.1], [8.1, 13.02], [8.65, 12.92], [9.25, 12.83], [9.85, 13.15], [10.6, 13.35], [11.4, 13.37], [12.2, 13.2],
	[12.85, 13.5], [13.35, 13.72], [13.65, 13.3], [14.1, 13.05], [14.2, 12.45], [14.58, 12.12], [14.35, 11.5], [13.9, 11.0],
	[13.55, 10.65], [13.25, 10.1], [13.2, 9.55], [12.95, 9.0], [12.75, 8.55], [12.25, 8.25], [12.0, 7.65], [11.75, 7.15],
	[11.3, 6.6], [11.05, 6.45], [10.7, 6.95], [10.25, 6.9], [9.75, 6.55], [9.3, 6.4], [8.85, 5.85], [8.62, 5.05],
	[8.5, 4.65], [8.25, 4.55], [7.55, 4.45], [7.05, 4.4], [6.55, 4.3], [6.05, 4.28], [5.6, 4.6], [5.4, 5.1],
	[5.1, 5.55], [4.75, 6.05], [4.3, 6.25], [3.75, 6.42], [3.35, 6.4], [2.69, 6.37]
]
const RIVERS := [
	[[3.6, 11.7], [4.6, 10.6], [5.5, 9.4], [6.2, 8.9], [6.75, 7.8], [6.7, 6.9], [6.45, 5.8], [6.3, 4.9]],
	[[12.4, 9.3], [11.2, 9.0], [9.8, 8.4], [8.6, 7.75], [7.5, 7.75], [6.75, 7.8]],
]
const W := 1000.0
const H := 860.0
const R := 30.0

var tiles: Array = []   # {id, x, y, zone, name}
var selected := ""
var live := {}          # id -> lobby entry
var t := 0.0
var font: Font

func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
	font = Kit.font_bold
	_layout()

func _project(lon: float, lat: float) -> Vector2:
	var minLon := 2.5
	var maxLon := 14.8
	var minLat := 4.1
	var maxLat := 14.0
	var pad := 40.0
	var s: float = min((W - pad * 2) / (maxLon - minLon), (H - pad * 2) / (maxLat - minLat))
	var ox := (W - (maxLon - minLon) * s) / 2.0
	var oy := (H - (maxLat - minLat) * s) / 2.0
	return Vector2(ox + (lon - minLon) * s, oy + (maxLat - lat) * s)

## Spread tiles so neighbours don't overlap, keeping them near their real spot (as the lite app).
func _layout() -> void:
	tiles.clear()
	for s in Cfg.rules.get("STATES", []):
		var p := _project(float(s.lon), float(s.lat))
		tiles.append({"id": s.id, "name": s.name, "zone": s.zone, "x": p.x, "y": p.y, "hx": p.x, "hy": p.y})
	var mind := R * 1.86
	for it in 220:
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
	var pos := Vector2.ZERO
	var tap := false
	if e is InputEventMouseButton and e.pressed and e.button_index == MOUSE_BUTTON_LEFT:
		pos = e.position
		tap = true
	if not tap:
		return
	var x := _xf()
	var best := ""
	var bd := 1e9
	for tl in tiles:
		var sp: Vector2 = Vector2(tl.x, tl.y) * x[0] + x[1]
		var d := sp.distance_to(pos)
		if d < bd and d < R * x[0] * 1.3:
			bd = d
			best = tl.id
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
	var x := _xf()
	var sc: float = x[0]
	# Country outline with a glow.
	var outline := PackedVector2Array()
	for p in OUTLINE:
		outline.append(_to_screen(_project(p[0], p[1])))
	draw_colored_polygon(outline, Color(1, 0.48, 0.1, 0.06))
	for w in [8.0, 4.0]:
		draw_polyline(outline, Color(1, 0.59, 0.24, 0.12 if w > 5 else 0.55), w * sc, true)
	for rv in RIVERS:
		var pl := PackedVector2Array()
		for p in rv:
			pl.append(_to_screen(_project(p[0], p[1])))
		draw_polyline(pl, Color(0.31, 0.63, 0.86, 0.35), 3.0 * sc, true)
	# State tiles.
	for tl in tiles:
		var c := _to_screen(Vector2(tl.x, tl.y))
		var r := R * sc
		var col: Color = ZONE_COL.get(tl.zone, Color.GRAY)
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
		var nm: String = tl.name
		if nm.length() > 9:
			nm = nm.substr(0, 8) + "."
		var fs := int(max(9.0, 13.0 * sc))
		var tw := font.get_string_size(nm, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
		draw_string(font, c + Vector2(-tw / 2.0, fs * 0.35), nm, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color.WHITE)
		if humans > 0:
			var badge := c + Vector2(r * 0.62, -r * 0.62)
			draw_circle(badge, 9.0 * max(sc, 0.8), Kit.POD)
			var ns := str(humans)
			var bs := int(max(9.0, 11.0 * sc))
			var bw := font.get_string_size(ns, HORIZONTAL_ALIGNMENT_LEFT, -1, bs).x
			draw_string(font, badge + Vector2(-bw / 2.0, bs * 0.35), ns, HORIZONTAL_ALIGNMENT_LEFT, -1, bs, Color("#1a0d02"))
