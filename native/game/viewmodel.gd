class_name ViewModel
extends Node3D
## Your own hands and gun in first person: walk bob, look sway, recoil kick, reload and weapon
## switch animations, aiming down the sights, and sprint carry.

var weapon := ""
var faction := "army"
var holder: Node3D
var gun: Node3D
var gun2: Node3D
var arms: Node3D
var kick := 0.0
var kick_side := 0.0
var bob := 0.0
var sway := Vector2.ZERO
var reload_t := 0.0
var reload_len := 0.0
var raise_t := 0.0
var swing_t := 0.0
var ads_k := 0.0
var sprint_k := 0.0
var land_k := 0.0
var dual_flip := false
const S := 0.42

func _ready() -> void:
	holder = Node3D.new()
	add_child(holder)

func set_weapon(id: String, fac: String) -> void:
	if id == weapon and fac == faction:
		return
	weapon = id
	faction = fac
	for c in holder.get_children():
		c.queue_free()
	if id == "":
		gun = null
		return
	var dual: bool = Cfg.weapon(id).get("dual", false)
	gun = Guns.build(id, S)
	holder.add_child(gun)
	gun2 = null
	if dual:
		gun2 = Guns.build(id, S)
		holder.add_child(gun2)
	# Sleeves and hands in the faction's uniform.
	var u: Dictionary = Cfg.faction(fac).get("uniform", {})
	var sleeve := Soldier.cloth(Color(str(u.get("top", "#4b5a32"))), false)
	var skin := StandardMaterial3D.new()
	skin.albedo_color = Color("#5a3a26")
	skin.roughness = 0.7
	arms = Node3D.new()
	holder.add_child(arms)
	var kind := Guns.kind_of(id)
	var fore := {"pistol": 0.02, "magnum": 0.02, "smg": -0.24, "rifle": -0.36, "battle": -0.36, "mg": -0.42, "sniper": -0.38, "shotgun": -0.34, "launcher": -0.06, "knife": 0.0}.get(kind, -0.3)
	var right := Vector3(0, -0.012, 0.012)
	var left := Vector3(-0.012, 0.0 if kind != "pistol" and kind != "magnum" else -0.03, fore * S)
	_hand(right, right + Vector3(0.04, -0.1, 0.05), sleeve, skin)
	if kind != "knife":
		if dual:
			var lh := Vector3(-0.3, -0.012, 0.012)
			_hand(lh, lh + Vector3(-0.04, -0.1, 0.05), sleeve, skin)
		else:
			_hand(left, left + Vector3(-0.05, -0.1, 0.05), sleeve, skin)
	for mi in find_children("*", "MeshInstance3D", true, false):
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	raise_t = 0.35

## A hand at p (on the gun) with its sleeve running back to the elbow, off screen.
func _hand(p: Vector3, elbow: Vector3, sleeve: Material, skin: Material) -> void:
	var h := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(0.032, 0.036, 0.05)
	h.mesh = bm
	h.material_override = skin
	h.position = p
	arms.add_child(h)
	var a := MeshInstance3D.new()
	var cm := CapsuleMesh.new()
	var len := p.distance_to(elbow)
	cm.radius = 0.02
	cm.height = len + 0.05
	a.mesh = cm
	a.material_override = sleeve
	arms.add_child(a)
	a.position = (p + elbow) / 2.0
	a.look_at_from_position(a.position, elbow, Vector3.UP)
	a.rotate_object_local(Vector3.RIGHT, PI / 2.0)

func fire(k: float) -> void:
	kick = min(1.0, kick + 0.35 + k * 8.0)
	kick_side = randf_range(-1, 1)
	dual_flip = not dual_flip

func reload(secs: float) -> void:
	reload_len = secs
	reload_t = secs

func swing() -> void:
	swing_t = 0.35

func landed() -> void:
	land_k = 1.0

func update(dt: float, speed: float, sprint: bool, ads: bool, crouch: bool, on_ground: bool, look: Vector2) -> void:
	if gun == null:
		return
	var kind := Guns.kind_of(weapon)
	ads_k = move_toward(ads_k, 1.0 if ads else 0.0, dt * 7.0)
	sprint_k = move_toward(sprint_k, 1.0 if sprint else 0.0, dt * 5.0)
	if on_ground:
		bob += dt * speed * (1.6 if sprint else 2.0)
	var amp: float = clamp(speed / 4.4, 0.0, 1.4) * (1.0 - ads_k * 0.85)
	var bx := sin(bob) * 0.012 * amp
	var by := -absf(cos(bob)) * 0.014 * amp
	sway = sway.lerp(Vector2(-look.x, look.y) * 0.6, min(1.0, dt * 10.0))
	sway = sway.limit_length(0.05)
	kick = move_toward(kick, 0.0, dt * 6.0)
	land_k = move_toward(land_k, 0.0, dt * 4.0)
	raise_t = max(0.0, raise_t - dt)
	swing_t = max(0.0, swing_t - dt)
	var hip := Vector3(0.15, -0.16, -0.36)
	var top := {"sniper": 0.145, "pistol": 0.07, "magnum": 0.075, "launcher": 0.12, "mg": 0.1, "shotgun": 0.09}.get(kind, 0.1)
	var sight := Vector3(0.0, -top * S, -0.42)
	if kind == "pistol" or kind == "magnum":
		hip = Vector3(0.13, -0.15, -0.34)
	var p := hip.lerp(sight, ads_k)
	p += Vector3(bx + sway.x * 0.4, by + sway.y * 0.4 - land_k * 0.03, 0)
	p.z += kick * 0.05
	p.y -= raise_t * 0.4
	var rot := Vector3(kick * 0.12 + sway.y * 0.6, sway.x * 0.6 + kick_side * kick * 0.02, 0)
	# Sprint: gun swung down and across.
	p += Vector3(-0.04, -0.05, 0.03) * sprint_k
	rot += Vector3(-0.35, 0.6, 0.25) * sprint_k
	if crouch:
		rot.z += 0.05 * (1.0 - ads_k)
	# Reload: tip the gun down and roll it, then bring it back.
	if reload_t > 0:
		reload_t = max(0.0, reload_t - dt)
		var f: float = 1.0 - reload_t / max(0.01, reload_len)
		var dip: float = sin(clamp(f, 0.0, 1.0) * PI)
		p.y -= dip * 0.08
		rot += Vector3(-dip * 0.5, 0, dip * 0.6)
	if swing_t > 0:
		var f2 := 1.0 - swing_t / 0.35
		rot += Vector3(-sin(f2 * PI) * 1.2, sin(f2 * PI) * 0.8, 0)
		p.x -= sin(f2 * PI) * 0.1
	holder.position = p
	holder.rotation = rot
	if gun2:
		gun.position = Vector3(0.0, 0, (kick * 0.03 if not dual_flip else 0.0))
		gun2.position = Vector3(-0.3, 0, (kick * 0.03 if dual_flip else 0.0))
