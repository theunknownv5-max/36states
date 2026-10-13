class_name Fx
extends Node3D
## Battle effects: tracers, muzzle flashes, impact dust and sparks, blood, explosions with fire
## and smoke, smoke-grenade clouds, and camera shake. Particles are drawn with two MultiMeshes
## (soft smoke, glowing fire/sparks) updated here, so hundreds cost almost nothing.

const MAX_SOFT := 700
const MAX_GLOW := 400
const MAX_TRACERS := 48

static var _dot: Texture2D

var soft: MultiMeshInstance3D
var glowp: MultiMeshInstance3D
var tracer_mm: MultiMeshInstance3D
var parts_soft: Array = []   # [pos, vel, life, max, size0, size1, color, grav, drag]
var parts_glow: Array = []
var tracers: Array = []      # [a, b, life]
var flash_light: OmniLight3D
var flash_t := 0.0
var boom_lights: Array = []
var shake := 0.0
var cam: Camera3D

static func soft_dot() -> Texture2D:
	if _dot:
		return _dot
	var g := Gradient.new()
	g.set_color(0, Color(1, 1, 1, 1))
	g.set_color(1, Color(1, 1, 1, 0))
	g.add_point(0.5, Color(1, 1, 1, 0.55))
	var t := GradientTexture2D.new()
	t.gradient = g
	t.fill = GradientTexture2D.FILL_RADIAL
	t.fill_from = Vector2(0.5, 0.5)
	t.fill_to = Vector2(1.0, 0.5)
	t.width = 64
	t.height = 64
	_dot = t
	return t

func _mm(count: int, additive: bool) -> MultiMeshInstance3D:
	var q := QuadMesh.new()
	q.size = Vector2(1, 1)
	var m := StandardMaterial3D.new()
	m.albedo_texture = soft_dot()
	m.vertex_color_use_as_albedo = true
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	m.billboard_keep_scale = true
	m.no_depth_test = false
	m.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
	if additive:
		m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	q.material = m
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.mesh = q
	mm.instance_count = count
	mm.visible_instance_count = 0
	var mi := MultiMeshInstance3D.new()
	mi.multimesh = mm
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.custom_aabb = AABB(Vector3(-400, -100, -400), Vector3(800, 300, 800))
	add_child(mi)
	return mi

func _ready() -> void:
	soft = _mm(MAX_SOFT, false)
	glowp = _mm(MAX_GLOW, true)
	# Tracers: thin glowing boxes stretched along the shot.
	var bm := BoxMesh.new()
	bm.size = Vector3(0.025, 0.025, 1.0)
	var tm := StandardMaterial3D.new()
	tm.albedo_color = Color(1.0, 0.85, 0.45, 0.9)
	tm.vertex_color_use_as_albedo = true
	tm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	tm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	tm.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	bm.material = tm
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.mesh = bm
	mm.instance_count = MAX_TRACERS
	mm.visible_instance_count = 0
	tracer_mm = MultiMeshInstance3D.new()
	tracer_mm.multimesh = mm
	tracer_mm.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	tracer_mm.custom_aabb = AABB(Vector3(-400, -100, -400), Vector3(800, 300, 800))
	add_child(tracer_mm)
	flash_light = OmniLight3D.new()
	flash_light.light_color = Color(1, 0.75, 0.4)
	flash_light.omni_range = 7.0
	flash_light.light_energy = 0.0
	flash_light.shadow_enabled = false
	add_child(flash_light)
	for i in 2:
		var l := OmniLight3D.new()
		l.light_color = Color(1, 0.6, 0.25)
		l.omni_range = 18.0
		l.light_energy = 0.0
		add_child(l)
		boom_lights.append([l, 0.0])

func _add(list: Array, cap: int, p: Vector3, v: Vector3, life: float, s0: float, s1: float, col: Color, grav := 0.0, drag := 0.0) -> void:
	if list.size() >= cap:
		list.pop_front()
	list.append([p, v, 0.0, life, s0, s1, col, grav, drag])

func puff(p: Vector3, col: Color, size := 0.4, life := 0.8, v := Vector3.ZERO, grav := 0.0, grow := 2.0) -> void:
	_add(parts_soft, MAX_SOFT, p, v, life, size, size * grow, col, grav, 1.5)

func spark(p: Vector3, col: Color, size := 0.15, life := 0.3, v := Vector3.ZERO, grav := 9.0) -> void:
	_add(parts_glow, MAX_GLOW, p, v, life, size, size * 0.3, col, grav, 0.5)

func tracer(a: Vector3, b: Vector3) -> void:
	if a.distance_to(b) < 1.5:
		return
	if tracers.size() >= MAX_TRACERS:
		tracers.pop_front()
	tracers.append([a, b, 0.0])

func muzzle(p: Vector3, big := 1.0) -> void:
	flash_light.global_position = p
	flash_light.light_energy = 2.5 * big
	flash_t = 0.05
	for i in 3:
		spark(p, Color(1, 0.75, 0.35, 1), 0.28 * big, 0.05, Vector3.ZERO, 0)
	puff(p, Color(0.8, 0.78, 0.75, 0.25), 0.15 * big, 0.4, Vector3(0, 0.4, 0), 0, 4.0)

## A bullet striking something: dust in the ground's colour, sparks off metal, splash in water.
func impact(p: Vector3, surface: String) -> void:
	match surface:
		"metal":
			for i in 6:
				spark(p, Color(1, 0.8, 0.4), 0.06, 0.35, Vector3(randf_range(-3, 3), randf_range(1, 4), randf_range(-3, 3)))
			puff(p, Color(0.5, 0.5, 0.5, 0.35), 0.2, 0.5)
		"water":
			for i in 5:
				puff(p, Color(0.85, 0.9, 0.95, 0.6), 0.15, 0.6, Vector3(randf_range(-0.6, 0.6), randf_range(2, 4), randf_range(-0.6, 0.6)), 9.0, 1.5)
		"flesh":
			for i in 5:
				puff(p, Color(0.55, 0.02, 0.02, 0.85), 0.12, 0.45, Vector3(randf_range(-1, 1), randf_range(0, 1.5), randf_range(-1, 1)), 6.0, 2.0)
		"wood":
			for i in 4:
				puff(p, Color(0.45, 0.32, 0.2, 0.7), 0.12, 0.5, Vector3(randf_range(-1, 1), randf_range(0.5, 2), randf_range(-1, 1)), 8.0, 1.2)
			puff(p, Color(0.6, 0.5, 0.4, 0.35), 0.25, 0.7)
		_:
			for i in 3:
				puff(p, Color(0.62, 0.55, 0.45, 0.6), 0.18, 0.7, Vector3(randf_range(-0.8, 0.8), randf_range(0.6, 1.6), randf_range(-0.8, 0.8)), 2.0, 2.5)
			spark(p, Color(1, 0.85, 0.5), 0.08, 0.08)

func blood(p: Vector3, heavy := false) -> void:
	for i in (10 if heavy else 5):
		puff(p, Color(0.6, 0.03, 0.03, 0.9), 0.14, 0.5, Vector3(randf_range(-1.5, 1.5), randf_range(-0.2, 1.8), randf_range(-1.5, 1.5)), 7.0, 2.2)

func explosion(p: Vector3, radius: float) -> void:
	var k: float = clamp(radius / 7.0, 0.5, 1.6)
	var l = boom_lights[0] if boom_lights[0][1] <= boom_lights[1][1] else boom_lights[1]
	l[0].global_position = p + Vector3(0, 1.5, 0)
	l[0].light_energy = 8.0 * k
	l[1] = 0.6
	for i in int(26 * k):
		var d := Vector3(randf_range(-1, 1), randf_range(0.2, 1.4), randf_range(-1, 1)).normalized()
		spark(p + Vector3(0, 0.5, 0), Color(1, randf_range(0.45, 0.8), 0.2, 1), randf_range(0.8, 1.8) * k, randf_range(0.25, 0.6), d * randf_range(3, 9) * k, -1.5)
	for i in int(18 * k):
		var d := Vector3(randf_range(-1, 1), randf_range(0.3, 1.2), randf_range(-1, 1)).normalized()
		puff(p + Vector3(0, 0.8, 0), Color(0.16, 0.14, 0.13, 0.75), randf_range(1.0, 1.8) * k, randf_range(2.5, 4.5), d * randf_range(1.5, 4.5) * k, -0.4, 2.6)
	for i in int(14 * k):
		var d := Vector3(randf_range(-1, 1), randf_range(0.5, 1.5), randf_range(-1, 1)).normalized()
		puff(p, Color(0.5, 0.42, 0.32, 0.8), 0.25, 1.2, d * randf_range(6, 12), 14.0, 1.0)
	add_shake_at(p, 1.2 * k)

func smoke_cloud(p: Vector3, r: float, secs: float) -> void:
	for i in 40:
		var a := randf() * TAU
		var rr := sqrt(randf()) * r * 0.8
		puff(Vector3(p.x + cos(a) * rr, randf_range(0.5, 3.0), p.z + sin(a) * rr), Color(0.86, 0.86, 0.84, 0.92), randf_range(2.0, 3.2), secs * randf_range(0.8, 1.0), Vector3(randf_range(-0.15, 0.15), 0.05, randf_range(-0.15, 0.15)), 0, 1.4)

func flashbang(p: Vector3) -> void:
	flash_light.global_position = p
	flash_light.light_energy = 16.0
	flash_t = 0.12
	spark(p, Color(1, 1, 1, 1), 3.0, 0.15)

func add_shake_at(p: Vector3, amount: float) -> void:
	if cam == null:
		return
	var d := cam.global_position.distance_to(p)
	shake = min(1.6, shake + amount * clamp(1.0 - d / 45.0, 0.0, 1.0))

func _process(delta: float) -> void:
	_step(parts_soft, soft.multimesh, delta)
	_step(parts_glow, glowp.multimesh, delta)
	# Tracers fly quickly and fade.
	var mm := tracer_mm.multimesh
	var keep: Array = []
	var n := 0
	for tr in tracers:
		tr[2] += delta
		if tr[2] > 0.09:
			continue
		keep.append(tr)
		var a: Vector3 = tr[0]
		var b: Vector3 = tr[1]
		var f: float = tr[2] / 0.09
		var dir := (b - a)
		var len := dir.length()
		var seg: float = min(len * 0.35, 9.0)
		var head = a + dir * clamp(f * 1.3, 0.0, 1.0)
		var tail = head - dir.normalized() * seg
		var mid = (head + tail) / 2.0
		var basis := Basis.looking_at(dir.normalized(), Vector3.UP if absf(dir.normalized().y) < 0.99 else Vector3.RIGHT)
		basis = basis.scaled(Vector3(1, 1, seg))
		mm.set_instance_transform(n, Transform3D(basis, mid))
		mm.set_instance_color(n, Color(1, 0.85, 0.5, 1.0 - f))
		n += 1
	tracers = keep
	mm.visible_instance_count = n
	if flash_t > 0:
		flash_t -= delta
		if flash_t <= 0:
			flash_light.light_energy = 0.0
	for l in boom_lights:
		if l[1] > 0:
			l[1] -= delta
			l[0].light_energy = max(0.0, l[0].light_energy * pow(0.02, delta))
			if l[1] <= 0:
				l[0].light_energy = 0.0
	shake = max(0.0, shake - delta * 2.2)

func _step(list: Array, mm: MultiMesh, delta: float) -> void:
	var keep: Array = []
	var n := 0
	for p in list:
		p[2] += delta
		if p[2] >= p[3]:
			continue
		var v: Vector3 = p[1]
		v.y -= p[7] * delta
		v *= max(0.0, 1.0 - p[8] * delta)
		p[1] = v
		p[0] += v * delta
		keep.append(p)
		var f: float = p[2] / p[3]
		var s: float = lerp(p[4], p[5], f)
		var c: Color = p[6]
		var a = c.a * (1.0 - f) * min(1.0, p[2] * 12.0 + 0.3)
		mm.set_instance_transform(n, Transform3D(Basis().scaled(Vector3(s, s, s)), p[0]))
		mm.set_instance_color(n, Color(c.r, c.g, c.b, a))
		n += 1
	list.clear()
	list.append_array(keep)
	mm.visible_instance_count = n
