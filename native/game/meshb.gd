class_name MeshB
extends RefCounted
## Builds static geometry merged per material (one draw call per material), with UVs in world
## metres so textures keep a real-world scale, and a little fake ambient occlusion near the
## ground. Faces are wound clockwise (Godot's front faces).

var groups := {}

func _g(key: String) -> Dictionary:
	if not groups.has(key):
		groups[key] = {"v": PackedVector3Array(), "n": PackedVector3Array(), "uv": PackedVector2Array(), "c": PackedColorArray(), "i": PackedInt32Array(), "t": PackedFloat32Array()}
	return groups[key]

## A quad from four corners given counter-clockwise as seen from the front (outside).
func quad(key: String, a: Vector3, b: Vector3, c: Vector3, d: Vector3, n: Vector3, uva: Vector2, uvb: Vector2, uvc: Vector2, uvd: Vector2, col := Color.WHITE, ao := true) -> void:
	var g := _g(key)
	var base: int = g.v.size()
	var tan := _tangent(a, b, d, uva, uvb, uvd, n)
	for p in [[a, uva], [b, uvb], [c, uvc], [d, uvd]]:
		g.t.append_array(tan)
		g.v.append(p[0])
		g.n.append(n)
		g.uv.append(p[1])
		var k := 1.0
		if ao and absf(n.y) < 0.5:
			k = 0.72 + min(1.0, max(0.0, p[0].y) / 1.4) * 0.28
		g.c.append(Color(col.r * k, col.g * k, col.b * k, col.a))
	# CCW input -> clockwise triangles for Godot.
	g.i.append_array([base, base + 2, base + 1, base, base + 3, base + 2])

## Tangent (and handedness) from the UV layout, so normal maps light correctly.
static func _tangent(a: Vector3, b: Vector3, c: Vector3, ua: Vector2, ub: Vector2, uc: Vector2, n: Vector3) -> PackedFloat32Array:
	var e1 := b - a
	var e2 := c - a
	var d1 := ub - ua
	var d2 := uc - ua
	var r := d1.x * d2.y - d2.x * d1.y
	if absf(r) < 1e-9:
		var t0 := Vector3(1, 0, 0) if absf(n.x) < 0.9 else Vector3(0, 0, 1)
		return PackedFloat32Array([t0.x, t0.y, t0.z, 1.0])
	var f := 1.0 / r
	var t := (e1 * d2.y - e2 * d1.y) * f
	var bt := (e2 * d1.x - e1 * d2.x) * f
	t = (t - n * n.dot(t)).normalized()
	var w := -1.0 if n.cross(t).dot(bt) < 0.0 else 1.0
	return PackedFloat32Array([t.x, t.y, t.z, w])

## An axis-aligned box. tile: metres per texture repeat, or 0 to fit 0..1 on every face.
func box(key: String, b: Dictionary, tile: float, tint := Color.WHITE, skip_bottom := true) -> void:
	var x0: float = b.x0
	var y0: float = b.y0
	var z0: float = b.z0
	var x1: float = b.x1
	var y1: float = b.y1
	var z1: float = b.z1
	var faces := [
		[Vector3(1, 0, 0), Vector3(x1, y0, z1), Vector3(x1, y0, z0), Vector3(x1, y1, z0), Vector3(x1, y1, z1), "zy"],
		[Vector3(-1, 0, 0), Vector3(x0, y0, z0), Vector3(x0, y0, z1), Vector3(x0, y1, z1), Vector3(x0, y1, z0), "zy"],
		[Vector3(0, 1, 0), Vector3(x0, y1, z1), Vector3(x1, y1, z1), Vector3(x1, y1, z0), Vector3(x0, y1, z0), "xz"],
		[Vector3(0, -1, 0), Vector3(x0, y0, z0), Vector3(x1, y0, z0), Vector3(x1, y0, z1), Vector3(x0, y0, z1), "xz"],
		[Vector3(0, 0, 1), Vector3(x0, y0, z1), Vector3(x1, y0, z1), Vector3(x1, y1, z1), Vector3(x0, y1, z1), "xy"],
		[Vector3(0, 0, -1), Vector3(x1, y0, z0), Vector3(x0, y0, z0), Vector3(x0, y1, z0), Vector3(x1, y1, z0), "xy"],
	]
	for f in faces:
		var n: Vector3 = f[0]
		if skip_bottom and n.y < -0.5 and y0 <= 0.01:
			continue
		var uvs := []
		for k in range(1, 5):
			var v: Vector3 = f[k]
			var u := 0.0
			var w := 0.0
			if tile <= 0.0:
				u = (v.z - z0) / max(0.001, z1 - z0) if f[5] == "zy" else (v.x - x0) / max(0.001, x1 - x0)
				w = (v.z - z0) / max(0.001, z1 - z0) if f[5] == "xz" else (v.y - y0) / max(0.001, y1 - y0)
				w = 1.0 - w
			else:
				u = (v.z if f[5] == "zy" else v.x) / tile
				w = -(v.z if f[5] == "xz" else v.y) / tile
			uvs.append(Vector2(u, w))
		quad(key, f[1], f[2], f[3], f[4], n, uvs[0], uvs[1], uvs[2], uvs[3], tint)

## A triangle (CCW from the front).
func tri(key: String, a: Vector3, b: Vector3, c: Vector3, uva: Vector2, uvb: Vector2, uvc: Vector2, col := Color.WHITE) -> void:
	var g := _g(key)
	var base: int = g.v.size()
	var n := (b - a).cross(c - a).normalized()
	var tan := _tangent(a, b, c, uva, uvb, uvc, n)
	for p in [[a, uva], [b, uvb], [c, uvc]]:
		g.t.append_array(tan)
		g.v.append(p[0])
		g.n.append(n)
		g.uv.append(p[1])
		g.c.append(col)
	g.i.append_array([base, base + 2, base + 1])

func build(parent: Node3D, mats: Dictionary, shadows := true) -> Array:
	var out: Array = []
	for key in groups:
		var g: Dictionary = groups[key]
		if g.i.is_empty():
			continue
		var arr := []
		arr.resize(Mesh.ARRAY_MAX)
		arr[Mesh.ARRAY_VERTEX] = g.v
		arr[Mesh.ARRAY_NORMAL] = g.n
		arr[Mesh.ARRAY_TEX_UV] = g.uv
		arr[Mesh.ARRAY_COLOR] = g.c
		arr[Mesh.ARRAY_TANGENT] = g.t
		arr[Mesh.ARRAY_INDEX] = g.i
		var m := ArrayMesh.new()
		m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
		if mats.has(key):
			m.surface_set_material(0, mats[key])
		var mi := MeshInstance3D.new()
		mi.mesh = m
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if shadows else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		parent.add_child(mi)
		out.append(mi)
	return out

static func mesh_from(arrs: Dictionary, mat: Material) -> ArrayMesh:
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = arrs.v
	arr[Mesh.ARRAY_NORMAL] = arrs.n
	arr[Mesh.ARRAY_TEX_UV] = arrs.uv
	arr[Mesh.ARRAY_COLOR] = arrs.c
	arr[Mesh.ARRAY_TANGENT] = arrs.t
	arr[Mesh.ARRAY_INDEX] = arrs.i
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	m.surface_set_material(0, mat)
	return m
