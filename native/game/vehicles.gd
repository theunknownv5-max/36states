class_name Vehicles
extends Node3D
## Cars, jeeps, Hilux pickups, danfo buses, kekes, okadas, lorries and the armoured carrier:
## their models, where they are (from the server), fire and charred wrecks, and the arcade
## driving physics (a port of shared/vehicles.js) for the one you drive.

var phys: Phys
var defs := {}
var list: Array = []        # {i, type, x, z, yaw, state, driver, box, node, buf, speed, fire}
var charred: StandardMaterial3D

func setup(map: Dictionary, p: Phys) -> void:
	phys = p
	defs = Cfg.rules.get("VEHICLES", {})
	charred = World.flat(Color(0.08, 0.07, 0.065), 0.95)
	for v in map.get("vehicles", []):
		var e := {"i": int(v.i), "type": str(v.type), "x": float(v.x), "z": float(v.z), "yaw": float(v.yaw), "state": 0, "driver": 0, "box": int(v.get("box", -1)), "buf": [], "speed": 0.0, "colour": str(v.get("colour", "#888888"))}
		e.node = _model(e.type, Color(e.colour))
		add_child(e.node)
		list.append(e)
		_place(e)

func def(type: String) -> Dictionary:
	return defs.get(type, {"L": 4.6, "W": 1.8, "H": 1.45, "top": 20, "accel": 8, "brake": 15, "turn": 1.8, "seatY": 0.4, "eye": 1.2})

func _model(type: String, col: Color) -> Node3D:
	var d := def(type)
	var L: float = d.L
	var W: float = d.W
	var H: float = d.H
	var root := Node3D.new()
	var paint := World.flat(col, 0.35, 0.4)
	var glass := World.flat(Color(0.12, 0.16, 0.2), 0.08, 0.6)
	var tyre := World.flat(Color(0.08, 0.08, 0.08), 0.9)
	var add := func(size: Vector3, pos: Vector3, m: Material) -> void:
		var mi := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = size
		mi.mesh = bm
		mi.material_override = m
		mi.position = pos
		root.add_child(mi)
	match type:
		"okada":
			add.call(Vector3(0.25, 0.35, 1.3), Vector3(0, 0.55, 0), paint)
			add.call(Vector3(0.3, 0.12, 0.7), Vector3(0, 0.8, 0.15), World.flat(Color(0.1, 0.1, 0.1), 0.8))
			add.call(Vector3(0.7, 0.05, 0.05), Vector3(0, 1.0, -0.55), tyre)
		"keke":
			add.call(Vector3(W, 0.5, L), Vector3(0, 0.55, 0), paint)
			add.call(Vector3(W * 0.95, 0.08, L * 0.85), Vector3(0, H, 0.1), World.flat(Color(0.1, 0.1, 0.1), 0.8))
			add.call(Vector3(W * 0.9, 0.7, 0.06), Vector3(0, 1.15, -L * 0.38), glass)
		"lorry":
			add.call(Vector3(W, 1.9, 2.0), Vector3(0, 1.45, -L / 2.0 + 1.0), paint)
			add.call(Vector3(W * 0.95, 0.6, 0.05), Vector3(0, 1.9, -L / 2.0 - 0.01), glass)
			add.call(Vector3(W, 1.9, L - 2.3), Vector3(0, 1.85, 1.15), World.flat(Color("#6b5a40"), 0.9))
			add.call(Vector3(W * 0.9, 0.3, L), Vector3(0, 0.55, 0), World.flat(Color(0.12, 0.12, 0.12), 0.8))
		"danfo":
			add.call(Vector3(W, H - 0.45, L), Vector3(0, 0.45 + (H - 0.45) / 2.0, 0), paint)
			add.call(Vector3(W + 0.02, 0.12, L + 0.02), Vector3(0, 1.0, 0), World.flat(Color(0.05, 0.05, 0.05), 0.6))
			add.call(Vector3(W + 0.02, 0.5, L * 0.8), Vector3(0, 1.55, 0.2), glass)
			add.call(Vector3(W * 0.9, 0.6, 0.05), Vector3(0, 1.5, -L / 2.0 - 0.01), glass)
		"apc":
			add.call(Vector3(W, H * 0.6, L), Vector3(0, 0.5 + H * 0.3, 0), paint)
			add.call(Vector3(W * 0.8, 0.3, L * 0.7), Vector3(0, 0.5 + H * 0.6 + 0.15, 0.2), paint)
			add.call(Vector3(0.9, 0.45, 0.9), Vector3(0, H + 0.1, 0.4), paint)
			add.call(Vector3(0.12, 0.12, 1.4), Vector3(0, H + 0.2, -0.4), World.flat(Color(0.15, 0.15, 0.15), 0.5, 0.7))
		_:
			var low := 0.4
			add.call(Vector3(W, H * 0.45, L), Vector3(0, low + H * 0.22, 0), paint)
			var cab_l: float = L * (0.5 if type != "pickup" else 0.4)
			var cab_z: float = -0.1 if type != "pickup" else -L * 0.12
			add.call(Vector3(W * 0.92, H * 0.38, cab_l), Vector3(0, low + H * 0.45 + H * 0.19, cab_z), paint)
			add.call(Vector3(W * 0.94, H * 0.3, cab_l * 0.96), Vector3(0, low + H * 0.45 + H * 0.17, cab_z), glass)
	# Wheels.
	var wheels := int(d.get("wheels", 4))
	var wr := 0.33 if type != "lorry" and type != "apc" else 0.5
	var cm := CylinderMesh.new()
	cm.top_radius = wr
	cm.bottom_radius = wr
	cm.height = 0.25
	cm.radial_segments = 12
	var spots: Array = []
	if wheels == 2:
		spots = [Vector3(0, wr, -L * 0.38), Vector3(0, wr, L * 0.38)]
	elif wheels == 3:
		spots = [Vector3(0, wr, -L * 0.4), Vector3(-W * 0.45, wr, L * 0.3), Vector3(W * 0.45, wr, L * 0.3)]
	else:
		var axles := [-L * 0.32, L * 0.32] if wheels == 4 else [-L * 0.35, L * 0.15, L * 0.38]
		for z in axles:
			spots.append(Vector3(-W / 2.0, wr, z))
			spots.append(Vector3(W / 2.0, wr, z))
	for s in spots:
		var w := MeshInstance3D.new()
		w.mesh = cm
		w.material_override = tyre
		w.position = s
		w.rotation.z = PI / 2.0
		root.add_child(w)
	return root

func _place(e: Dictionary) -> void:
	e.node.position = Vector3(e.x, 0, e.z)
	e.node.rotation.y = e.yaw
	_move_box(e)

static func footprint(d: Dictionary, x: float, z: float, yaw: float) -> Array:
	var s := absf(sin(yaw))
	var c := absf(cos(yaw))
	var hx: float = s * d.L / 2.0 + c * d.W / 2.0
	var hz: float = c * d.L / 2.0 + s * d.W / 2.0
	return [x - hx, z - hz, x + hx, z + hz]

func _move_box(e: Dictionary) -> void:
	if e.box < 0:
		return
	var f := footprint(def(e.type), e.x, e.z, e.yaw)
	phys.move_box(e.box, f[0], f[1], f[2], f[3])

## Where every vehicle is when you join (or a new round starts): [i, x, z, yaw, state, driver].
func apply_view(v: Array) -> void:
	for row in v:
		var e = by_index(int(row[0]))
		if e == null:
			continue
		e.x = float(row[1])
		e.z = float(row[2])
		e.yaw = float(row[3])
		set_state(e.i, int(row[4]))
		e.driver = row[5]
		e.buf.clear()
		_place(e)

func by_index(i: int):
	for e in list:
		if e.i == i:
			return e
	return null

## 20 Hz moving vehicles: [i, x, z, yaw, speed].
func on_snapshot(vh: Array, ts: float, mine: int) -> void:
	for row in vh:
		var i := int(row[0])
		if i == mine:
			continue
		var e = by_index(i)
		if e == null:
			continue
		e.buf.append([ts, float(row[1]), float(row[2]), float(row[3]), float(row[4])])
		if e.buf.size() > 20:
			e.buf.pop_front()

func set_state(i: int, s: int) -> void:
	var e = by_index(i)
	if e == null or e.state == s:
		return
	e.state = s
	if s >= 2:
		for mi in e.node.find_children("*", "MeshInstance3D", true, false):
			mi.material_override = charred
	if s == 1 or s == 2:
		if not e.has("fire"):
			var f := _fire()
			e.node.add_child(f)
			e.fire = f
	if s == 3 and e.has("fire"):
		e.fire.queue_free()
		e.erase("fire")
	# Crushed by a lorry: flattened.
	if s == 4:
		e.node.scale = Vector3(1.05, 0.3, 1.0)
		Sfx.play("explosion_far", e.node.global_position, {"ref": 6.0})

func _fire() -> GPUParticles3D:
	var f := GPUParticles3D.new()
	f.amount = 30
	f.lifetime = 1.6
	f.position = Vector3(0, 1.2, -0.8)
	var pm := ParticleProcessMaterial.new()
	pm.direction = Vector3(0, 1, 0)
	pm.spread = 15.0
	pm.initial_velocity_min = 1.5
	pm.initial_velocity_max = 3.0
	pm.gravity = Vector3(0, 1.5, 0)
	pm.scale_min = 0.8
	pm.scale_max = 2.0
	var grad := Gradient.new()
	grad.set_color(0, Color(1, 0.7, 0.25, 1))
	grad.add_point(0.35, Color(0.9, 0.3, 0.05, 0.8))
	grad.set_color(1, Color(0.1, 0.1, 0.1, 0))
	var gt := GradientTexture1D.new()
	gt.gradient = grad
	pm.color_ramp = gt
	f.process_material = pm
	var q := QuadMesh.new()
	q.size = Vector2(1, 1)
	var mm := StandardMaterial3D.new()
	mm.vertex_color_use_as_albedo = true
	mm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mm.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	mm.albedo_texture = Fx.soft_dot()
	q.material = mm
	f.draw_pass_1 = q
	return f

func update(dt: float, render_ts: float, mine: int) -> void:
	for e in list:
		if e.i == mine or e.buf.is_empty():
			continue
		var a: Array = e.buf[0]
		var b: Array = e.buf[e.buf.size() - 1]
		for k in range(e.buf.size() - 1):
			if e.buf[k][0] <= render_ts and e.buf[k + 1][0] >= render_ts:
				a = e.buf[k]
				b = e.buf[k + 1]
				break
		var f := 1.0
		if b[0] > a[0]:
			f = clamp((render_ts - a[0]) / (b[0] - a[0]), 0.0, 1.0)
		e.x = lerp(a[1], b[1], f)
		e.z = lerp(a[2], b[2], f)
		e.yaw = lerp_angle(a[3], b[3], f)
		e.speed = b[4]
		_place(e)

## The nearest vehicle you could get into.
func nearest(x: float, z: float, reach := 3.2):
	var best = null
	var bd := 1e9
	for e in list:
		if e.state >= 2 or (e.driver and str(e.driver) != "" and str(e.driver) != "0"):
			continue
		var d := def(e.type)
		var dist := Vector2(e.x - x, e.z - z).length() - float(d.L) / 2.0
		if dist < reach and dist < bd:
			bd = dist
			best = e
	return best

# ---------- driving physics (port of shared/vehicles.js) ----------
func blocked(type: String, x: float, z: float, yaw: float, self_box: int) -> bool:
	var d := def(type)
	var fx := -sin(yaw)
	var fz := -cos(yaw)
	var r: float = max(0.2, d.W / 2.0 * 0.95)
	var reach: float = max(0.0, d.L / 2.0 - d.W / 2.0)
	var n: int = max(2, int(ceil(d.L / d.W)) + 1)
	for k in n:
		var t := -reach + 2.0 * reach * k / (n - 1)
		var cx := x + fx * t
		var cz := z + fz * t
		for i in phys.query(cx - r, cz - r, cx + r, cz + r):
			if i == self_box:
				continue
			var b: Dictionary = phys.boxes[i]
			if b.y1 <= 0.5 or b.y0 >= 1.5:
				continue
			var ex: float = max(max(b.x0 - cx, 0.0), cx - b.x1)
			var ez: float = max(max(b.z0 - cz, 0.0), cz - b.z1)
			if ex * ex + ez * ez < r * r:
				return true
	return false

func drive_step(v: Dictionary, throttle: float, steer: float, brake: bool, dt: float) -> float:
	var d := def(v.type)
	var acc := 0.0
	if throttle > 0.05:
		acc = d.brake if v.speed < -0.5 else d.accel * throttle * (1.0 - max(0.0, v.speed) / d.top * 0.55)
	elif throttle < -0.05:
		acc = -d.brake if v.speed > 0.5 else -d.accel * 0.6 * -throttle
	v.speed += acc * dt
	var coasting: bool = absf(throttle) < 0.05 or sign(throttle) != sign(v.speed)
	var drag: float = (2.4 if coasting else 0.0) + 0.01 * v.speed * v.speed + (d.brake * 1.2 if brake else 0.0)
	v.speed -= sign(v.speed) * min(absf(v.speed), drag * dt)
	var slow := 0.3 if phys.in_water(v.x, v.z) else 1.0
	v.speed = clamp(v.speed, -d.top * 0.35 * slow, d.top * slow)
	var grip: float = min(1.0, absf(v.speed) / 4.0)
	var rate: float = steer * d.turn * grip * (1.0 - 0.45 * min(1.0, absf(v.speed) / d.top))
	var old_yaw: float = v.yaw
	v.yaw -= rate * (sign(v.speed) if v.speed != 0 else 1.0) * dt
	if blocked(v.type, v.x, v.z, v.yaw, v.box):
		v.yaw = old_yaw
	var dist: float = v.speed * dt
	var steps: int = max(1, int(ceil(absf(dist) / 0.3)))
	var fx := -sin(v.yaw)
	var fz := -cos(v.yaw)
	var impact := 0.0
	for s in steps:
		var nx: float = v.x + fx * dist / steps
		var nz: float = v.z + fz * dist / steps
		if blocked(v.type, nx, nz, v.yaw, v.box):
			impact = absf(v.speed)
			v.speed = -v.speed * 0.2
			break
		v.x = nx
		v.z = nz
	var lim: float = phys.half - 2.0 - d.L / 2.0
	if absf(v.x) > lim or absf(v.z) > lim:
		v.x = clamp(v.x, -lim, lim)
		v.z = clamp(v.z, -lim, lim)
		impact = max(impact, absf(v.speed))
		v.speed = 0.0
	return impact
