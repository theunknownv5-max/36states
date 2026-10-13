class_name Phys
extends RefCounted
## Collision and ballistics, a line-for-line port of shared/physics.js so the native app moves
## and aims exactly like the server expects. The world is a list of axis-aligned boxes in a grid.

const CELL := 8.0

var boxes: Array = []      # Array of Dictionary {x0,y0,z0,x1,y1,z1,kind,...}
var cells := {}            # int key -> PackedInt32Array
var half := 110.0
var holes: Array = []
var stamp := PackedInt32Array()
var frame := 1
var water: Array = []
var P := {}                # PLAYER rules

func _init(map: Dictionary, player: Dictionary) -> void:
	boxes = map.get("boxes", [])
	half = float(map.get("half", 110))
	holes = map.get("holes", [])
	water = map.get("water", [])
	P = player
	for i in boxes.size():
		var b: Dictionary = boxes[i]
		for k in ["x0", "y0", "z0", "x1", "y1", "z1"]:
			b[k] = float(b[k])
	stamp.resize(boxes.size())
	for i in boxes.size():
		_insert(i)

func _key(cx: int, cz: int) -> int:
	return cx * 100000 + cz

func _insert(i: int) -> void:
	var b: Dictionary = boxes[i]
	var cx0 := int(floor((b.x0 + half) / CELL))
	var cx1 := int(floor((b.x1 + half) / CELL))
	var cz0 := int(floor((b.z0 + half) / CELL))
	var cz1 := int(floor((b.z1 + half) / CELL))
	for cx in range(cx0, cx1 + 1):
		for cz in range(cz0, cz1 + 1):
			var k := _key(cx, cz)
			if not cells.has(k):
				cells[k] = PackedInt32Array()
			var arr: PackedInt32Array = cells[k]
			arr.append(i)
			cells[k] = arr

func _remove(i: int) -> void:
	var b: Dictionary = boxes[i]
	var cx0 := int(floor((b.x0 + half) / CELL))
	var cx1 := int(floor((b.x1 + half) / CELL))
	var cz0 := int(floor((b.z0 + half) / CELL))
	var cz1 := int(floor((b.z1 + half) / CELL))
	for cx in range(cx0, cx1 + 1):
		for cz in range(cz0, cz1 + 1):
			var k := _key(cx, cz)
			if cells.has(k):
				var arr: PackedInt32Array = cells[k]
				var j := arr.find(i)
				if j >= 0:
					arr.remove_at(j)
					cells[k] = arr

## Vehicles drive, so their boxes move.
func move_box(i: int, x0: float, z0: float, x1: float, z1: float) -> void:
	if i < 0 or i >= boxes.size():
		return
	_remove(i)
	var b: Dictionary = boxes[i]
	b.x0 = x0
	b.z0 = z0
	b.x1 = x1
	b.z1 = z1
	_insert(i)

func hole_at(x: float, z: float) -> bool:
	for h in holes:
		if x > h.x0 and x < h.x1 and z > h.z0 and z < h.z1:
			return true
	return false

func in_water(x: float, z: float) -> bool:
	for w in water:
		if x > w.x0 and x < w.x1 and z > w.z0 and z < w.z1:
			return true
	return false

## Indices of boxes overlapping an xz rectangle.
func query(x0: float, z0: float, x1: float, z1: float) -> PackedInt32Array:
	var out := PackedInt32Array()
	frame += 1
	var cx0 := int(floor((x0 + half) / CELL))
	var cx1 := int(floor((x1 + half) / CELL))
	var cz0 := int(floor((z0 + half) / CELL))
	var cz1 := int(floor((z1 + half) / CELL))
	for cx in range(cx0, cx1 + 1):
		for cz in range(cz0, cz1 + 1):
			var arr = cells.get(_key(cx, cz))
			if arr == null:
				continue
			for i in arr:
				if stamp[i] == frame:
					continue
				stamp[i] = frame
				out.append(i)
	return out

## Slab test. Returns Vector2(tEnter, tExit) or Vector2(-1, -1) for a miss.
static func ray_box(o: Vector3, d: Vector3, b: Dictionary) -> Vector2:
	var tmin := -INF
	var tmax := INF
	var lo := [b.x0, b.y0, b.z0]
	var hi := [b.x1, b.y1, b.z1]
	for a in 3:
		var oa: float = o[a]
		var da: float = d[a]
		if absf(da) < 1e-9:
			if oa < lo[a] or oa > hi[a]:
				return Vector2(-1, -1)
		else:
			var t1: float = (lo[a] - oa) / da
			var t2: float = (hi[a] - oa) / da
			if t1 > t2:
				var tt := t1
				t1 = t2
				t2 = tt
			tmin = max(tmin, t1)
			tmax = min(tmax, t2)
			if tmin > tmax:
				return Vector2(-1, -1)
	if tmax < 0:
		return Vector2(-1, -1)
	return Vector2(max(0.0, tmin), tmax)

## First world hit along a ray (boxes + ground). Returns {t, box (-1 none, -2 ground), exit}.
func raycast(o: Vector3, d: Vector3, max_t: float, ignore := -1) -> Dictionary:
	var best := max_t
	var hit_box := -1
	var exit_t := 0.0
	if d.y < -1e-6:
		var tg := -o.y / d.y
		if tg >= 0 and tg < best and not hole_at(o.x + d.x * tg, o.z + d.z * tg):
			best = tg
			hit_box = -2
	var steps := int(ceil(min(max_t, best) / (CELL * 0.5))) + 1
	var seen := {}
	for s in range(0, steps + 1):
		var t: float = min(s * CELL * 0.5, best)
		var px := o.x + d.x * t
		var pz := o.z + d.z * t
		for i in query(px - CELL * 0.5, pz - CELL * 0.5, px + CELL * 0.5, pz + CELL * 0.5):
			if seen.has(i) or i == ignore:
				continue
			seen[i] = true
			var r := ray_box(o, d, boxes[i])
			if r.x >= 0 and r.x < best:
				best = r.x
				hit_box = i
				exit_t = r.y
		if t >= best:
			break
	return {"t": best, "box": hit_box, "exit": exit_t}

static func _ray_cyl(o: Vector3, d: Vector3, cx: float, cz: float, r: float, y0: float, y1: float) -> float:
	var fx := o.x - cx
	var fz := o.z - cz
	var a := d.x * d.x + d.z * d.z
	if a < 1e-9:
		return -1.0
	var b := fx * d.x + fz * d.z
	var c := fx * fx + fz * fz - r * r
	var disc := b * b - a * c
	if disc < 0:
		return -1.0
	var sq := sqrt(disc)
	for t in [(-b - sq) / a, (-b + sq) / a]:
		if t < 0:
			continue
		var y: float = o.y + d.y * t
		if y >= y0 and y <= y1:
			return t
	return -1.0

static func _ray_sphere(o: Vector3, d: Vector3, c: Vector3, r: float) -> float:
	var f := o - c
	var b := f.dot(d)
	var cc := f.dot(f) - r * r
	var disc := b * b - cc
	if disc < 0:
		return -1.0
	var t := -b - sqrt(disc)
	return t if t >= 0 else -1.0

## Hit test against a soldier standing at p. Returns {t, zone} or {} for a miss.
static func hit_soldier(o: Vector3, d: Vector3, p: Vector3, crouch: bool, downed: bool) -> Dictionary:
	if downed:
		var t := _ray_cyl(o, d, p.x, p.z, 0.75, p.y, p.y + 0.4)
		return {} if t < 0 else {"t": t, "zone": "body"}
	var head_y := p.y + (1.12 if crouch else 1.62)
	var body_top := p.y + (1.0 if crouch else 1.48)
	var leg_top := p.y + (0.45 if crouch else 0.85)
	var th := _ray_sphere(o, d, Vector3(p.x, head_y, p.z), 0.15)
	var tb := _ray_cyl(o, d, p.x, p.z, 0.28, p.y, body_top)
	if th >= 0 and (tb < 0 or th <= tb + 0.05):
		return {"t": th, "zone": "head"}
	if tb >= 0:
		return {"t": tb, "zone": "leg" if o.y + d.y * tb < leg_top else "body"}
	return {}

func line_blocked(a: Vector3, b: Vector3) -> bool:
	var dv := b - a
	var l := dv.length()
	if l < 1e-4:
		return false
	var hit := raycast(a, dv / l, l)
	return hit.t < l - 0.05

func _overlapping(x: float, y: float, z: float, h: float) -> Array:
	var r: float = P.radius
	var hits: Array = []
	for i in query(x - r, z - r, x + r, z + r):
		var b: Dictionary = boxes[i]
		if x + r > b.x0 and x - r < b.x1 and z + r > b.z0 and z - r < b.z1 and y + h > b.y0 and y < b.y1:
			hits.append(b)
	return hits

## Moves a soldier body through the world: walls, steps, gravity, jumping.
## body: {x, y, z, vy, on_ground, crouch}
func move_body(body: Dictionary, wish_x: float, wish_z: float, dt: float, jump := false) -> void:
	var r: float = P.radius
	var h: float = P.crouchHeight if body.crouch else P.height
	var step_up: float = P.stepUp
	var try_axis := func(axis: int, delta: float) -> void:
		if delta == 0.0:
			return
		var nx: float = body.x + delta if axis == 0 else body.x
		var nz: float = body.z + delta if axis == 1 else body.z
		var hits := _overlapping(nx, body.y, nz, h)
		if hits.is_empty():
			body.x = nx
			body.z = nz
			return
		var top := -INF
		for b in hits:
			top = max(top, b.y1)
		if body.on_ground and top - body.y <= step_up and _overlapping(nx, top + 0.01, nz, h).is_empty():
			body.x = nx
			body.z = nz
			body.y = top
			return
		var pos: float = body.x if axis == 0 else body.z
		for b in hits:
			if axis == 0:
				pos = min(pos, b.x0 - r - 1e-4) if delta > 0 else max(pos, b.x1 + r + 1e-4)
			else:
				pos = min(pos, b.z0 - r - 1e-4) if delta > 0 else max(pos, b.z1 + r + 1e-4)
		if axis == 0:
			body.x = pos
		else:
			body.z = pos
	var dist := Vector2(wish_x, wish_z).length() * dt
	var steps: int = max(1, int(ceil(dist / 0.25)))
	for s in steps:
		try_axis.call(0, wish_x * dt / steps)
		try_axis.call(1, wish_z * dt / steps)
	if jump and body.on_ground:
		body.vy = P.jump
		body.on_ground = false
	body.vy -= float(P.gravity) * dt
	var ny: float = body.y + body.vy * dt
	var hits := _overlapping(body.x, ny, body.z, h)
	if body.vy <= 0:
		var floor_y := -60.0 if hole_at(body.x, body.z) else 0.0
		for b in hits:
			if b.y1 <= body.y + 0.05 + step_up:
				floor_y = max(floor_y, b.y1)
		for i in query(body.x - r, body.z - r, body.x + r, body.z + r):
			var b: Dictionary = boxes[i]
			if body.x + r > b.x0 and body.x - r < b.x1 and body.z + r > b.z0 and body.z - r < b.z1 and b.y1 <= body.y + 0.05 and b.y1 > floor_y:
				floor_y = b.y1
		if ny <= floor_y:
			ny = floor_y
			body.vy = 0.0
			body.on_ground = true
		else:
			body.on_ground = false
	elif not hits.is_empty():
		var ceil_y := INF
		for b in hits:
			ceil_y = min(ceil_y, b.y0)
		ny = ceil_y - h - 1e-3
		body.vy = 0.0
	body.y = ny
	var lim := half - 1.5
	body.x = clamp(body.x, -lim, lim)
	body.z = clamp(body.z, -lim, lim)

func inside_any_box(x: float, y: float, z: float, crouch := false) -> bool:
	var r: float = P.radius * 0.8
	var h: float = P.crouchHeight if crouch else P.height
	for i in query(x - r, z - r, x + r, z + r):
		var b: Dictionary = boxes[i]
		if b.has("veh"):
			continue
		if x + r > b.x0 and x - r < b.x1 and z + r > b.z0 and z - r < b.z1 and y + h - 0.1 > b.y0 and y + 0.1 < b.y1:
			return true
	return false

## Direction from yaw/pitch (yaw 0 looks toward -z, like the lite app's camera).
static func dir_from_angles(yaw: float, pitch: float) -> Vector3:
	var cp := cos(pitch)
	return Vector3(-sin(yaw) * cp, sin(pitch), -cos(yaw) * cp)

## Random direction inside a cone around d.
static func spread_dir(d: Vector3, angle: float) -> Vector3:
	if angle <= 0:
		return d
	var up := Vector3(1, 0, 0) if absf(d.y) > 0.95 else Vector3(0, 1, 0)
	var u := up.cross(d).normalized()
	var v := d.cross(u)
	var a := randf() * TAU
	var r := sqrt(randf()) * tan(angle)
	return (d + (u * cos(a) + v * sin(a)) * r).normalized()

func surface_at(x: float, y: float, z: float, biome: String) -> String:
	if y < 0.1 and in_water(x, z):
		return "water"
	if y > 0.05:
		for i in query(x - 0.2, z - 0.2, x + 0.2, z + 0.2):
			var b: Dictionary = boxes[i]
			if absf(b.y1 - y) < 0.12 and x > b.x0 and x < b.x1 and z > b.z0 and z < b.z1:
				var k: String = b.get("kind", "")
				if k in ["plank", "bridge", "crate", "stall"]:
					return "wood"
				if k in ["metal", "zinc", "container", "tank", "pipe", "wreck", "drum"]:
					return "metal"
				if k == "sandbag":
					return "sand"
				return "concrete"
	return {"sahel": "sand", "savanna": "dirt", "plateau": "gravel", "rainforest": "dirt", "creeks": "mud", "urban": "concrete"}.get(biome, "dirt")
