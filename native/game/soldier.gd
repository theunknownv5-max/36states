class_name Soldier
extends Node3D
## Another fighter (player or bot): a jointed soldier in their faction's uniform, carrying their
## weapon, walking, running, crouching, falling when downed and dropping when killed. Positions
## come from server snapshots and are smoothed by interpolating slightly in the past.

const INTERP_MS := 100.0

var id := ""
var side := "sec"
var faction := "army"
var pname := ""
var is_mate := false
var show_hp := false   # BRD: health over every head
var bot := false
var buf: Array = []          # [ts, Vector3 pos, yaw, pitch, flags, weapon, health]
var state := {}              # current interpolated state
var flags := 0
var weapon := ""
var health := -1
var walk_phase := 0.0
var last_pos := Vector3.ZERO
var speed := 0.0
var death_t := -1.0
var downed_t := 0.0

var body_root: Node3D
var hips: Node3D
var spine: Node3D
var head: Node3D
var arm_l: Node3D
var arm_r: Node3D
var fore_l: Node3D
var fore_r: Node3D
var leg_l: Node3D
var leg_r: Node3D
var shin_l: Node3D
var shin_r: Node3D
var gun: Node3D
var tag: Label3D
var hp_bar: MeshInstance3D
var mats: Array = []
var phys: Phys
var biome := "savanna"
var step_d := 0.0

static var _mesh_cache := {}

static func _box(sx: float, sy: float, sz: float) -> BoxMesh:
	var k := "b%.2f_%.2f_%.2f" % [sx, sy, sz]
	if not _mesh_cache.has(k):
		var b := BoxMesh.new()
		b.size = Vector3(sx, sy, sz)
		_mesh_cache[k] = b
	return _mesh_cache[k]

static func _cap(r: float, h: float) -> CapsuleMesh:
	var k := "c%.2f_%.2f" % [r, h]
	if not _mesh_cache.has(k):
		var c := CapsuleMesh.new()
		c.radius = r
		c.height = h
		c.radial_segments = 10
		c.rings = 3
		_mesh_cache[k] = c
	return _mesh_cache[k]

func _part(parent: Node3D, mesh: Mesh, mat: Material, pos: Vector3) -> MeshInstance3D:
	var m := MeshInstance3D.new()
	m.mesh = mesh
	m.material_override = mat
	m.position = pos
	parent.add_child(m)
	return m

func _joint(parent: Node3D, pos: Vector3) -> Node3D:
	var n := Node3D.new()
	n.position = pos
	parent.add_child(n)
	return n

static func cloth(col: Color, camo: bool) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = col
	m.roughness = 0.9
	if camo:
		m.albedo_texture = load("res://textures/camo_wood.png")
		m.albedo_color = col.lightened(0.55)
		m.uv1_scale = Vector3(2, 2, 2)
	return m

func setup(info: Dictionary, mate: bool) -> void:
	id = str(info.id)
	side = str(info.get("side", "sec"))
	faction = str(info.get("faction", "army"))
	pname = str(info.get("name", ""))
	bot = bool(info.get("bot", false))
	is_mate = mate
	var u: Dictionary = Cfg.faction(faction).get("uniform", {})
	var camo := bool(u.get("camo", false))
	var top := cloth(Color(str(u.get("top", "#4b5a32"))), camo)
	var bottom := cloth(Color(str(u.get("bottom", "#4b5a32"))), camo)
	var skin := StandardMaterial3D.new()
	var tones := [Color("#5a3a26"), Color("#6b4630"), Color("#4a2f20"), Color("#7a5236")]
	skin.albedo_color = tones[abs(id.hash()) % tones.size()]
	skin.roughness = 0.7
	var boots := World.flat(Color("#1c1a18"), 0.8)
	var vest_col = u.get("vest")
	mats = [top, bottom, skin]
	body_root = Node3D.new()
	add_child(body_root)
	hips = _joint(body_root, Vector3(0, 0.95, 0))
	_part(hips, _box(0.34, 0.2, 0.22), bottom, Vector3.ZERO)
	spine = _joint(hips, Vector3(0, 0.08, 0))
	_part(spine, _box(0.4, 0.5, 0.24), top, Vector3(0, 0.27, 0))
	if vest_col != null:
		_part(spine, _box(0.44, 0.36, 0.3), World.flat(Color(str(vest_col)), 0.8), Vector3(0, 0.3, 0))
	head = _joint(spine, Vector3(0, 0.58, 0))
	var hm := SphereMesh.new()
	hm.radius = 0.12
	hm.height = 0.26
	hm.radial_segments = 12
	hm.rings = 6
	_part(head, hm, skin, Vector3(0, 0.1, 0))
	if u.get("cap") != null:
		_part(head, _box(0.26, 0.09, 0.27), World.flat(Color(str(u.cap)), 0.8), Vector3(0, 0.2, -0.01))
		_part(head, _box(0.2, 0.02, 0.1), World.flat(Color(str(u.cap)), 0.8), Vector3(0, 0.16, -0.16))
	if u.get("wrap") != null:
		_part(head, _box(0.27, 0.12, 0.27), World.flat(Color(str(u.wrap)), 0.9), Vector3(0, 0.07, 0.0))
	# Arms (shoulder joints) holding the gun forward.
	arm_l = _joint(spine, Vector3(-0.24, 0.48, 0))
	arm_r = _joint(spine, Vector3(0.24, 0.48, 0))
	for a in [arm_l, arm_r]:
		_part(a, _cap(0.065, 0.32), top, Vector3(0, -0.14, 0))
	fore_l = _joint(arm_l, Vector3(0, -0.3, 0))
	fore_r = _joint(arm_r, Vector3(0, -0.3, 0))
	for f in [fore_l, fore_r]:
		_part(f, _cap(0.055, 0.3), top, Vector3(0, -0.13, 0))
		_part(f, _box(0.08, 0.09, 0.09), skin, Vector3(0, -0.3, 0))
	# Legs.
	leg_l = _joint(hips, Vector3(-0.1, -0.08, 0))
	leg_r = _joint(hips, Vector3(0.1, -0.08, 0))
	for l in [leg_l, leg_r]:
		_part(l, _cap(0.08, 0.44), bottom, Vector3(0, -0.2, 0))
	shin_l = _joint(leg_l, Vector3(0, -0.42, 0))
	shin_r = _joint(leg_r, Vector3(0, -0.42, 0))
	for s in [shin_l, shin_r]:
		_part(s, _cap(0.07, 0.42), bottom, Vector3(0, -0.2, 0))
		_part(s, _box(0.12, 0.1, 0.24), boots, Vector3(0, -0.42, -0.05))
	gun = _joint(spine, Vector3(0.08, 0.38, -0.32))
	tag = Label3D.new()
	tag.font = Kit.font_bold
	tag.font_size = 40
	tag.pixel_size = 0.009
	tag.outline_size = 10
	tag.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	tag.no_depth_test = true
	tag.fixed_size = false
	tag.position = Vector3(0, 2.15, 0)
	tag.modulate = Kit.side_color(side).lightened(0.2)
	tag.text = pname
	tag.visible = is_mate
	add_child(tag)
	for mi in find_children("*", "MeshInstance3D", true, false):
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON

## Called with each snapshot entry: [id, x, y, z, yaw, pitch, flags, weaponIdx, health].
func push(ts: float, e: Array) -> void:
	var w_ids: Array = Cfg.weapon_ids()
	var wi := int(e[7])
	buf.append([ts, Vector3(e[1], e[2], e[3]), float(e[4]), float(e[5]), int(e[6]), w_ids[wi] if wi >= 0 and wi < w_ids.size() else "", int(e[8])])
	if buf.size() > 30:
		buf.pop_front()
	if buf.size() == 1:
		position = buf[0][1]

func _set_gun(wid: String) -> void:
	if wid == weapon:
		return
	weapon = wid
	for c in gun.get_children():
		c.queue_free()
	var model := Guns.build(wid, 0.9)
	gun.add_child(model)

func update(dt: float, render_ts: float, cam_pos: Vector3) -> void:
	if buf.is_empty():
		return
	# Interpolate between the two snapshots around render time.
	var a: Array = buf[0]
	var b: Array = buf[buf.size() - 1]
	for i in range(buf.size() - 1):
		if buf[i][0] <= render_ts and buf[i + 1][0] >= render_ts:
			a = buf[i]
			b = buf[i + 1]
			break
	var k := 1.0
	if b[0] > a[0]:
		k = clamp((render_ts - a[0]) / (b[0] - a[0]), 0.0, 1.0)
	if render_ts > b[0]:
		k = 1.0
	var pos: Vector3 = a[1].lerp(b[1], k)
	var yaw := lerp_angle(a[2], b[2], k)
	var pitch: float = lerp(a[3], b[3], k)
	flags = b[4]
	health = b[6]
	_set_gun(b[5])
	var moved := pos.distance_to(last_pos)
	last_pos = pos
	speed = lerp(speed, moved / max(dt, 0.001), min(1.0, dt * 8.0))
	if speed > 30.0:
		speed = 0.0  # teleport (respawn)
	position = pos
	rotation.y = yaw
	var crouch := flags & 1 != 0
	var downed := flags & 2 != 0
	var spirit := flags & 4 != 0
	var dead := flags & 256 != 0
	var in_veh := flags & 4096 != 0
	visible = not in_veh
	# Death: fall over, then sink after a while.
	if dead:
		if death_t < 0:
			death_t = 0.0
		death_t += dt
		body_root.rotation.x = lerp(body_root.rotation.x, -PI / 2.0, min(1.0, dt * 6.0))
		body_root.position.y = lerp(body_root.position.y, 0.15, min(1.0, dt * 6.0))
		tag.visible = false
		if death_t > 6.0:
			visible = false
		return
	death_t = -1.0
	if downed:
		body_root.rotation.x = lerp(body_root.rotation.x, -PI / 2.0 + 0.15, min(1.0, dt * 6.0))
		body_root.position.y = lerp(body_root.position.y, 0.25, min(1.0, dt * 6.0))
	else:
		body_root.rotation.x = lerp(body_root.rotation.x, 0.0, min(1.0, dt * 10.0))
		body_root.position.y = lerp(body_root.position.y, -0.35 if crouch else 0.0, min(1.0, dt * 10.0))
	# Walk / run cycle from actual movement.
	var sprint := flags & 128 != 0
	walk_phase += moved * (2.6 if sprint else 3.2)
	# Their footsteps (only the ones close enough to hear).
	step_d += moved
	if step_d > (2.6 if sprint else 2.1) and moved < 1.0:
		step_d = 0.0
		if phys and cam_pos.distance_to(pos) < 28.0 and not crouch and pos.y > -0.5:
			Sfx.footstep(phys.surface_at(pos.x, pos.y, pos.z, biome), pos + Vector3(0, 0.1, 0), 0.9 if sprint else 0.6)
	var amp: float = clamp(speed / 4.4, 0.0, 1.3) * (0.7 if crouch else 1.0)
	var sw := sin(walk_phase) * 0.6 * amp
	var bend_base := 0.9 if crouch else 0.0
	# (Positive x rotation swings a limb forward; knees bend the other way.)
	leg_l.rotation.x = sw + bend_base * 1.1
	leg_r.rotation.x = -sw + bend_base * 1.1
	shin_l.rotation.x = -max(0.0, -sin(walk_phase)) * 0.9 * amp - bend_base * 1.8
	shin_r.rotation.x = -max(0.0, sin(walk_phase)) * 0.9 * amp - bend_base * 1.8
	hips.position.y = 0.95 + absf(cos(walk_phase)) * 0.04 * amp
	# Aim: the torso and arms follow the pitch; sprinting carries the gun low.
	spine.rotation.x = pitch * 0.5 - (0.25 if sprint else 0.0) - (0.3 if crouch else 0.0)
	head.rotation.x = pitch * 0.5
	var aim := 1.35 if not sprint else 0.6
	arm_r.rotation = Vector3(aim, 0.0, 0.1)
	arm_l.rotation = Vector3(aim, 0.0, -0.45)
	fore_r.rotation.x = 0.25
	fore_l.rotation.x = 0.45
	if flags & 64 != 0:
		arm_l.rotation.x = aim + sin(Time.get_ticks_msec() * 0.01) * 0.3   # reloading
	# Spirits (teammates only see them): ghostly.
	if spirit:
		for m in mats:
			m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
			m.albedo_color.a = 0.35
	# Name over teammates; enemies only when close.
	var d := cam_pos.distance_to(pos)
	tag.visible = (is_mate and d < 90.0) or (not is_mate and ((show_hp and d < 45.0) or (d < 14.0 and flags & 2048 == 0)))
	if tag.visible and (is_mate or show_hp) and health >= 0:
		tag.text = "%s  %d" % [pname, health]
	elif tag.visible:
		tag.text = pname

## Chest height of this soldier for effects.
func chest() -> Vector3:
	return global_position + Vector3(0, 1.2 if flags & 1 == 0 else 0.8, 0)

func muzzle_pos() -> Vector3:
	return gun.global_position + (-global_basis.z) * 0.6
