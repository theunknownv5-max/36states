class_name Guns
extends RefCounted
## Every weapon modelled from simple solids: pistols, MP5, AK, G3, PKM, SVD, Dane gun, RPG,
## the relic guns and the machete. Barrels point forward (-Z); the origin is the grip.

static var _mats := {}

static func mat(name: String) -> StandardMaterial3D:
	if _mats.has(name):
		return _mats[name]
	var m := StandardMaterial3D.new()
	match name:
		"metal":
			m.albedo_color = Color("#2a2c2f")
			m.metallic = 0.75
			m.roughness = 0.38
		"poly":
			m.albedo_color = Color("#1b1c1e")
			m.roughness = 0.7
		"wood":
			m.albedo_color = Color("#6b3f1f")
			m.roughness = 0.6
		"gold":
			m.albedo_color = Color("#d4a537")
			m.metallic = 1.0
			m.roughness = 0.25
		"olive":
			m.albedo_color = Color("#4b5232")
			m.roughness = 0.6
		"steel":
			m.albedo_color = Color("#b9bec4")
			m.metallic = 0.9
			m.roughness = 0.25
		"glass":
			m.albedo_color = Color(0.2, 0.35, 0.5)
			m.metallic = 0.5
			m.roughness = 0.1
		"warhead":
			m.albedo_color = Color("#3e4a2c")
			m.roughness = 0.5
	_mats[name] = m
	return m

static func _b(root: Node3D, size: Vector3, pos: Vector3, m: String, rot := Vector3.ZERO) -> MeshInstance3D:
	var bm := BoxMesh.new()
	bm.size = size
	var mi := MeshInstance3D.new()
	mi.mesh = bm
	mi.material_override = mat(m)
	mi.position = pos
	mi.rotation = rot
	root.add_child(mi)
	return mi

static func _c(root: Node3D, r: float, length: float, pos: Vector3, m: String, r2 := -1.0) -> MeshInstance3D:
	var cm := CylinderMesh.new()
	cm.top_radius = r
	cm.bottom_radius = r if r2 < 0 else r2
	cm.height = length
	cm.radial_segments = 10
	cm.rings = 1
	var mi := MeshInstance3D.new()
	mi.mesh = cm
	mi.material_override = mat(m)
	mi.position = pos
	mi.rotation = Vector3(PI / 2.0, 0, 0)   # along z
	root.add_child(mi)
	return mi

static func kind_of(id: String) -> String:
	match id:
		"p9", "dualp9":
			return "pistol"
		"hawk":
			return "magnum"
		"mp5", "dualmp5":
			return "smg"
		"ak47", "goldak":
			return "rifle"
		"g3":
			return "battle"
		"pkm":
			return "mg"
		"svd", "barrett":
			return "sniper"
		"danegun", "ancestral":
			return "shotgun"
		"rpg", "gl":
			return "launcher"
		"knife":
			return "knife"
	return "rifle"

static func build(id: String, s := 1.0) -> Node3D:
	var g := Node3D.new()
	var body := "gold" if id == "goldak" else "metal"
	match kind_of(id):
		"pistol", "magnum":
			var big := 1.25 if id == "hawk" else 1.0
			_b(g, Vector3(0.035, 0.045, 0.2) * big, Vector3(0, 0.07, -0.06), "metal")
			_b(g, Vector3(0.03, 0.1, 0.045) * big, Vector3(0, 0.0, 0.02), "poly", Vector3(-0.25, 0, 0))
			_c(g, 0.008 * big, 0.04, Vector3(0, 0.07, -0.17 * big), "metal")
		"smg":
			_b(g, Vector3(0.05, 0.07, 0.32), Vector3(0, 0.07, -0.1), "metal")
			_b(g, Vector3(0.025, 0.13, 0.035), Vector3(0, -0.02, -0.12), "poly", Vector3(0.2, 0, 0))
			_b(g, Vector3(0.03, 0.09, 0.04), Vector3(0, 0.0, 0.03), "poly", Vector3(-0.2, 0, 0))
			_c(g, 0.012, 0.1, Vector3(0, 0.08, -0.3), "metal")
			_b(g, Vector3(0.03, 0.04, 0.16), Vector3(0, 0.06, 0.12), "poly")
		"rifle", "battle":
			var furn := "wood" if id != "g3" else "olive"
			if id == "goldak":
				furn = "wood"
			_b(g, Vector3(0.05, 0.07, 0.36), Vector3(0, 0.07, -0.1), body)
			_b(g, Vector3(0.055, 0.06, 0.2), Vector3(0, 0.07, -0.36), furn)
			_c(g, 0.011, 0.24, Vector3(0, 0.085, -0.55), "metal")
			_b(g, Vector3(0.008, 0.04, 0.01), Vector3(0, 0.115, -0.64), "metal")
			if id == "g3":
				_b(g, Vector3(0.03, 0.15, 0.045), Vector3(0, -0.02, -0.14), "metal")
			else:
				_b(g, Vector3(0.03, 0.16, 0.045), Vector3(0, -0.03, -0.14), body, Vector3(0.35, 0, 0))
			_b(g, Vector3(0.03, 0.09, 0.04), Vector3(0, 0.0, 0.04), "poly" if id == "g3" else furn, Vector3(-0.25, 0, 0))
			_b(g, Vector3(0.04, 0.08, 0.24), Vector3(0, 0.05, 0.2), furn, Vector3(0.08, 0, 0))
		"mg":
			_b(g, Vector3(0.07, 0.09, 0.42), Vector3(0, 0.07, -0.1), "metal")
			_c(g, 0.016, 0.45, Vector3(0, 0.08, -0.52), "metal")
			_b(g, Vector3(0.11, 0.1, 0.1), Vector3(0.05, -0.0, -0.12), "olive")
			_b(g, Vector3(0.035, 0.09, 0.04), Vector3(0, 0.0, 0.06), "poly", Vector3(-0.25, 0, 0))
			_b(g, Vector3(0.045, 0.09, 0.26), Vector3(0, 0.05, 0.22), "wood")
			_b(g, Vector3(0.01, 0.16, 0.01), Vector3(0.03, -0.02, -0.62), "metal", Vector3(0.3, 0, 0.3))
			_b(g, Vector3(0.01, 0.16, 0.01), Vector3(-0.03, -0.02, -0.62), "metal", Vector3(0.3, 0, -0.3))
		"sniper":
			var heavy := id == "barrett"
			_b(g, Vector3(0.05, 0.07, 0.4), Vector3(0, 0.07, -0.08), "metal" if heavy else "metal")
			_b(g, Vector3(0.055, 0.06, 0.24), Vector3(0, 0.065, -0.38), "poly" if heavy else "wood")
			_c(g, 0.014 if heavy else 0.01, 0.42, Vector3(0, 0.08, -0.68), "metal")
			if heavy:
				_b(g, Vector3(0.06, 0.03, 0.06), Vector3(0, 0.08, -0.9), "metal")
			_c(g, 0.022, 0.24, Vector3(0, 0.145, -0.1), "metal")
			_c(g, 0.026, 0.03, Vector3(0, 0.145, -0.23), "glass")
			_b(g, Vector3(0.03, 0.11, 0.05), Vector3(0, -0.01, -0.12), "metal")
			_b(g, Vector3(0.04, 0.1, 0.26), Vector3(0, 0.04, 0.22), "poly" if heavy else "wood")
			_b(g, Vector3(0.03, 0.09, 0.04), Vector3(0, 0.0, 0.05), "poly" if heavy else "wood", Vector3(-0.25, 0, 0))
		"shotgun":
			_c(g, 0.014, 0.7, Vector3(0, 0.08, -0.45), "metal")
			_b(g, Vector3(0.04, 0.05, 0.3), Vector3(0, 0.06, -0.12), "wood")
			_b(g, Vector3(0.045, 0.1, 0.3), Vector3(0, 0.03, 0.18), "wood", Vector3(0.15, 0, 0))
			if id == "ancestral":
				_c(g, 0.014, 0.7, Vector3(0.03, 0.08, -0.45), "gold")
		"launcher":
			if id == "gl":
				_c(g, 0.03, 0.5, Vector3(0, 0.08, -0.25), "metal")
				_c(g, 0.07, 0.12, Vector3(0, 0.05, -0.08), "olive")
				_b(g, Vector3(0.03, 0.1, 0.04), Vector3(0, -0.02, 0.06), "poly", Vector3(-0.25, 0, 0))
			else:
				_c(g, 0.035, 0.95, Vector3(0, 0.1, -0.15), "olive")
				_c(g, 0.055, 0.22, Vector3(0, 0.1, -0.72), "warhead", 0.02)
				_b(g, Vector3(0.03, 0.1, 0.04), Vector3(0, 0.02, -0.05), "wood", Vector3(-0.25, 0, 0))
				_b(g, Vector3(0.03, 0.1, 0.04), Vector3(0, 0.02, 0.12), "wood", Vector3(-0.25, 0, 0))
		"knife":
			_b(g, Vector3(0.012, 0.05, 0.42), Vector3(0, 0.04, -0.24), "steel")
			_b(g, Vector3(0.03, 0.04, 0.12), Vector3(0, 0.02, 0.03), "wood")
	g.scale = Vector3(s, s, s)
	return g
