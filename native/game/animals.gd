class_name Animals
extends Node3D
## Dogs and crocodiles, driven by the server (snapshot fields "dg" and "ck"), smoothed between
## snapshots. Dogs: [i, x, z, yaw, state] (0 wander, 1 flee, 2 dead, 3 attack).
## Crocodiles: [i, x, z, yaw, state] (0 lurk, 1 chase, 2 dead).

var dogs := {}    # i -> {node, legs, from, to, yaw, state, t}
var crocs := {}
var phase := 0.0

static func _mat(c: Color, rough := 0.9) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = rough
	return m

static func _box(parent: Node3D, size: Vector3, pos: Vector3, mat: Material) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.position = pos
	mi.material_override = mat
	parent.add_child(mi)
	return mi

func _dog_node(i: int) -> Dictionary:
	var n := Node3D.new()
	var coats := [Color("#8a6a45"), Color("#3a2e24"), Color("#c9b08a"), Color("#5a4632")]
	var coat := _mat(coats[i % coats.size()])
	_box(n, Vector3(0.28, 0.26, 0.7), Vector3(0, 0.5, 0), coat)
	_box(n, Vector3(0.22, 0.22, 0.26), Vector3(0, 0.66, -0.42), coat)
	_box(n, Vector3(0.12, 0.1, 0.16), Vector3(0, 0.6, -0.6), _mat(Color("#222222")))
	_box(n, Vector3(0.05, 0.05, 0.3), Vector3(0, 0.62, 0.42), coat).rotation.x = -0.6
	var legs: Array = []
	for p in [Vector3(-0.1, 0.2, -0.26), Vector3(0.1, 0.2, -0.26), Vector3(-0.1, 0.2, 0.26), Vector3(0.1, 0.2, 0.26)]:
		legs.append(_box(n, Vector3(0.07, 0.4, 0.07), p, coat))
	add_child(n)
	return {"node": n, "legs": legs}

func _croc_node() -> Dictionary:
	var n := Node3D.new()
	var skin := _mat(Color("#3d4a2a"), 0.7)
	_box(n, Vector3(0.6, 0.28, 2.0), Vector3(0, 0.15, 0), skin)
	_box(n, Vector3(0.4, 0.18, 0.8), Vector3(0, 0.12, -1.35), skin)
	_box(n, Vector3(0.25, 0.14, 1.2), Vector3(0, 0.1, 1.5), skin)
	var legs: Array = []
	for p in [Vector3(-0.38, 0.06, -0.6), Vector3(0.38, 0.06, -0.6), Vector3(-0.38, 0.06, 0.6), Vector3(0.38, 0.06, 0.6)]:
		legs.append(_box(n, Vector3(0.14, 0.12, 0.3), p, skin))
	add_child(n)
	return {"node": n, "legs": legs}

func apply(list, kind: String) -> void:
	if not (list is Array):
		return
	var store: Dictionary = dogs if kind == "dog" else crocs
	for e in list:
		var i := int(e[0])
		var a = store.get(i)
		if a == null:
			a = _dog_node(i) if kind == "dog" else _croc_node()
			a.to = Vector3(float(e[1]), 0, float(e[2]))
			a.from = a.to
			a.node.position = a.to
			store[i] = a
		a.from = a.node.position
		a.to = Vector3(float(e[1]), 0, float(e[2]))
		a.yaw = float(e[3])
		a.state = int(e[4])
		a.t = 0.0

func _process(dt: float) -> void:
	phase += dt
	for store in [dogs, crocs]:
		for a in store.values():
			a.t = min(1.0, a.t + dt * 20.0)
			var n: Node3D = a.node
			var dead: bool = a.state == 2
			n.position = a.from.lerp(a.to, a.t)
			n.rotation.y = lerp_angle(n.rotation.y, a.yaw, min(1.0, dt * 10.0))
			n.rotation.z = lerp(n.rotation.z, PI / 2.0 if dead and store == dogs else 0.0, min(1.0, dt * 6.0))
			if dead and store == crocs:
				n.rotation.z = lerp(n.rotation.z, PI, min(1.0, dt * 4.0))
			var moving: float = (a.to - a.from).length()
			var sp := 18.0 if a.state in [1, 3] else 9.0
			for k in a.legs.size():
				a.legs[k].rotation.x = sin(phase * sp + k * PI) * 0.6 * clamp(moving * 10.0, 0.0, 1.0) * (0.0 if dead else 1.0)
