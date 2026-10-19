class_name World
extends Node3D
## Builds a state's battlefield from the server's map: sky, sun and weather; terrain with river
## beds; every wall, crate and building merged per material; water; trees, grass and rocks;
## roofs, tanks, flags, lamps and landmarks; and the billboards that carry the adverts.

const PLASTER_TINTS := ["#f1e6cf", "#d8e6ee", "#f0d5cf", "#d9ead3", "#f3e7a8", "#ffffff", "#e8d2b0", "#c9dff2"]
const CONTAINER_TINTS := ["#a3342b", "#2d5d9a", "#2f7a46", "#d77a1e", "#6d6d6d", "#e2e2e2", "#264a6e"]
const ATMOS := {
	"sahel": {"fog": 0.0062, "rain": 0.0, "dust": true},
	"savanna": {"fog": 0.0042, "rain": 0.15},
	"plateau": {"fog": 0.0035, "rain": 0.25},
	"rainforest": {"fog": 0.0058, "rain": 0.4},
	"creeks": {"fog": 0.006, "rain": 0.35},
	"urban": {"fog": 0.005, "rain": 0.15},
	"desert": {"fog": 0.0055, "rain": 0.0, "dust": true},
	"temperate": {"fog": 0.0045, "rain": 0.35},
	"snow": {"fog": 0.0068, "rain": 0.0, "snow": true},
}
const GROUND_TEX := {"sahel": "ground_sand", "savanna": "ground_red", "plateau": "ground_gravel", "rainforest": "grass", "creeks": "ground_mud", "urban": "ground_urban", "desert": "ground_sand", "temperate": "grass", "snow": "snow"}
const PATCH_TEX := {"sahel": "ground_dirt", "savanna": "grass", "plateau": "grass", "rainforest": "ground_red", "creeks": "grass", "urban": "ground_dirt", "desert": "ground_sand", "temperate": "ground_dirt", "snow": "snow"}
# Photo-scanned CC0 materials from Poly Haven (native/assets/pbr), used on medium and high.
const PBR := {"ground_sand": "ground_sand", "ground_dirt": "ground_dirt", "ground_gravel": "ground_gravel", "ground_red": "ground_red", "ground_mud": "ground_mud", "ground_urban": "paving", "grass": "grass", "concrete": "concrete", "plaster": "plaster", "plank": "planks", "stone": "stone_wall", "zinc": "corrugated", "metal": "metal", "rust": "rust", "mud": "mud_wall", "rock": "rock", "bark": "bark", "sandbag": "burlap", "container": "painted_metal"}

var map: Dictionary
var phys: Phys
var quality := "medium"
var biome := "savanna"
var look_id := "savanna"   # the region's own look (desert, temperate, snow...) on top of the base biome
var look := {}
var rng := RandomNumberGenerator.new()
var texcache := {}
var mats := {}
var sun: DirectionalLight3D
var env: Environment
var raining := false
var rain: GPUParticles3D
var dust: GPUParticles3D
var water_mats: Array = []
var drum_nodes := {}       # drum index -> MeshInstance3D
var lamps: Array = []
var flames: Array = []
var t := 0.0
var shadows := true

func build(m: Dictionary, p: Phys, q: String) -> void:
	map = m
	phys = p
	quality = q
	shadows = q != "low"
	biome = str(m.get("biome", "savanna"))
	look_id = str(m.get("lookId", biome))
	look = m.get("look", {})
	rng.seed = int(m.get("seed", 1)) ^ 0xa5a5
	_atmosphere()
	_terrain()
	_boxes()
	_water()
	_trees()
	_grass()
	_rocks()
	_visuals()

# ---------- textures and materials ----------
func tex(name: String) -> Texture2D:
	if texcache.has(name):
		return texcache[name]
	var tx: Texture2D = null
	var base := name.trim_suffix("_n")
	if quality != "low" and PBR.has(base):
		var p := "res://assets/pbr/%s/%s.jpg" % [PBR[base], "normal" if name.ends_with("_n") else "albedo"]
		if ResourceLoader.exists(p):
			tx = load(p)
	if tx == null:
		var path := "res://textures/%s.png" % name
		tx = load(path) if ResourceLoader.exists(path) else null
	texcache[name] = tx
	return tx

# Roughness and ambient occlusion of a photo material (Poly Haven ARM: R = AO, G = rough, B = metal).
func arm(name: String) -> Texture2D:
	if quality == "low" or not PBR.has(name):
		return null
	var p := "res://assets/pbr/%s/arm.jpg" % PBR[name]
	return load(p) if ResourceLoader.exists(p) else null

func smat(name: String, rough := 0.9, metal := 0.0, normal := true) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_texture = tex(name)
	m.vertex_color_use_as_albedo = true
	m.roughness = rough
	m.metallic = metal
	m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	if normal and quality != "low" and tex(name + "_n"):
		m.normal_enabled = true
		m.normal_texture = tex(name + "_n")
		m.normal_scale = 0.9
	var a := arm(name)
	if a:
		m.roughness_texture = a
		m.roughness_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_GREEN
		m.roughness = 1.0
		m.ao_enabled = true
		m.ao_texture = a
		m.ao_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_RED
		m.ao_light_affect = 0.4
	return m

static func flat(col: Color, rough := 0.85, metal := 0.0) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = col
	m.roughness = rough
	m.metallic = metal
	return m

static func glow(col: Color, energy := 2.0) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = col
	m.emission_enabled = true
	m.emission = col
	m.emission_energy_multiplier = energy
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	return m

func _hash(x: float, z: float) -> float:
	return fposmod(absf(sin(x * 12.9898 + z * 78.233) * 43758.5453), 1.0)

# ---------- sky, sun, fog, weather ----------
func _atmosphere() -> void:
	var a: Dictionary = ATMOS.get(look_id, ATMOS.get(biome, ATMOS.savanna))
	var hour := 7.5 + rng.randf() * 10.0
	var elev: float = max(8.0, sin((hour - 6.0) / 12.0 * PI) * 68.0)
	var azim := 95.0 if hour < 12.0 else 265.0
	var low := elev < 25.0
	raining = rng.randf() < float(a.get("rain", 0.0))
	sun = DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-elev, azim, 0)
	sun.light_color = Color("#ffc58a") if low else Color("#fff2dc")
	sun.light_energy = (0.95 if low else 1.15) * (0.6 if raining else 1.0)
	sun.shadow_enabled = shadows
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS
	sun.directional_shadow_max_distance = 70.0 if quality == "high" else 45.0
	sun.shadow_bias = 0.04
	sun.shadow_normal_bias = 1.2
	add_child(sun)
	var haze := Color(str(look.get("haze", "#cdb99a")))
	if low:
		haze = haze.lerp(Color("#e0a070"), 0.3)
	var sky_mat := ProceduralSkyMaterial.new()
	sky_mat.sky_top_color = Color("#3d6fb0").lerp(Color("#6a7f96"), 0.6 if raining else 0.0)
	sky_mat.sky_horizon_color = haze.lerp(Color.WHITE, 0.15)
	sky_mat.ground_horizon_color = haze
	sky_mat.ground_bottom_color = Color(str(look.get("ground", "#8a7a5c"))).darkened(0.3)
	sky_mat.sun_angle_max = 30.0
	sky_mat.sky_curve = 0.12
	var sky := Sky.new()
	sky.sky_material = sky_mat
	# Medium and high: a real photographed sky (HDRI, Poly Haven) that also lights the scene.
	if quality != "low":
		var which := "overcast" if raining or look_id == "snow" else "golden" if low else "clear" if rng.randf() < 0.5 else "cloudy"
		var hp := "res://assets/sky/%s.hdr" % which
		if ResourceLoader.exists(hp):
			var pano := PanoramaSkyMaterial.new()
			pano.panorama = load(hp)
			pano.energy_multiplier = 0.9 if which != "golden" else 0.8
			sky.sky_material = pano
			sky.radiance_size = Sky.RADIANCE_SIZE_128
	env = Environment.new()
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_energy = 0.55
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.tonemap_exposure = 0.92
	env.fog_enabled = true
	env.fog_light_color = haze
	env.fog_density = float(a.fog) * (1.35 if raining else 1.0) * 0.9
	env.fog_sky_affect = 0.35
	env.fog_aerial_perspective = 0.4
	if quality == "high":
		env.glow_enabled = true
		env.glow_intensity = 0.5
		env.glow_bloom = 0.05
		env.ssao_enabled = false
	env.adjustment_enabled = true
	env.adjustment_saturation = 1.08
	env.adjustment_contrast = 1.05
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	if raining:
		_rain()
	if a.get("dust", false):
		_dust()
	if a.get("snow", false):
		_snowfall()

func _rain() -> void:
	rain = GPUParticles3D.new()
	rain.amount = 1800 if quality != "low" else 700
	rain.lifetime = 1.1
	rain.visibility_aabb = AABB(Vector3(-30, -2, -30), Vector3(60, 34, 60))
	var pm := ParticleProcessMaterial.new()
	pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	pm.emission_box_extents = Vector3(28, 1, 28)
	pm.direction = Vector3(0.05, -1, 0)
	pm.spread = 2.0
	pm.initial_velocity_min = 26.0
	pm.initial_velocity_max = 30.0
	pm.gravity = Vector3.ZERO
	rain.process_material = pm
	var q := QuadMesh.new()
	q.size = Vector2(0.025, 0.7)
	var mm := StandardMaterial3D.new()
	mm.albedo_color = Color(0.75, 0.8, 0.85, 0.35)
	mm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mm.billboard_mode = BaseMaterial3D.BILLBOARD_FIXED_Y
	q.material = mm
	rain.draw_pass_1 = q
	add_child(rain)

func _snowfall() -> void:
	var s := GPUParticles3D.new()
	s.amount = 900 if quality != "low" else 350
	s.lifetime = 6.0
	s.visibility_aabb = AABB(Vector3(-30, -2, -30), Vector3(60, 30, 60))
	var pm := ParticleProcessMaterial.new()
	pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	pm.emission_box_extents = Vector3(28, 1, 28)
	pm.direction = Vector3(0.2, -1, 0.1)
	pm.spread = 25.0
	pm.initial_velocity_min = 1.2
	pm.initial_velocity_max = 2.4
	pm.gravity = Vector3.ZERO
	pm.turbulence_enabled = true
	pm.turbulence_noise_strength = 0.6
	s.process_material = pm
	var q := QuadMesh.new()
	q.size = Vector2(0.06, 0.06)
	var mm := StandardMaterial3D.new()
	mm.albedo_color = Color(1, 1, 1, 0.85)
	mm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mm.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	q.material = mm
	s.draw_pass_1 = q
	s.position.y = 22.0
	rain = s  # follows the camera like the rain does
	add_child(s)

func _dust() -> void:
	dust = GPUParticles3D.new()
	dust.amount = 300
	dust.lifetime = 8.0
	dust.visibility_aabb = AABB(Vector3(-25, -1, -25), Vector3(50, 10, 50))
	var pm := ParticleProcessMaterial.new()
	pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	pm.emission_box_extents = Vector3(25, 4, 25)
	pm.direction = Vector3(1, 0.1, 0.3)
	pm.initial_velocity_min = 0.3
	pm.initial_velocity_max = 0.9
	pm.gravity = Vector3.ZERO
	dust.process_material = pm
	var q := QuadMesh.new()
	q.size = Vector2(0.03, 0.03)
	var mm := StandardMaterial3D.new()
	mm.albedo_color = Color(0.94, 0.85, 0.66, 0.35)
	mm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mm.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	q.material = mm
	dust.draw_pass_1 = q
	add_child(dust)

# ---------- terrain ----------
var _grid := PackedFloat32Array()
func _noise(x: float, z: float) -> float:
	if _grid.is_empty():
		var r := RandomNumberGenerator.new()
		r.seed = int(map.get("seed", 1))
		_grid.resize(64 * 64)
		for i in _grid.size():
			_grid[i] = r.randf()
	var gx := fposmod(x / 18.0, 64.0)
	var gz := fposmod(z / 18.0, 64.0)
	var x0 := int(floor(gx))
	var z0 := int(floor(gz))
	var fx := gx - x0
	var fz := gz - z0
	var g := func(a: int, b: int) -> float: return _grid[(b % 64) * 64 + (a % 64)]
	return (g.call(x0, z0) * (1 - fx) + g.call(x0 + 1, z0) * fx) * (1 - fz) + (g.call(x0, z0 + 1) * (1 - fx) + g.call(x0 + 1, z0 + 1) * fx) * fz

func _terrain_y(x: float, z: float) -> float:
	var y := 0.0
	var d: float = max(absf(x), absf(z)) - float(map.half)
	if d > 0:
		y = max(0.0, d - 4.0) * 0.04 * (_noise(x * 0.4, z * 0.4) + 0.4) * 8.0
	for w in map.get("water", []):
		var dx: float = max(max(w.x0 - x, 0.0), x - w.x1)
		var dz: float = max(max(w.z0 - z, 0.0), z - w.z1)
		var dd := sqrt(dx * dx + dz * dz)
		if dd < 1.5:
			y = min(y, -0.95 * (1.0 - dd / 1.5))
	return y

func _terrain() -> void:
	var sh := Shader.new()
	sh.code = """
shader_type spatial;
render_mode cull_back;
uniform sampler2D ground_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D ground_n : hint_normal, filter_linear_mipmap, repeat_enable;
uniform sampler2D patch_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D mask_tex : filter_linear, repeat_enable;
uniform float use_normal = 1.0;
uniform vec4 opens[4];
varying vec3 wpos;
void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}
void fragment() {
	for (int k = 0; k < 4; k++) {
		vec4 o = opens[k];
		if (wpos.x > o.x && wpos.x < o.z && wpos.z > o.y && wpos.z < o.w) discard;
	}
	vec2 uv = wpos.xz / 9.0;
	vec3 g = texture(ground_tex, uv).rgb;
	vec3 p = texture(patch_tex, uv * 1.31 + 0.17).rgb;
	float m = texture(mask_tex, uv * 0.043).r;
	float m2 = texture(mask_tex, uv * 0.009 + 0.37).r;
	float blend = smoothstep(0.46, 0.62, m);
	vec3 col = mix(g, p, blend) * (0.82 + m2 * 0.36);
	ALBEDO = col * COLOR.rgb;
	ROUGHNESS = 0.95;
	SPECULAR = 0.2;
	if (use_normal > 0.5) NORMAL_MAP = texture(ground_n, uv).rgb;
}
"""
	var mat := ShaderMaterial.new()
	mat.shader = sh
	var gname: String = GROUND_TEX.get(look_id, GROUND_TEX.get(biome, "ground_dirt"))
	mat.set_shader_parameter("ground_tex", tex(gname))
	mat.set_shader_parameter("ground_n", tex(gname + "_n"))
	var green := float(look.get("grass", 0.3))
	mat.set_shader_parameter("patch_tex", tex(PATCH_TEX.get(look_id, "grass")))
	var nt := NoiseTexture2D.new()
	nt.seamless = true
	nt.width = 256
	nt.height = 256
	var fn := FastNoiseLite.new()
	fn.frequency = 0.02
	fn.seed = int(map.get("seed", 1)) % 10000
	nt.noise = fn
	nt.normalize = true
	mat.set_shader_parameter("mask_tex", nt)
	mat.set_shader_parameter("use_normal", 0.0 if quality == "low" else 1.0)
	var opens: Array = []
	for o in map.get("openings", []):
		if opens.size() < 4:
			opens.append(Vector4(o.x0, o.z0, o.x1, o.z1))
	while opens.size() < 4:
		opens.append(Vector4(1e5, 1e5, 1e5, 1e5))
	mat.set_shader_parameter("opens", opens)
	var half := float(map.half)
	var inner := (half + 10.0) * 2.0
	add_child(_terrain_patch(inner, int(round(inner / (1.5 if quality == "low" else 1.25))), 0.0, mat, green))
	add_child(_terrain_patch(700.0, 90, 0.04, mat, green))

func _terrain_patch(size: float, segs: int, drop: float, mat: Material, green: float) -> MeshInstance3D:
	var n := segs + 1
	var verts := PackedVector3Array()
	var cols := PackedColorArray()
	var norms := PackedVector3Array()
	var tans := PackedFloat32Array()
	var idx := PackedInt32Array()
	tans.resize(n * n * 4)
	verts.resize(n * n)
	cols.resize(n * n)
	norms.resize(n * n)
	var step := size / segs
	var hs := PackedFloat32Array()
	hs.resize(n * n)
	for j in n:
		for i in n:
			var x := -size / 2.0 + i * step
			var z := -size / 2.0 + j * step
			hs[j * n + i] = _terrain_y(x, z) - drop
	for j in n:
		for i in n:
			var k := j * n + i
			var x := -size / 2.0 + i * step
			var z := -size / 2.0 + j * step
			var y := hs[k]
			verts[k] = Vector3(x, y, z)
			var hl := hs[j * n + max(0, i - 1)]
			var hr := hs[j * n + min(n - 1, i + 1)]
			var hd := hs[max(0, j - 1) * n + i]
			var hu := hs[min(n - 1, j + 1) * n + i]
			var nn := Vector3(hl - hr, 2.0 * step, hd - hu).normalized()
			norms[k] = nn
			# Texture u runs along +x (world-space UVs in the shader).
			var tt := (Vector3(1, 0, 0) - nn * nn.x).normalized()
			tans[k * 4] = tt.x
			tans[k * 4 + 1] = tt.y
			tans[k * 4 + 2] = tt.z
			tans[k * 4 + 3] = 1.0
			var v := _noise(x, z)
			var v2 := _noise(x * 3.1 + 40.0, z * 3.1)
			var g: float = max(0.0, (v - 0.45) * 2.0) * green
			var shade := (0.82 + v2 * 0.3) * 0.86
			var c := Color(shade * (1.0 - g * 0.4), shade * (1.0 + g * 0.04), shade * (1.0 - g * 0.45))
			if y < -0.1:
				c = Color(c.r * 0.55, c.g * 0.55, c.b * 0.5)
			cols[k] = c
	for j in segs:
		for i in segs:
			var a := j * n + i
			var b := a + 1
			var c2 := a + n
			var d := c2 + 1
			idx.append_array([a, b, c2, b, d, c2])
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = verts
	arr[Mesh.ARRAY_NORMAL] = norms
	arr[Mesh.ARRAY_TANGENT] = tans
	arr[Mesh.ARRAY_COLOR] = cols
	arr[Mesh.ARRAY_INDEX] = idx
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	m.surface_set_material(0, mat)
	var mi := MeshInstance3D.new()
	mi.mesh = m
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return mi

# ---------- every collision box, merged per material ----------
func _boxes() -> void:
	mats = {
		"concrete": smat("concrete"),
		"facade": smat("facade", 0.4, 0.2),
		"sandbag": smat("sandbag"),
		"crate": smat("crate", 0.85),
		"mud": smat("mud"),
		"plaster": smat("plaster"),
		"plank": smat("plank"),
		"stone": smat("stone"),
		"zinc": smat("zinc", 0.55, 0.5),
		"metal": smat("metal", 0.6, 0.5),
		"container": smat("container", 0.6, 0.3),
		"rust": smat("rust", 0.8, 0.35),
		"perimeter": smat("concrete"),
		"rock": smat("rock", 0.95),
	}
	var mb := MeshB.new()
	var wrecks: Array = []
	var drums: Array = []
	for b in map.get("boxes", []):
		if b.get("hidden", false):
			continue
		var k: String = b.get("kind", "")
		if b.get("prop", "") == "drum":
			drums.append(b)
			continue
		if b.get("prop", "") == "wreck":
			wrecks.append(b)
			continue
		if k == "adwall" or k == "vehicle" or b.get("headstone", false) or b.get("tomb", false) or b.get("cave", false):
			continue
		if k == "tunnel":
			var bb: Dictionary = b
			if b.get("ceil", false):
				bb = b.duplicate()
				bb.y1 = -0.05
			mb.box("stone", bb, 2.5, Color(0.42, 0.4, 0.38) if b.get("floor", false) else Color(0.55, 0.52, 0.48))
			continue
		match k:
			"stairs":
				mb.box("stone", b, 1.2, Color(0.7, 0.67, 0.62))
			"perimeter":
				mb.box("perimeter", b, 4, Color(0.85, 0.84, 0.8))
			"concrete":
				if b.get("tower", false):
					mb.box("facade", b, 12, Color.WHITE)
				else:
					mb.box("concrete", b, 3, Color(0.95, 0.94, 0.92))
			"sandbag":
				mb.box("sandbag", b, 1.8)
			"crate":
				mb.box("crate", b, 0, Color(0.8, 0.7, 0.6) if b.get("prop", "") == "logs" else Color.WHITE)
			"mud", "mudthick":
				mb.box("mud", b, 3, Color(1.05, 0.92, 0.85) if k == "mudthick" else Color.WHITE)
			"plaster":
				if b.get("roof", false):
					mb.box("plaster", b, 3, Color(0.8, 0.8, 0.78))
				else:
					var cx := roundf((b.x0 + b.x1) / 16.0)
					var cz := roundf((b.z0 + b.z1) / 16.0)
					var h := fposmod(absf(sin(cx * 3.1 + cz * 7.7) * 9871.3), 1.0)
					mb.box("plaster", b, 3, Color(PLASTER_TINTS[int(h * PLASTER_TINTS.size()) % PLASTER_TINTS.size()]))
			"plank", "bridge", "stall":
				mb.box("plank", b, 2.5, Color(1.1, 0.95, 0.8) if k == "stall" else Color.WHITE)
			"stone":
				mb.box("stone", b, 3)
			"zinc":
				mb.box("zinc", b, 3)
			"container":
				var h2 := _hash(b.x0, b.z0)
				mb.box("container", b, 2.5, Color(CONTAINER_TINTS[int(h2 * CONTAINER_TINTS.size()) % CONTAINER_TINTS.size()]))
			"metal", "pipe", "tank":
				mb.box("metal", b, 2)
			"ruin":
				mb.box("mud" if biome == "sahel" else "concrete", b, 3, Color(0.5, 0.46, 0.41))
			"rubble":
				mb.box("concrete", b, 1.5, Color(0.55, 0.52, 0.48))
			"warehouse":
				mb.box("zinc", b, 3, Color(0.72, 0.78, 0.82))
			"wagon":
				if b.get("style", "") == "tanker" or b.get("style", "") == "loco":
					mb.box("metal", b, 3, Color(0.3, 0.3, 0.32) if b.get("style", "") == "loco" else Color(0.75, 0.75, 0.78))
				else:
					mb.box("rust", b, 3, Color(0.7, 0.62, 0.55) if b.get("style", "") == "flat" else Color(0.95, 0.75, 0.6))
			"rock", "trunk":
				pass  # drawn as rocks / trees
			_:
				mb.box("concrete", b, 3)
	mb.build(self, mats, shadows)
	_wrecks(wrecks)
	_drums(drums)

func _wrecks(list: Array) -> void:
	if list.is_empty():
		return
	var faded := ["#7d7a70", "#6b5a48", "#8a8f86", "#5d6b74", "#9a8a6a", "#6a4a40", "#40484c"]
	var mb := MeshB.new()
	for b in list:
		var cx: float = (b.x0 + b.x1) / 2.0
		var cz: float = (b.z0 + b.z1) / 2.0
		var h := _hash(cx, cz)
		var col := Color(faded[int(h * faded.size()) % faded.size()])
		if h < 0.42:
			col = Color(0.12, 0.1, 0.09)
		var body := {"x0": b.x0 + 0.05, "x1": b.x1 - 0.05, "z0": b.z0 + 0.05, "z1": b.z1 - 0.05, "y0": 0.25, "y1": b.y1 * 0.62}
		mb.box("rust" if h > 0.42 and h < 0.7 else "metal", body, 2, col)
		var along: bool = b.x1 - b.x0 > b.z1 - b.z0
		var cab := body.duplicate()
		if along:
			cab.x0 = lerp(b.x0, b.x1, 0.25)
			cab.x1 = lerp(b.x0, b.x1, 0.7)
		else:
			cab.z0 = lerp(b.z0, b.z1, 0.25)
			cab.z1 = lerp(b.z0, b.z1, 0.7)
		cab.x0 += 0.1
		cab.x1 -= 0.1
		cab.z0 += 0.1
		cab.z1 -= 0.1
		cab.y0 = body.y1
		cab.y1 = b.y1
		mb.box("metal", cab, 2, col.darkened(0.35))
	mb.build(self, mats, shadows)

func _drums(list: Array) -> void:
	var cyl := CylinderMesh.new()
	cyl.top_radius = 0.33
	cyl.bottom_radius = 0.33
	cyl.height = 0.92
	cyl.radial_segments = 14
	var fuel := flat(Color("#a8231c"), 0.5, 0.5)
	var water := flat(Color("#2d5fa8"), 0.4, 0.0)
	for b in list:
		var mi := MeshInstance3D.new()
		mi.mesh = cyl
		mi.material_override = fuel if b.get("fuel", false) else water
		mi.position = Vector3((b.x0 + b.x1) / 2.0, 0.46, (b.z0 + b.z1) / 2.0)
		add_child(mi)
		if b.has("drum"):
			drum_nodes[int(b.drum)] = [mi, b]

## A drum blew up: hide it and sink its collision box, exactly like the server.
func kill_drum(i: int) -> void:
	var d = drum_nodes.get(i)
	if d == null or d[0].visible == false:
		return
	d[0].visible = false
	var b: Dictionary = d[1]
	b["oy0"] = b.y0
	b["oy1"] = b.y1
	b.y0 = -3.0
	b.y1 = -2.5

func restore_drums() -> void:
	for i in drum_nodes:
		var d = drum_nodes[i]
		if not d[0].visible:
			d[0].visible = true
			var b: Dictionary = d[1]
			if b.has("oy0"):
				b.y0 = b.oy0
				b.y1 = b.oy1

# ---------- rivers, creeks, lakes ----------
func _water() -> void:
	var sh := Shader.new()
	sh.code = """
shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back, specular_schlick_ggx;
uniform sampler2D nrm : hint_normal, filter_linear_mipmap, repeat_enable;
uniform vec4 col : source_color = vec4(0.19, 0.27, 0.29, 1.0);
uniform float t = 0.0;
varying vec3 wpos;
void vertex() { wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz; }
void fragment() {
	vec2 uv = wpos.xz / 6.0;
	vec3 n1 = texture(nrm, uv + vec2(t * 0.012, t * 0.03)).rgb;
	vec3 n2 = texture(nrm, uv * 0.6 - vec2(t * 0.02, t * 0.01)).rgb;
	NORMAL_MAP = normalize(n1 + n2 - 1.0) * 0.5 + 0.5;
	NORMAL_MAP_DEPTH = 0.4;
	float fres = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 3.0);
	ALBEDO = col.rgb;
	ROUGHNESS = 0.06;
	METALLIC = 0.0;
	SPECULAR = 0.7;
	ALPHA = mix(0.82, 0.97, fres);
}
"""
	for w in map.get("water", []):
		var mat := ShaderMaterial.new()
		mat.shader = sh
		mat.set_shader_parameter("nrm", tex("water_n"))
		var c := Color("#2f3a2a") if biome == "creeks" else Color("#2a3d44") if biome == "urban" else Color("#31464a")
		mat.set_shader_parameter("col", c)
		water_mats.append(mat)
		var pm := PlaneMesh.new()
		var dz: float = w.z1 - w.z0
		pm.size = Vector2(w.x1 - w.x0 + 2.0, dz + (30.0 if dz > 200 else 2.0))
		pm.material = mat
		var mi := MeshInstance3D.new()
		mi.mesh = pm
		mi.position = Vector3((w.x0 + w.x1) / 2.0, -0.18, (w.z0 + w.z1) / 2.0)
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(mi)

# ---------- trees ----------
func _card_mat(name: String) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_texture = tex(name)
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
	m.alpha_scissor_threshold = 0.5
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.roughness = 0.85
	m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	m.vertex_color_use_as_albedo = true
	return m

## A tapered (optionally bent) trunk as rings.
func _trunk(mb: MeshB, key: String, h: float, r0: float, r1: float, bend := 0.0, segs := 7, rings := 5, base := Vector3.ZERO) -> Vector3:
	var top := base
	var prev := []
	for k in range(rings + 1):
		var f := float(k) / rings
		var c := base + Vector3(bend * f * f, h * f, 0)
		var r: float = lerp(r0, r1, f)
		var ring := []
		for s in segs:
			var a := TAU * s / segs
			ring.append(c + Vector3(cos(a) * r, 0, sin(a) * r))
		if k > 0:
			for s in segs:
				var s2 := (s + 1) % segs
				var a0: Vector3 = prev[s]
				var a1: Vector3 = prev[s2]
				var b0: Vector3 = ring[s]
				var b1: Vector3 = ring[s2]
				var n := ((a0 + b0) / 2.0 - c).normalized()
				n.y = 0
				mb.quad(key, a0, b0, b1, a1, n.normalized(), Vector2(float(s) / segs * 2.0, (f - 1.0 / rings) * h / 2.0), Vector2(float(s) / segs * 2.0, f * h / 2.0), Vector2(float(s + 1) / segs * 2.0, f * h / 2.0), Vector2(float(s + 1) / segs * 2.0, (f - 1.0 / rings) * h / 2.0), Color.WHITE, false)
		prev = ring
		top = c
	return top

## Leaf card: a quad facing up-and-out from p in direction dir.
func _frond(mb: MeshB, key: String, p: Vector3, yaw: float, length: float, width: float, droop: float, col := Color.WHITE) -> void:
	var fwd := Vector3(cos(yaw), 0, sin(yaw))
	var side := Vector3(-sin(yaw), 0, cos(yaw)) * width * 0.5
	var mid := p + fwd * length * 0.5 + Vector3(0, length * 0.12, 0)
	var tip := p + fwd * length + Vector3(0, -droop, 0)
	mb.quad(key, p - side * 0.3, mid - side, mid + side, p + side * 0.3, Vector3.UP, Vector2(0, 1), Vector2(0, 0.5), Vector2(1, 0.5), Vector2(1, 1), col, false)
	mb.quad(key, mid - side, tip - side * 0.2, tip + side * 0.2, mid + side, Vector3.UP, Vector2(0, 0.5), Vector2(0, 0), Vector2(1, 0), Vector2(1, 0.5), col, false)

func _canopy(mb: MeshB, key: String, c: Vector3, r: float, h: float, col: Color) -> void:
	# Crossed leaf clumps around a centre: reads as a full canopy from every side.
	for k in 3:
		var a := PI / 3.0 * k
		var dx := Vector3(cos(a), 0, sin(a)) * r
		var up := Vector3(0, h, 0)
		mb.quad(key, c - dx - up * 0.5, c + dx - up * 0.5, c + dx + up * 0.5, c - dx + up * 0.5, Vector3(sin(a), 0.3, -cos(a)).normalized(), Vector2(0, 1), Vector2(1, 1), Vector2(1, 0), Vector2(0, 0), col, false)
	mb.quad(key, c + Vector3(-r, 0, -r), c + Vector3(r, 0, -r), c + Vector3(r, 0, r), c + Vector3(-r, 0, r), Vector3.UP, Vector2(0, 0), Vector2(1, 0), Vector2(1, 1), Vector2(0, 1), col, false)

func _tree_mesh(type: String) -> Array:
	var bark := MeshB.new()
	var leaves := MeshB.new()
	var rr := RandomNumberGenerator.new()
	rr.seed = type.hash()
	var leaf_key := "leaves"
	match type:
		"palm", "plantain":
			var h := 7.5 if type == "palm" else 2.6
			var top := _trunk(bark, "bark", h, 0.2 if type == "palm" else 0.14, 0.14 if type == "palm" else 0.1, 0.8 if type == "palm" else 0.0)
			var n := 10 if type == "palm" else 7
			for k in n:
				_frond(leaves, "frond", top, TAU * k / n + rr.randf() * 0.3, 3.6 if type == "palm" else 2.0, 1.1 if type == "palm" else 0.9, 1.6 if type == "palm" else 0.4, Color(1, 1, 1) if type == "palm" else Color(0.9, 1.1, 0.8))
			leaf_key = "frond"
		"baobab":
			var top := _trunk(bark, "bark", 5.0, 1.3, 0.7)
			for k in 6:
				var a := TAU * k / 6.0
				_trunk(bark, "bark", 2.0, 0.25, 0.08, 0.0, 5, 2, top + Vector3(cos(a) * 0.5, -0.4, sin(a) * 0.5))
				_canopy(leaves, "leaves", top + Vector3(cos(a) * 1.8, 1.4, sin(a) * 1.8), 1.3, 1.6, Color(0.9, 0.95, 0.8))
		"acacia":
			var top := _trunk(bark, "bark", 3.4, 0.22, 0.14, 0.5)
			for k in 5:
				var a := TAU * k / 5.0
				_canopy(leaves, "leaves", top + Vector3(cos(a) * 1.9, 0.6, sin(a) * 1.9), 2.0, 0.9, Color(0.95, 1.0, 0.75))
			_canopy(leaves, "leaves", top + Vector3(0, 0.8, 0), 2.4, 1.0, Color(0.95, 1.0, 0.75))
		"eucalyptus":
			var top := _trunk(bark, "bark", 11.0, 0.28, 0.12, 0.3)
			for k in 4:
				_canopy(leaves, "leaves", top + Vector3(rr.randf_range(-1, 1), -2.0 + k * 1.2, rr.randf_range(-1, 1)), 1.6, 2.2, Color(0.85, 1.0, 0.9))
		"iroko":
			var top := _trunk(bark, "bark", 10.0, 0.6, 0.35)
			for k in 7:
				var a := TAU * k / 7.0
				_canopy(leaves, "leaves", top + Vector3(cos(a) * 2.6, rr.randf_range(-0.5, 1.5), sin(a) * 2.6), 2.6, 2.8, Color(0.8, 0.95, 0.75))
			_canopy(leaves, "leaves", top + Vector3(0, 2.0, 0), 3.0, 2.6, Color(0.8, 0.95, 0.75))
		"mangrove":
			var top := _trunk(bark, "bark", 2.4, 0.18, 0.14)
			for k in 6:
				var a := TAU * k / 6.0
				_trunk(bark, "bark", 1.2, 0.07, 0.06, 0.0, 4, 2, Vector3(cos(a) * 0.9, 0, sin(a) * 0.9))
			for k in 5:
				var a := TAU * k / 5.0
				_canopy(leaves, "leaves", top + Vector3(cos(a) * 1.4, 0.6, sin(a) * 1.4), 1.6, 1.6, Color(0.75, 0.9, 0.7))
		"pine":
			var top := _trunk(bark, "bark", 10.0, 0.3, 0.12)
			for k in 5:
				_canopy(leaves, "leaves", top + Vector3(0, -6.8 + k * 1.65, 0), 2.5 - k * 0.45, 1.5, Color(0.55, 0.72, 0.6))
		"birch":
			var top := _trunk(bark, "bark", 9.0, 0.18, 0.08, 0.15)
			for k in 4:
				_canopy(leaves, "leaves", top + Vector3(rr.randf_range(-0.8, 0.8), -2.5 + k * 1.1, rr.randf_range(-0.8, 0.8)), 1.4, 1.8, Color(1.05, 1.15, 0.8))
		_:  # mango, neem, shea, almond, oak: round canopies
			var tall := {"mango": 4.0, "neem": 5.0, "shea": 3.6, "almond": 4.2, "oak": 4.6}.get(type, 4.0)
			var top := _trunk(bark, "bark", tall, 0.3, 0.2, 0.2)
			for k in 6:
				var a := TAU * k / 6.0
				_canopy(leaves, "leaves", top + Vector3(cos(a) * 1.7, rr.randf_range(0.2, 1.4), sin(a) * 1.7), 1.9, 2.2, Color(1, 1, 1))
			_canopy(leaves, "leaves", top + Vector3(0, 2.0, 0), 2.2, 2.2, Color(1, 1, 1))
	return [bark, leaves, leaf_key]

func _trees() -> void:
	var by_type := {}
	for tr in map.get("trees", []):
		var ty: String = tr.get("type", "palm")
		if not by_type.has(ty):
			by_type[ty] = []
		by_type[ty].append(tr)
	var bark_mat := smat("bark", 0.95)
	bark_mat.vertex_color_use_as_albedo = false
	var leaf_mats := {"leaves": _card_mat("leaves"), "frond": _card_mat("frond")}
	for ty in by_type:
		var parts := _tree_mesh(ty)
		var meshes: Array = []
		for mbi in [parts[0], parts[1]]:
			for key in mbi.groups:
				var mat: Material = bark_mat if key == "bark" else leaf_mats[key]
				meshes.append(MeshB.mesh_from(mbi.groups[key], mat))
		for mesh in meshes:
			var mm := MultiMesh.new()
			mm.transform_format = MultiMesh.TRANSFORM_3D
			mm.mesh = mesh
			var list: Array = by_type[ty]
			mm.instance_count = list.size()
			for i in list.size():
				var tr: Dictionary = list[i]
				var s := float(tr.get("s", 1.0))
				var xf := Transform3D(Basis(Vector3.UP, float(tr.get("rot", 0.0))).scaled(Vector3(s, s, s)), Vector3(float(tr.x), 0, float(tr.z)))
				mm.set_instance_transform(i, xf)
			var mmi := MultiMeshInstance3D.new()
			mmi.multimesh = mm
			mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if shadows else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			add_child(mmi)

func _grass() -> void:
	var patches: Array = map.get("grass", [])
	if patches.is_empty():
		return
	var mb := MeshB.new()
	for k in 3:
		var a := PI / 3.0 * k
		var dx := Vector3(cos(a), 0, sin(a)) * 0.45
		mb.quad("tuft", -dx, dx, dx + Vector3(0, 0.6, 0), -dx + Vector3(0, 0.6, 0), Vector3.UP, Vector2(0, 1), Vector2(1, 1), Vector2(1, 0), Vector2(0, 0), Color.WHITE, false)
	var mesh := MeshB.mesh_from(mb.groups["tuft"], _card_mat("tuft"))
	var rr := RandomNumberGenerator.new()
	rr.seed = 77
	var per := 30 if quality == "high" else 18 if quality == "medium" else 8
	var xfs: Array = []
	for p in patches:
		for i in per:
			var a := rr.randf() * TAU
			var r := sqrt(rr.randf()) * 3.2 * float(p.get("s", 1.0))
			var x := float(p.x) + cos(a) * r
			var z := float(p.z) + sin(a) * r
			if phys.in_water(x, z) or not phys.query(x - 0.2, z - 0.2, x + 0.2, z + 0.2).is_empty():
				continue
			var s := rr.randf_range(0.7, 1.4)
			xfs.append(Transform3D(Basis(Vector3.UP, rr.randf() * TAU).scaled(Vector3(s, s, s)), Vector3(x, 0, z)))
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = mesh
	mm.instance_count = xfs.size()
	for i in xfs.size():
		mm.set_instance_transform(i, xfs[i])
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = mm
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mmi.visibility_range_end = 70.0
	add_child(mmi)

func _rock_mesh(seed_v: int) -> ArrayMesh:
	var sm := SphereMesh.new()
	sm.radial_segments = 10
	sm.rings = 6
	var arrs := sm.get_mesh_arrays()
	var v: PackedVector3Array = arrs[Mesh.ARRAY_VERTEX]
	var fn := FastNoiseLite.new()
	fn.seed = seed_v
	fn.frequency = 1.6
	for i in v.size():
		var p := v[i]
		var k := 1.0 + fn.get_noise_3dv(p) * 0.35
		v[i] = Vector3(p.x * k, max(-0.1, p.y * k), p.z * k)
	arrs[Mesh.ARRAY_VERTEX] = v
	arrs[Mesh.ARRAY_NORMAL] = null
	var st := SurfaceTool.new()
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrs)
	st.create_from(m, 0)
	st.generate_normals()
	var out := st.commit()
	var rm := smat("rock", 0.95)
	rm.vertex_color_use_as_albedo = false
	rm.uv1_triplanar = true
	rm.uv1_scale = Vector3(0.5, 0.5, 0.5)
	out.surface_set_material(0, rm)
	return out

func _rocks() -> void:
	var list: Array = map.get("rocks", [])
	for v in map.get("visuals", []):
		if v.type == "boulder":
			list.append({"x": v.x, "z": v.z, "r": v.r, "h": v.h, "rot": 0.0})
	if list.is_empty():
		return
	var mesh := _rock_mesh(int(map.get("seed", 3)))
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = mesh
	mm.instance_count = list.size()
	for i in list.size():
		var r: Dictionary = list[i]
		var rad := float(r.get("r", 2.0))
		var h := float(r.get("h", 2.0))
		mm.set_instance_transform(i, Transform3D(Basis(Vector3.UP, float(r.get("rot", 0.0))).scaled(Vector3(rad, h * 0.75, rad)), Vector3(float(r.x), h * 0.2, float(r.z))))
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = mm
	add_child(mmi)

# ---------- roofs, tanks, lamps, flags, landmarks ----------
func _visuals() -> void:
	var mb := MeshB.new()
	var extra := {
		"roof_zinc": smat("zinc", 0.5, 0.5),
		"canvas": flat(Color.WHITE, 0.9),
		"steel": smat("metal", 0.4, 0.7),
		"white": flat(Color("#e8e4dc"), 0.6),
		"dome": flat(Color("#3f6f5a"), 0.5, 0.3),
	}
	for k in extra:
		mats[k] = extra[k]
	mats["roof_zinc"].vertex_color_use_as_albedo = true
	mats["canvas"].vertex_color_use_as_albedo = true
	mats["white"].vertex_color_use_as_albedo = true
	for v in map.get("visuals", []):
		match str(v.type):
			"zincRoof":
				_pitched(mb, "roof_zinc", v.x, v.z, v.w + 0.6, v.d + 0.6, v.h, 1.3, Color(0.9, 0.9, 0.92))
			"warehouse":
				var w: float = v.w if v.get("alongX", true) else v.d
				var d: float = v.d if v.get("alongX", true) else v.w
				_pitched(mb, "roof_zinc", v.x, v.z, w + 0.4, d + 0.4, v.h, 2.2, Color(0.75, 0.8, 0.85), not v.get("alongX", true))
			"stallRoof":
				var cols := [Color("#d23b2f"), Color("#2d7fd2"), Color("#e8c22c"), Color("#2fa35a")]
				var c: Color = cols[int(_hash(v.x, v.z) * 4) % 4]
				var hw: float = (v.d if v.get("rot", false) else v.w) / 2.0 + 0.3
				var hd: float = (v.w if v.get("rot", false) else v.d) / 2.0 + 0.3
				mb.box("canvas", {"x0": v.x - hw, "x1": v.x + hw, "z0": v.z - hd, "z1": v.z + hd, "y0": 2.2, "y1": 2.3}, 0, c, false)
			"tank":
				_cylinder(mb, "steel", v.x, v.z, v.r, v.h, Color(0.85, 0.85, 0.88))
			"flag":
				_flag(v)
			"lamp":
				_lamp(v)
			"pumpjack":
				mb.box("steel", {"x0": v.x - 0.3, "x1": v.x + 0.3, "z0": v.z - 0.3, "z1": v.z + 0.3, "y0": 0, "y1": 3.0}, 2, Color(0.25, 0.25, 0.28))
				mb.box("steel", {"x0": v.x - 2.4, "x1": v.x + 2.4, "z0": v.z - 0.2, "z1": v.z + 0.2, "y0": 3.0, "y1": 3.4}, 2, Color(0.8, 0.6, 0.15))
			"flareStack", "smallFlare":
				var h: float = v.get("h", 8.0)
				_cylinder(mb, "steel", v.x, v.z, 0.5 if h > 10 else 0.25, h, Color(0.6, 0.6, 0.62))
				_flame(Vector3(v.x, h, v.z), 3.0 if h > 10 else 1.2)
			"tower":
				mb.box("facade", {"x0": v.x - v.w / 2.0, "x1": v.x + v.w / 2.0, "z0": v.z - v.w / 2.0, "z1": v.z + v.w / 2.0, "y0": 0, "y1": v.h}, 12, Color.WHITE)
			"monolith":
				var rm := {"x0": v.x - v.w / 2.0, "x1": v.x + v.w / 2.0, "z0": v.z - v.d / 2.0, "z1": v.z + v.d / 2.0, "y0": 0, "y1": v.h}
				mb.box("rock", rm, 6, Color(0.75, 0.7, 0.65))
			"heap":
				_cone(mb, "rock", v.x, v.z, v.r, v.h, Color(0.7, 0.62, 0.5))
			"dome":
				_dome(v)
			"landmarkSign":
				_sign(Vector3(v.x, 0, v.z), str(v.get("name", "")))
			"gateArch":
				mb.box("mud", {"x0": v.x - v.w / 2.0, "x1": v.x + v.w / 2.0, "z0": v.z - 1.2, "z1": v.z + 1.2, "y0": v.h - 1.6, "y1": v.h}, 3, Color(1.0, 0.85, 0.7))
			"siteMarker":
				pass  # live site rings are drawn by the battle from the match state
	mb.build(self, mats, shadows)

func _pitched(mb: MeshB, key: String, x: float, z: float, w: float, d: float, h: float, rise: float, col: Color, ridge_z := false) -> void:
	# A two-slope roof; the ridge runs along x (or z).
	var hw := w / 2.0
	var hd := d / 2.0
	if not ridge_z:
		var a := Vector3(x - hw, h, z - hd)
		var b := Vector3(x + hw, h, z - hd)
		var c := Vector3(x + hw, h + rise, z)
		var e := Vector3(x - hw, h + rise, z)
		mb.quad(key, a, e, c, b, Vector3(0, 1, -0.6).normalized(), Vector2(0, 0), Vector2(0, hd / 3.0), Vector2(w / 3.0, hd / 3.0), Vector2(w / 3.0, 0), col, false)
		var a2 := Vector3(x + hw, h, z + hd)
		var b2 := Vector3(x - hw, h, z + hd)
		mb.quad(key, a2, c, e, b2, Vector3(0, 1, 0.6).normalized(), Vector2(0, 0), Vector2(0, hd / 3.0), Vector2(w / 3.0, hd / 3.0), Vector2(w / 3.0, 0), col, false)
		mb.tri(key, Vector3(x - hw, h, z + hd), e, Vector3(x - hw, h, z - hd), Vector2(0, 0), Vector2(0.5, 0.5), Vector2(1, 0), col)
		mb.tri(key, Vector3(x + hw, h, z - hd), c, Vector3(x + hw, h, z + hd), Vector2(0, 0), Vector2(0.5, 0.5), Vector2(1, 0), col)
	else:
		var a := Vector3(x + hw, h, z - hd)
		var b := Vector3(x + hw, h, z + hd)
		var c := Vector3(x, h + rise, z + hd)
		var e := Vector3(x, h + rise, z - hd)
		mb.quad(key, a, b, c, e, Vector3(0.6, 1, 0).normalized(), Vector2(0, 0), Vector2(d / 3.0, 0), Vector2(d / 3.0, hw / 3.0), Vector2(0, hw / 3.0), col, false)
		var a2 := Vector3(x - hw, h, z + hd)
		var b2 := Vector3(x - hw, h, z - hd)
		mb.quad(key, a2, b2, e, c, Vector3(-0.6, 1, 0).normalized(), Vector2(0, 0), Vector2(d / 3.0, 0), Vector2(d / 3.0, hw / 3.0), Vector2(0, hw / 3.0), col, false)
		mb.tri(key, Vector3(x - hw, h, z - hd), e, Vector3(x + hw, h, z - hd), Vector2(0, 0), Vector2(0.5, 0.5), Vector2(1, 0), col)
		mb.tri(key, Vector3(x + hw, h, z + hd), c, Vector3(x - hw, h, z + hd), Vector2(0, 0), Vector2(0.5, 0.5), Vector2(1, 0), col)

func _cylinder(mb: MeshB, key: String, x: float, z: float, r: float, h: float, col: Color, segs := 14) -> void:
	for s in segs:
		var a0 := TAU * s / segs
		var a1 := TAU * (s + 1) / segs
		var p0 := Vector3(x + cos(a0) * r, 0, z + sin(a0) * r)
		var p1 := Vector3(x + cos(a1) * r, 0, z + sin(a1) * r)
		var n := Vector3(cos((a0 + a1) / 2.0), 0, sin((a0 + a1) / 2.0))
		mb.quad(key, p1, p0, p0 + Vector3(0, h, 0), p1 + Vector3(0, h, 0), n, Vector2(a1 * r / 2.0, 0), Vector2(a0 * r / 2.0, 0), Vector2(a0 * r / 2.0, -h / 2.0), Vector2(a1 * r / 2.0, -h / 2.0), col, false)
		mb.tri(key, Vector3(x, h, z), p1 + Vector3(0, h, 0), p0 + Vector3(0, h, 0), Vector2(0.5, 0.5), Vector2(cos(a1) * 0.5 + 0.5, sin(a1) * 0.5 + 0.5), Vector2(cos(a0) * 0.5 + 0.5, sin(a0) * 0.5 + 0.5), col)

func _cone(mb: MeshB, key: String, x: float, z: float, r: float, h: float, col: Color, segs := 12) -> void:
	for s in segs:
		var a0 := TAU * s / segs
		var a1 := TAU * (s + 1) / segs
		mb.tri(key, Vector3(x + cos(a1) * r, 0, z + sin(a1) * r), Vector3(x + cos(a0) * r, 0, z + sin(a0) * r), Vector3(x, h, z), Vector2(a1, 0), Vector2(a0, 0), Vector2((a0 + a1) / 2.0, -h / 2.0), col)

func _flag(v: Dictionary) -> void:
	var pole := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 0.06
	cm.bottom_radius = 0.08
	cm.height = 9.0
	pole.mesh = cm
	pole.material_override = flat(Color(0.75, 0.75, 0.78), 0.4, 0.8)
	pole.position = Vector3(v.x, 4.5, v.z)
	add_child(pole)
	var fl := MeshInstance3D.new()
	var q := QuadMesh.new()
	q.size = Vector2(2.6, 1.6)
	fl.mesh = q
	var m := flat(Kit.side_color(str(v.get("side", "sec"))), 0.9)
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	fl.material_override = m
	fl.position = Vector3(v.x + 1.35, 8.1, v.z)
	add_child(fl)
	flames.append({"flag": fl, "phase": randf() * 10.0})

func _lamp(v: Dictionary) -> void:
	var y0 := float(v.get("y", 0.0))
	var pole := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 0.05
	cm.bottom_radius = 0.07
	cm.height = 3.2
	pole.mesh = cm
	pole.material_override = flat(Color(0.2, 0.2, 0.22), 0.5, 0.6)
	pole.position = Vector3(v.x, y0 + 1.6, v.z)
	add_child(pole)
	var head := MeshInstance3D.new()
	var sm := SphereMesh.new()
	sm.radius = 0.16
	sm.height = 0.32
	head.mesh = sm
	head.material_override = glow(Color("#fff3c8"), 3.0)
	head.position = Vector3(v.x, y0 + 3.25, v.z)
	add_child(head)
	if y0 < -0.3 and lamps.size() < 6:
		# Underground: these really light the tunnel.
		var l := OmniLight3D.new()
		l.light_color = Color("#ffcf7a")
		l.light_energy = 1.4
		l.omni_range = 9.0
		l.position = head.position
		add_child(l)
		lamps.append(l)

func _flame(p: Vector3, size: float) -> void:
	var f := GPUParticles3D.new()
	f.amount = 24
	f.lifetime = 0.7
	var pm := ParticleProcessMaterial.new()
	pm.direction = Vector3(0, 1, 0)
	pm.spread = 12.0
	pm.initial_velocity_min = size * 1.5
	pm.initial_velocity_max = size * 2.5
	pm.gravity = Vector3(0, 1, 0)
	pm.scale_min = 0.6
	pm.scale_max = 1.2
	var grad := Gradient.new()
	grad.set_color(0, Color(1, 0.85, 0.4, 1))
	grad.set_color(1, Color(1, 0.25, 0.05, 0))
	var gt := GradientTexture1D.new()
	gt.gradient = grad
	pm.color_ramp = gt
	f.process_material = pm
	var q := QuadMesh.new()
	q.size = Vector2(size, size)
	var mm := StandardMaterial3D.new()
	mm.vertex_color_use_as_albedo = true
	mm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	mm.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	mm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mm.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	mm.albedo_texture = Fx.soft_dot()
	q.material = mm
	f.draw_pass_1 = q
	f.position = p
	add_child(f)
	Sfx.loop_on("flare%d" % flames.size(), "fire_loop", p, 2.0)
	flames.append({"fire": f})

func _dome(v: Dictionary) -> void:
	var d := MeshInstance3D.new()
	var sm := SphereMesh.new()
	sm.radius = float(v.get("r", 6.0))
	sm.height = float(v.get("r", 6.0))
	sm.is_hemisphere = true
	d.mesh = sm
	d.material_override = mats["dome"]
	d.position = Vector3(v.x, float(v.get("h", 4.6)), v.z)
	add_child(d)

func _sign(p: Vector3, text: String) -> void:
	var l := Label3D.new()
	l.text = text
	l.font = Kit.font_bold
	l.font_size = 64
	l.pixel_size = 0.01
	l.outline_size = 12
	l.modulate = Color("#ffd27a")
	l.billboard = BaseMaterial3D.BILLBOARD_FIXED_Y
	l.position = p + Vector3(0, 4.0, 0)
	add_child(l)

func update(delta: float, cam_pos: Vector3) -> void:
	t += delta
	for m in water_mats:
		m.set_shader_parameter("t", t)
	if sun:
		# Keep the shadow detail around the player.
		pass
	if rain:
		rain.global_position = Vector3(cam_pos.x, cam_pos.y + 14.0, cam_pos.z)
		rain.visible = cam_pos.y > -0.6
	if dust:
		dust.global_position = Vector3(cam_pos.x, cam_pos.y, cam_pos.z)
	for f in flames:
		if f.has("flag"):
			var fl: MeshInstance3D = f.flag
			fl.rotation.y = sin(t * 2.0 + f.phase) * 0.25
