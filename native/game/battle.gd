extends Node3D
## One battle: loads the state's map, builds the world, and runs your soldier (movement, aim,
## shooting, grenades, buying, reviving, driving) against the game server, drawing everyone
## else from its snapshots. The server decides every hit and death, exactly as for the lite app.

const INTERP_MS := 100.0

var main: Node
var info := {}
var my_id := ""
var side := "sec"
var faction := "army"
var mode_id := "conquest"
var state_id := ""
var P := {}
var map := {}
var phys: Phys
var world: World
var fx: Fx
var vehicles: Vehicles
var cam: Camera3D
var vm: ViewModel
var hud: Hud
var touch: Touch
var ui: CanvasLayer
var loading: Control
var soldiers := {}
var roster := {}
var roster_list: Array = []
var me := {}
var status := "alive"
var body := {"x": 0.0, "y": 0.0, "z": 0.0, "vy": 0.0, "on_ground": true, "crouch": false}
var vel := Vector2.ZERO
var yaw := 0.0
var pitch := 0.0
var punch := Vector2.ZERO
var eye := 1.62
var stamina := 6.0
var zoom := 1.0
var ammo := {}
var reload_until := 0.0
var reload_id := ""
var last_fire := 0.0
var trigger := true
var burst := 0
var sites: Array = []
var score := {"sec": 0, "out": 0}
var left_ms := 0.0
var left_at := 0.0
var ads_on := false
var sprinting := false
var send_t := 0.0
var views_t := 0.0
var ready_world := false
var wall_gems: Array = []      # [node, until]
var tile_gems: Array = []      # [node, at, type]
var site_nodes := {}
var proj_nodes: Array = []
var ended := false
var death_by := ""
var step_dist := 0.0
var driving = null             # vehicle entry while you drive
var mouse_look := false
var keys := {}
var smokes: Array = []
var uav_until := 0.0
var last_hurt := 0.0
var ad_slots := {}
var boards: Array = []         # [slot id, node, type, pos, normal]
var heart_t := 0.0
var settings_overlay: Control
var paused := false
var amb_t := 3.0

func begin(m: Dictionary) -> void:
	info = m
	my_id = str(m.get("you", ""))
	side = str(m.get("side", "sec"))
	faction = str(m.get("faction", "army"))
	mode_id = str(m.get("mode", "conquest"))
	state_id = str(m.get("state", ""))
	P = Cfg.player()
	stamina = float(P.get("stamina", 6))
	eye = float(P.get("eye", 1.62))
	for r in m.get("roster", []):
		roster[r.id] = r
	roster_list = m.get("roster", [])
	sites = m.get("sites", [])
	score = m.get("score", score)
	left_ms = float(m.get("timeLimit", 900000)) - (float(m.get("serverTime", 0)) - float(m.get("startedAt", 0)))
	left_at = Time.get_ticks_msec()
	if main and main.last_spawn.size():
		_on_spawn(main.last_spawn)
	if main and main.last_me.size():
		me = main.last_me
	_ui()
	_subscribe()
	Sfx.music("battle")
	_load_map()

func _ui() -> void:
	ui = CanvasLayer.new()
	ui.layer = 5
	add_child(ui)
	touch = Touch.new()
	ui.add_child(touch)
	hud = Hud.new()
	hud.battle = self
	ui.add_child(hud)
	hud.buy.connect(func(item): Net.send({"t": "buy", "item": item}))
	hud.respawn.connect(func(mode): Net.send({"t": "respawn", "mode": mode}))
	hud.quick_chat.connect(func(i): Net.send({"t": "chat", "text": Hud.QUICK[i], "team": true}))
	hud.leave.connect(func(): main.leave_battle())
	hud.settings.connect(_open_settings)
	hud.resume.connect(func(): paused = false)
	loading = Control.new()
	Kit.fill(loading)
	loading.add_child(Kit.bg_rect(Color("#07080b")))
	var c := CenterContainer.new()
	Kit.fill(c)
	loading.add_child(c)
	var v := Kit.vbox(8)
	c.add_child(v)
	var st := Cfg.state_by_id(state_id)
	var t := Kit.title(str(st.get("name", state_id)).to_upper(), 40)
	t.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(t)
	var l := Kit.label("Building the battlefield…", 18, Kit.MUTED)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(l)
	ui.add_child(loading)

# ---------- the map ----------
func _load_map() -> void:
	var cache := "user://maps/%s.json" % state_id
	var http := HTTPRequest.new()
	http.timeout = 30
	add_child(http)
	http.request_completed.connect(func(result, code, _h, bytes):
		http.queue_free()
		var txt := ""
		if result == HTTPRequest.RESULT_SUCCESS and code == 200:
			txt = bytes.get_string_from_utf8()
			DirAccess.make_dir_recursive_absolute("user://maps")
			var f := FileAccess.open(cache, FileAccess.WRITE)
			if f:
				f.store_string(txt)
		elif FileAccess.file_exists(cache):
			txt = FileAccess.get_file_as_string(cache)
		var d = JSON.parse_string(txt) if txt != "" else null
		if d is Dictionary:
			_build(d)
		else:
			hud.toast("We could not load this battlefield. Check your network.", "bad", 5)
			get_tree().create_timer(2.0).timeout.connect(func(): if is_inside_tree(): main.leave_battle()))
	http.request(Cfg.api("/api/native/map/" + state_id))
	_load_ads()

func _build(m: Dictionary) -> void:
	map = m
	phys = Phys.new(m, P)
	world = World.new()
	add_child(world)
	world.build(m, phys, str(Cfg.get_s("quality", "medium")))
	vehicles = Vehicles.new()
	add_child(vehicles)
	vehicles.setup(m, phys)
	fx = Fx.new()
	add_child(fx)
	cam = Camera3D.new()
	cam.near = 0.03
	cam.far = 900.0
	cam.fov = float(Cfg.get_s("fov", 75.0))
	add_child(cam)
	cam.current = true
	fx.cam = cam
	vm = ViewModel.new()
	cam.add_child(vm)
	_build_gems()
	_build_sites()
	_build_boards()
	for d in info.get("drums", []):
		world.kill_drum(int(d))
	var wv: Dictionary = info.get("world", {})
	vehicles.apply_view(wv.get("v", []))
	Sfx.ambience(world.biome, world.raining)
	ready_world = true
	loading.queue_free()
	loading = null
	if not me.is_empty():
		_on_me(me)
	if mode_id == "practice":
		hud.toast("Practice range: dummies never shoot back. Buy any gun, swim and sprint to train.", "info", 6)
	elif Cfg.get_s("bots", true):
		hud.toast("You are fighting alongside bots. Turn bots off on the war map to play real players only.", "info", 5)
	else:
		hud.toast("Real players only: no bots for this room.", "good", 4)

# ---------- network ----------
func _subscribe() -> void:
	Net.on("s", _on_snapshot)
	Net.on("me", _on_me)
	Net.on("spawn", _on_spawn)
	Net.on("correct", func(m): body.x = float(m.x); body.y = float(m.y); body.z = float(m.z); body.vy = 0.0)
	Net.on("shot", _on_shot)
	Net.on("hit", func(m):
		hud.hit(m.get("head", false), m.get("kill", false))
		Sfx.ui("kill" if m.get("kill", false) else "headshot" if m.get("head", false) else "hit"))
	Net.on("hurt", _on_hurt)
	Net.on("kill", _on_kill)
	Net.on("down", func(m):
		if str(m.id) == my_id:
			return
		var r = roster.get(m.id)
		if r and r.side == side:
			hud.toast("%s is down! Get there and hold USE to revive them" % r.name, "bad"))
	Net.on("revived", func(m):
		if str(m.id) == my_id:
			hud.toast("%s revived you! Thank them later." % m.by, "good"))
	Net.on("toast", func(m):
		hud.toast(str(m.text), str(m.get("kind", "info")))
		if m.get("kind") == "gem":
			Sfx.ui("gem")
		elif m.get("kind") == "streak":
			Sfx.ui("alert"))
	Net.on("chat", func(m): hud.toast("%s: %s" % [m.name, m.text], "info", 4))
	Net.on("reload", func(m): if str(m.id) != my_id: Sfx.play("reload", _pos_of(m.id), {"ref": 3.0}))
	Net.on("swing", func(m): if str(m.id) != my_id: Sfx.play("swing", _pos_of(m.id), {"ref": 3.0}))
	Net.on("punchHit", func(m): Sfx.play("punch_heavy" if m.get("heavy", false) else "punch", null if str(m.id) == my_id else _pos_of(m.id)))
	Net.on("secondWind", func(_m): hud.show_banner("SECOND WIND!", Kit.GOLD); hud.toast("You nearly die! Find cover now.", "bad"))
	Net.on("revenge", func(m): hud.show_banner("REVENGE!", Kit.GOLD))
	Net.on("pill", func(m): Sfx.play("heal", null if str(m.id) == my_id else _pos_of(m.id)))
	Net.on("tgem", _on_tgem)
	Net.on("gem", func(m):
		var i := int(m.i)
		if i < wall_gems.size():
			wall_gems[i][1] = float(m.until))
	Net.on("throw", func(m): if str(m.id) != my_id: Sfx.play("throw", _pos_of(m.id)))
	Net.on("smoke", func(m):
		if fx:
			fx.smoke_cloud(Vector3(m.x, 0, m.z), float(m.r), float(m.dur))
		Sfx.play("smoke", Vector3(m.x, 0.5, m.z)))
	Net.on("flashbang", func(m):
		if fx:
			fx.flashbang(Vector3(m.x, m.y, m.z))
		Sfx.play("flashbang", Vector3(m.x, m.y, m.z), {"ref": 12.0}))
	Net.on("flashed", func(m):
		hud.flashed(float(m.s))
		Sfx.flash_duck(float(m.s)))
	Net.on("uav", func(m):
		if m.side == side:
			uav_until = float(m.until)
			hud.toast("%s launched a drone: enemies are on your radar" % m.by, "streak")
		else:
			hud.toast("Enemy drone overhead! They can see where you are", "bad"))
	Net.on("artillery", func(m):
		if m.side != side:
			hud.show_banner("ARTILLERY INCOMING — RUN!", Kit.BAD, 3.5)
			Sfx.ui("alert")
		else:
			hud.toast("%s called in artillery" % m.by, "streak"))
	Net.on("incoming", func(m): Sfx.play("incoming", Vector3(m.x, 30, m.z), {"ref": 30.0, "delay": false}))
	Net.on("boom", _on_boom)
	Net.on("drum", func(m):
		if world:
			world.kill_drum(int(m.i))
		if fx:
			for k in 20:
				fx.puff(Vector3(m.x, 1.0, m.z), Color(0.15, 0.13, 0.12, 0.7), 1.2, 6.0, Vector3(randf_range(-0.4, 0.4), 1.2, randf_range(-0.4, 0.4)), -0.2, 2.0))
	Net.on("vseat", func(m):
		if vehicles == null:
			return
		var e = vehicles.by_index(int(m.i))
		if e:
			e.driver = m.get("id", 0)
		if str(m.get("id", "")) == my_id:
			_start_driving(int(m.i))
		elif driving != null and driving.i == int(m.i):
			_stop_driving()
		if str(m.get("out", "")) == my_id:
			_stop_driving())
	Net.on("vcorrect", func(m):
		if driving != null:
			driving.x = float(m.x)
			driving.z = float(m.z)
			driving.yaw = float(m.yaw)
			driving.speed = 0.0)
	Net.on("vstate", func(m): if vehicles: vehicles.set_state(int(m.i), int(m.s)))
	Net.on("croc", func(m):
		if m.a == "bite" and str(m.get("id", "")) == my_id:
			fx.shake = min(1.4, fx.shake + 0.8))
	Net.on("site", func(m):
		if m.get("neutral", false):
			hud.toast("%s is neutral again" % m.label, "info")
		else:
			var ours: bool = m.owner == side
			hud.show_banner(("WE HOLD " if ours else "ENEMY TOOK ") + str(m.id), Kit.GOOD if ours else Kit.BAD, 3.0)
			Sfx.ui("alert"))
	Net.on("score", _on_score)
	Net.on("discovery", func(m): hud.show_banner("NEW DEPOSIT FOUND — DOUBLE POINTS", Kit.GOLD, 4.0); Sfx.ui("alert"))
	Net.on("bought", func(m):
		Sfx.ui("buy")
		if not Cfg.weapon(str(m.item)).is_empty():
			reload_until = 0.0
		if hud.panel_kind == "buy":
			hud.call_deferred("show_buy", me, int(me.get("level", 1))))
	Net.on("spirit", func(_m): hud.toast("Find any glowing gem on an advert wall!", "gem", 5))
	Net.on("left", func(m):
		var s = soldiers.get(m.id)
		if s:
			s.queue_free()
			soldiers.erase(m.id))
	Net.on("matchEnd", func(m):
		ended = true
		hud.show_end(m, side, my_id)
		touch.reset())
	Net.on("dig", func(m): pass)

func on_match_info(m: Dictionary) -> void:
	# A new round in the same state.
	if str(m.get("state", "")) != state_id:
		return
	ended = false
	hud.close_panel()
	info = m
	sites = m.get("sites", [])
	score = m.get("score", score)
	left_ms = float(m.get("timeLimit", 900000)) - (float(m.get("serverTime", 0)) - float(m.get("startedAt", 0)))
	left_at = Time.get_ticks_msec()
	if world:
		world.restore_drums()
		for d in m.get("drums", []):
			world.kill_drum(int(d))
		vehicles.apply_view(m.get("world", {}).get("v", []))
		_apply_gems(m)
		_sync_sites()
	_stop_driving()

func _pos_of(id) -> Vector3:
	var s = soldiers.get(id)
	return s.chest() if s else Vector3(body.x, body.y + 1.4, body.z)

func body_pos() -> Vector3:
	return Vector3(body.x, body.y, body.z)

func _on_spawn(m: Dictionary) -> void:
	body = {"x": float(m.x), "y": float(m.y), "z": float(m.z), "vy": 0.0, "on_ground": true, "crouch": false}
	vel = Vector2.ZERO
	yaw = float(m.get("yaw", 0.0))
	pitch = 0.0
	stamina = float(P.get("stamina", 6))
	reload_until = 0.0
	if hud and hud.panel_kind == "death":
		hud.close_panel()

func _on_me(m: Dictionary) -> void:
	var prev := status
	me = m
	if not ready_world:
		return
	status = str(m.get("status", "alive"))
	if driving != null and m.get("veh") == null:
		_stop_driving()
	elif driving == null and m.get("veh") != null:
		_start_driving(int(m.veh))
	var w := _weapon()
	if Time.get_ticks_msec() - last_fire > 450 and not (reload_until > Time.get_ticks_msec()):
		ammo = m.get("ammo", {}).get(w, {}).duplicate()
	if w != vm.weapon:
		vm.set_weapon(w, faction)
		ammo = m.get("ammo", {}).get(w, {}).duplicate()
	var ru := float(m.get("reloadUntil", 0))
	if ru > 0 and reload_until == 0.0 and Cfg.weapon(w).has("reload"):
		var left := (ru - Net.server_now()) / 1000.0
		if left > 0.1:
			reload_until = Time.get_ticks_msec() + left * 1000.0
			reload_id = w
			vm.reload(left)
			Sfx.play("reload")
	_hud_me()
	if prev != status:
		_on_status(prev, status)

func _hud_me() -> void:
	var w := _weapon()
	var wd := Cfg.weapon(w)
	hud.set_me(me, ammo, str(wd.get("name", "")), wd.get("melee", false))

func _on_status(prev: String, now: String) -> void:
	vm.visible = now == "alive"
	if now == "dead":
		touch.reset()
		var can: bool = Cfg.rules.get("MODES", {}).get(mode_id, {}).get("respawn", true)
		hud.show_death(death_by, int(me.get("gems", 0)), can, mode_id == "practice")
		hud.status_lbl.text = ""
	elif now == "downed":
		hud.close_panel()
		hud.status_lbl.text = "YOU ARE DOWN — a teammate can revive you"
	elif now == "spirit":
		hud.close_panel()
		hud.status_lbl.text = "SPIRIT RUN: reach any glowing gem"
	elif now == "medevac":
		hud.close_panel()
		hud.status_lbl.text = "MEDEVAC INBOUND…"
	elif now == "alive":
		hud.status_lbl.text = ""
		death_by = ""
		if hud.panel_kind == "death":
			hud.close_panel()

func _weapon() -> String:
	var ws: Dictionary = me.get("weapons", {})
	var w = ws.get(str(me.get("slot", "secondary")))
	return str(w) if w != null else ""

func _on_snapshot(m: Dictionary) -> void:
	if not ready_world:
		return
	var ts := float(m.ts)
	var seen := {}
	for e in m.get("p", []):
		var id := str(e[0])
		seen[id] = true
		if id == my_id:
			continue
		var s = soldiers.get(id)
		if s == null:
			var r: Dictionary = roster.get(id, {"id": id, "side": "out", "faction": "bandit", "name": "?"})
			s = Soldier.new()
			add_child(s)
			s.setup(r, r.get("side") == side)
			s.phys = phys
			s.biome = world.biome
			soldiers[id] = s
		s.push(ts, e)
	for id in soldiers:
		soldiers[id].visible = seen.has(id) and soldiers[id].visible
		if not seen.has(id):
			soldiers[id].visible = false
	vehicles.on_snapshot(m.get("vh", []), ts, driving.i if driving != null else -1)
	_projectiles(m.get("pr", []))
	smokes = m.get("sm", [])

func _on_score(m: Dictionary) -> void:
	score = m.get("score", score)
	sites = m.get("sites", sites)
	if m.has("roster"):
		roster_list = m.roster
		for r in m.roster:
			roster[r.id] = r
	if m.has("left"):
		left_ms = float(m.left)
		left_at = Time.get_ticks_msec()
	_sync_sites()
	if hud.panel_kind == "scores":
		hud.show_scores(roster_list, my_id)

func _on_shot(m: Dictionary) -> void:
	if str(m.id) == my_id or not ready_world:
		return
	var s = soldiers.get(m.id)
	var wd := Cfg.weapon(str(m.w))
	var o: Array = m.o
	var from := Vector3(o[0], o[1], o[2])
	if s and s.visible:
		from = s.muzzle_pos()
	Sfx.gunshot(str(wd.get("sound", "rifle")), from)
	fx.muzzle(from, 0.7)
	var eyep := cam.global_position
	var ends: Array = m.get("e", [])
	for i in ends.size():
		var e = ends[i]
		if e == null:
			continue
		var end := Vector3(e[0], e[1], e[2])
		if i % 2 == 0 or not wd.has("pellets"):
			fx.tracer(from, end)
		var surf := phys.surface_at(e[0], 0, e[2], world.biome) if e[1] < 0.06 else "concrete"
		fx.impact(end, surf)
		if i == 0:
			Sfx.play("impact_" + ("concrete" if surf == "concrete" else "dirt"), end, {"ref": 2.0})
		# A round cracking past your head.
		var seg := end - from
		var tt: float = clamp((eyep - from).dot(seg) / max(0.001, seg.length_squared()), 0.0, 1.0)
		var closest := from + seg * tt
		if closest.distance_to(eyep) < 2.2 and closest.distance_to(end) > 1.0:
			Sfx.play("whiz", closest, {"ref": 1.0, "delay": false})

func _on_hurt(m: Dictionary) -> void:
	var dmg := float(m.get("dmg", 10))
	Sfx.play("hurt", null, {"db": linear_to_db(clamp(0.3 + dmg / 80.0, 0.2, 1.0))})
	if fx:
		fx.shake = min(1.0, fx.shake + dmg / 60.0)
	punch.x += 0.02 + dmg / 2000.0
	last_hurt = Time.get_ticks_msec()
	if m.get("from") != null:
		var f: Array = m.from
		var dx: float = f[0] - body.x
		var dz: float = f[2] - body.z
		var fw := Vector2(-sin(yaw), -cos(yaw))
		var rt := Vector2(cos(yaw), -sin(yaw))
		hud.hurt(atan2(dx * rt.x + dz * rt.y, dx * fw.x + dz * fw.y), dmg)
	Input.vibrate_handheld(int(clamp(dmg * 3.0, 20.0, 120.0)))

func _on_kill(m: Dictionary) -> void:
	hud.kill_feed(m, my_id)
	if str(m.victim) == my_id:
		death_by = str(m.kn) if m.get("kn") != null and str(m.killer) != my_id else ""
		if status == "dead":
			_on_status("alive", "dead")
	if str(m.get("killer", "")) == my_id and str(m.victim) != my_id:
		var streak := int(me.get("streak", 0)) + 1
		var calls := ["", "", "DOUBLE KILL!", "TRIPLE KILL!", "RAMPAGE!", "NO MERCY!"]
		if streak >= 2:
			hud.show_banner(calls[min(5, streak)] if streak <= 5 else "WAR GENERAL!", Kit.GOLD, 1.6)
		elif m.get("head", false):
			hud.show_banner("HEADSHOT!", Kit.GOLD, 1.4)
	var s = soldiers.get(m.victim)
	if s and fx:
		fx.blood(s.chest(), true)

func _on_boom(m: Dictionary) -> void:
	var p := Vector3(m.x, m.y, m.z)
	if fx:
		fx.explosion(p, float(m.get("r", 6)))
	Sfx.explosion(p, 1.3 if m.get("w") in ["artillery", "rpg"] else 1.0)

func _on_tgem(m: Dictionary) -> void:
	var i := int(m.i)
	if i < tile_gems.size():
		tile_gems[i][1] = float(m.at)
		_set_gem_type(tile_gems[i], str(m.type))
	if str(m.get("id", "")) == my_id:
		var g: Dictionary = Cfg.rules.get("TILE_GEMS", {}).get("types", {}).get(str(m.took), {})
		Sfx.play("heal")
		var bits: Array = []
		if g.has("heal"):
			bits.append("+%d health" % int(g.heal))
		if g.has("armor"):
			bits.append("+%d armour" % int(g.armor))
		hud.toast("%s! %s" % [g.get("name", "Gem"), " · ".join(bits)], "gem", 1.8)

# ---------- gems, sites, projectiles, billboards ----------
static func _gem_mesh() -> PrismMesh:
	var p := PrismMesh.new()
	p.size = Vector3(0.35, 0.5, 0.35)
	return p

func _build_gems() -> void:
	var gm := World.glow(Kit.GEM, 3.0)
	for a in map.get("adWalls", []):
		var n := MeshInstance3D.new()
		var sm := SphereMesh.new()
		sm.radius = 0.22
		sm.height = 0.44
		sm.radial_segments = 6
		sm.rings = 3
		n.mesh = sm
		n.material_override = gm
		n.position = Vector3(a.gem.x, a.gem.y, a.gem.z)
		add_child(n)
		wall_gems.append([n, 0.0])
	for b in map.get("billboards", []):
		if b.get("type") != "ground":
			continue
		for k in [-0.36, -0.12, 0.12, 0.36]:
			var u: float = k * float(b.w)
			var x: float = float(b.x) + u * cos(float(b.get("rot", 0.0)))
			var z: float = float(b.z) - u * sin(float(b.get("rot", 0.0)))
			var n := MeshInstance3D.new()
			n.mesh = _gem_mesh()
			n.position = Vector3(x, 0.45, z)
			add_child(n)
			tile_gems.append([n, 0.0, ""])
	_apply_gems(info)

func _set_gem_type(g: Array, type: String) -> void:
	if g[2] == type:
		return
	g[2] = type
	var c := Color(str(Cfg.rules.get("TILE_GEMS", {}).get("types", {}).get(type, {}).get("color", "#ff2d55")))
	g[0].material_override = World.glow(c, 2.5)

func _apply_gems(m: Dictionary) -> void:
	var gs: Array = m.get("gems", [])
	for i in min(gs.size(), wall_gems.size()):
		wall_gems[i][1] = float(gs[i])
	var tg: Array = m.get("tileGems", [])
	for i in min(tg.size(), tile_gems.size()):
		_set_gem_type(tile_gems[i], str(tg[i][0]))
		tile_gems[i][1] = float(tg[i][1])

func _build_sites() -> void:
	_sync_sites()

func _sync_sites() -> void:
	if not ready_world and world == null:
		return
	var seen := {}
	for s in sites:
		var id := str(s.id)
		seen[id] = true
		var n = site_nodes.get(id)
		if n == null:
			n = Node3D.new()
			var ring := MeshInstance3D.new()
			var tm := TorusMesh.new()
			tm.inner_radius = float(s.r) - 0.15
			tm.outer_radius = float(s.r)
			tm.rings = 48
			tm.ring_segments = 4
			ring.mesh = tm
			n.add_child(ring)
			var beam := MeshInstance3D.new()
			var cm := CylinderMesh.new()
			cm.top_radius = 0.25
			cm.bottom_radius = 0.25
			cm.height = 40.0
			beam.mesh = cm
			beam.position.y = 20.0
			n.add_child(beam)
			var lbl := Label3D.new()
			lbl.text = id
			lbl.font = Kit.font_bold
			lbl.font_size = 96
			lbl.pixel_size = 0.02
			lbl.outline_size = 16
			lbl.billboard = BaseMaterial3D.BILLBOARD_ENABLED
			lbl.no_depth_test = true
			lbl.position.y = 6.0
			n.add_child(lbl)
			n.position = Vector3(s.x, 0.08, s.z)
			add_child(n)
			site_nodes[id] = n
		var owner = s.get("owner")
		var col := Color(0.9, 0.9, 0.9) if owner == null else Kit.side_color(str(owner))
		if id == "D":
			col = Kit.GOLD
		var ringm := World.glow(col, 1.5)
		n.get_child(0).material_override = ringm
		var bm := World.glow(col, 1.0)
		bm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		bm.albedo_color = Color(col.r, col.g, col.b, 0.18)
		n.get_child(1).material_override = bm
		n.get_child(2).modulate = col
	for id in site_nodes.keys():
		if not seen.has(id):
			site_nodes[id].queue_free()
			site_nodes.erase(id)

func _projectiles(list: Array) -> void:
	while proj_nodes.size() < list.size():
		var n := MeshInstance3D.new()
		var sm := SphereMesh.new()
		sm.radius = 0.09
		sm.height = 0.18
		n.mesh = sm
		n.material_override = World.flat(Color(0.2, 0.25, 0.15), 0.6)
		add_child(n)
		proj_nodes.append(n)
	for i in proj_nodes.size():
		var n: MeshInstance3D = proj_nodes[i]
		if i < list.size():
			var p: Array = list[i]
			var target := Vector3(p[1], p[2], p[3])
			if not n.visible or n.position.distance_to(target) > 10.0:
				n.position = target
			n.set_meta("target", target)
			n.visible = true
			if p[0] == "rocket" and fx:
				fx.puff(target, Color(0.8, 0.8, 0.8, 0.5), 0.3, 1.0, Vector3.ZERO, -0.2, 3.0)
		else:
			n.visible = false

## Billboards: sky boards on towers, LED screens, ground tiles and wall banners, with the
## live adverts (or "Advertise here").
func _load_ads() -> void:
	var http := HTTPRequest.new()
	add_child(http)
	http.request_completed.connect(func(result, code, _h, bytes):
		http.queue_free()
		if result == HTTPRequest.RESULT_SUCCESS and code == 200:
			var d = JSON.parse_string(bytes.get_string_from_utf8())
			if d is Dictionary:
				ad_slots = d.get("slots", {})
				_apply_ads())
	http.request(Cfg.api("/api/ads?state=" + state_id))

func _build_boards() -> void:
	var dark := World.flat(Color(0.12, 0.12, 0.13), 0.6, 0.4)
	for b in map.get("billboards", []):
		var t := str(b.type)
		var n := Node3D.new()
		add_child(n)
		var face := MeshInstance3D.new()
		var q := QuadMesh.new()
		var w := float(b.w)
		var h := float(b.h)
		q.size = Vector2(w, h)
		face.mesh = q
		var house := _house_ad_mat(t)
		face.material_override = house
		n.add_child(face)
		if t == "ground":
			n.position = Vector3(b.x, 0.04, b.z)
			face.rotation = Vector3(-PI / 2.0, float(b.get("rot", 0.0)), 0)
		else:
			var nx := float(b.get("nx", 0))
			var nz := float(b.get("nz", 1))
			n.position = Vector3(b.x, float(b.get("y", 6.0)), b.z)
			n.rotation.y = atan2(nx, nz)
			var back := MeshInstance3D.new()
			var bm := BoxMesh.new()
			bm.size = Vector3(w + 0.4, h + 0.4, 0.3)
			back.mesh = bm
			back.material_override = dark
			back.position.z = -0.17
			n.add_child(back)
			if b.get("twoSided", false):
				var face2 := MeshInstance3D.new()
				face2.mesh = q
				face2.material_override = house
				face2.position.z = -0.34
				face2.rotation.y = PI
				n.add_child(face2)
				boards.append([str(b.id), face2, t])
			# Poles down to the ground (or to the tower roof).
			var base_y := 0.0
			if b.has("tower") and b.tower is Dictionary:
				base_y = float(b.tower.h)
				var tw := MeshInstance3D.new()
				var tb := BoxMesh.new()
				tb.size = Vector3(float(b.tower.w), float(b.tower.h), float(b.tower.d))
				tw.mesh = tb
				tw.material_override = world.mats.get("facade")
				tw.position = Vector3(b.x - nx * float(b.tower.d) * 0.3, float(b.tower.h) / 2.0, b.z - nz * float(b.tower.d) * 0.3)
				add_child(tw)
			var ph := float(b.get("y", 6.0)) - h / 2.0 - base_y
			if ph > 0.2:
				for sx in [-w * 0.3, w * 0.3]:
					var pole := MeshInstance3D.new()
					var pm := BoxMesh.new()
					pm.size = Vector3(0.3, ph, 0.3)
					pole.mesh = pm
					pole.material_override = dark
					pole.position = Vector3(sx, -h / 2.0 - ph / 2.0, -0.2)
					n.add_child(pole)
		boards.append([str(b.id), face, t])
	for a in map.get("adWalls", []):
		var n := Node3D.new()
		add_child(n)
		var face := MeshInstance3D.new()
		var q := QuadMesh.new()
		q.size = Vector2(float(a.w), float(a.h))
		face.mesh = q
		face.material_override = _house_ad_mat("wall")
		n.add_child(face)
		n.position = Vector3(a.face.x if a.has("face") else a.x, float(a.y), a.face.z if a.has("face") else a.z)
		n.rotation.y = atan2(float(a.get("nx", 0)), float(a.get("nz", 1)))
		boards.append([str(a.id), face, "wall"])

func _house_ad_mat(t: String) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = Color("#1d1410") if t != "led" else Color("#101820")
	m.emission_enabled = true
	m.emission = Color("#ff7a1a")
	m.emission_energy_multiplier = 0.08
	m.roughness = 0.6
	return m

func _apply_ads() -> void:
	var now := Net.server_now()
	for bd in boards:
		var list: Array = ad_slots.get(bd[0], [])
		var mi: MeshInstance3D = bd[1]
		if list.is_empty():
			if mi.get_child_count() == 0:
				var l := Label3D.new()
				l.text = "ADVERTISE HERE\nproofofduty.com"
				l.font = Kit.font_bold
				l.font_size = 72
				l.pixel_size = 0.012 if bd[2] != "wall" else 0.006
				l.modulate = Color("#ffb347")
				l.position.z = 0.02
				mi.add_child(l)
			continue
		var ad: Dictionary = list[int(now / 12000.0) % list.size()]
		_fetch_image(str(ad.get("image", "")), mi)

func _fetch_image(url: String, mi: MeshInstance3D) -> void:
	if url == "":
		return
	var full := url if url.begins_with("http") else Cfg.api(url)
	var http := HTTPRequest.new()
	add_child(http)
	http.request_completed.connect(func(result, code, headers, bytes):
		http.queue_free()
		if result != HTTPRequest.RESULT_SUCCESS or code != 200 or not is_instance_valid(mi):
			return
		var img := Image.new()
		var err := img.load_png_from_buffer(bytes)
		if err != OK:
			err = img.load_jpg_from_buffer(bytes)
		if err != OK:
			err = img.load_webp_from_buffer(bytes)
		if err != OK:
			return
		if img.get_width() > 1024:
			img.resize(1024, int(1024.0 * img.get_height() / img.get_width()))
		img.generate_mipmaps()
		var tex := ImageTexture.create_from_image(img)
		var m := StandardMaterial3D.new()
		m.albedo_texture = tex
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
		mi.material_override = m
		for c in mi.get_children():
			c.queue_free())
	http.request(full)

# ---------- driving ----------
func _start_driving(i: int) -> void:
	if vehicles == null:
		return
	var e = vehicles.by_index(i)
	if e == null:
		return
	driving = e
	driving.speed = 0.0
	vm.visible = false
	var d := vehicles.def(e.type)
	yaw = e.yaw
	pitch = -0.1
	touch.use_label = "EXIT"
	hud.toast("%s: stick to drive, JUMP to brake, EXIT to get out." % d.get("name", "Vehicle"), "info", 3)

func _stop_driving() -> void:
	if driving == null:
		return
	driving = null
	vm.visible = status == "alive"
	touch.use_label = "USE"

# ---------- per frame ----------
func _process(delta: float) -> void:
	if not ready_world:
		return
	var dt: float = min(delta, 0.05)
	var now := Time.get_ticks_msec()
	var s_now := Net.server_now()
	var menu: bool = hud.panel != null or paused
	# Menus take the touches while they're open.
	touch.enabled = not menu and settings_overlay == null
	if not touch.enabled:
		touch.reset()
	# Look.
	var look := touch.take_look() * 0.0042 * float(Cfg.get_s("sens", 1.0))
	if mouse_look:
		look += _mouse_delta * 0.0022 * float(Cfg.get_s("sens", 1.0))
	_mouse_delta = Vector2.ZERO
	if not menu and status in ["alive", "spirit", "downed"]:
		var assist := _aim_assist()
		yaw -= look.x / zoom * assist
		pitch = clamp(pitch - look.y / zoom * assist, -1.5, 1.5)
	_move(dt, now)
	_camera(dt, now, look)
	# Fire.
	var firing: bool = (touch.fire or keys.get("fire", false)) and not menu
	if status == "alive" and firing and not sprinting and driving == null:
		_try_fire(now)
	if not firing:
		trigger = true
		if now - last_fire > 300:
			burst = 0
	if reload_until > 0 and now >= reload_until:
		_finish_reload()
	punch *= pow(0.003, dt)
	_buttons(now)
	# Send state at 20 Hz.
	send_t += dt
	if send_t >= 0.05:
		send_t = 0.0
		if status in ["alive", "spirit"]:
			var st := {"t": "st", "x": snappedf(body.x, 0.01), "y": snappedf(body.y, 0.01), "z": snappedf(body.z, 0.01), "yaw": snappedf(yaw, 0.001), "pitch": snappedf(pitch, 0.001), "c": 1 if body.crouch else 0, "a": 1 if ads_on else 0, "r": 1 if sprinting else 0}
			if driving != null:
				st["v"] = [snappedf(driving.x, 0.01), snappedf(driving.z, 0.01), snappedf(driving.yaw, 0.001), snappedf(driving.speed, 0.01)]
			Net.send(st)
	# Advert views (what the advertisers pay for).
	views_t += dt
	if views_t > 3.0:
		views_t = 0.0
		if status in ["alive", "spirit"]:
			var slots := _visible_boards()
			if not slots.is_empty():
				Net.send({"t": "views", "slots": slots})
		if not ad_slots.is_empty():
			_apply_ads()
	var render_ts := s_now - INTERP_MS
	for id in soldiers:
		var so: Soldier = soldiers[id]
		so.update(dt, render_ts, cam.global_position)
	vehicles.update(dt, render_ts, driving.i if driving != null else -1)
	for n in proj_nodes:
		if n.visible and n.has_meta("target"):
			n.position = n.position.lerp(n.get_meta("target"), min(1.0, dt * 15.0))
	# Gems glow when they can be taken.
	var spin := now / 1000.0
	for g in wall_gems:
		g[0].visible = g[1] <= s_now
		g[0].rotation.y = spin * 1.5
		g[0].position.y += sin(spin * 2.0) * 0.002
	for g in tile_gems:
		g[0].visible = g[1] <= s_now
		g[0].rotation.y = spin * 1.2
	world.update(dt, cam.global_position)
	vm.update(dt, vel.length(), sprinting, ads_on, body.crouch, body.on_ground, look * 40.0)
	Sfx.set_listener(cam.global_position)
	# HUD.
	var lm: float = max(0.0, left_ms - (now - left_at))
	hud.set_score(score, lm, sites, side)
	var w := Cfg.weapon(_weapon())
	hud.spread = _spread_now(w, vel.length())
	hud.scoped = ads_on and w.has("zoom") and zoom > 2.5
	hud.ping_lbl.text = "%d ms" % int(Net.rtt)
	touch.show_buy = status == "alive" and _in_buy_zone()
	var near_v = vehicles.nearest(body.x, body.z) if status == "alive" and driving == null else null
	var mate = _downed_mate()
	touch.show_use = driving != null or near_v != null or mate != null
	if driving == null:
		touch.use_label = "REVIVE" if mate != null else "ENTER" if near_v != null else "USE"
	hud.prompt_lbl.text = ("Hold USE: revive %s" % mate.pname) if mate != null else ("USE: enter %s" % vehicles.def(near_v.type).get("name", "")) if near_v != null else ""
	# Countdowns while you wait to come back.
	var s_left := 0.0
	match status:
		"medevac":
			s_left = (float(me.get("medevacAt", 0)) - s_now) / 1000.0
			hud.status_lbl.text = "MEDEVAC INBOUND… %ds" % int(max(0.0, s_left))
		"spirit":
			s_left = (float(me.get("spiritUntil", 0)) - s_now) / 1000.0
			hud.status_lbl.text = "SPIRIT RUN: reach any glowing gem · %ds" % int(max(0.0, s_left))
		"downed":
			var dm := float(Cfg.rules.get("RESPAWN", {}).get("downedMs", 10000))
			s_left = (float(me.get("downedAt", 0)) + dm - s_now) / 1000.0
			hud.status_lbl.text = "YOU ARE DOWN! A teammate can revive you · %ds" % int(max(0.0, s_left))
	# Birds and distant life.
	amb_t -= dt
	if amb_t <= 0.0:
		amb_t = randf_range(3.5, 6.0)
		var ap := Vector3(body.x + randf_range(-60, 60), 8.0, body.z + randf_range(-60, 60))
		if world.biome == "urban" and randf() < 0.5:
			Sfx.play("horn", ap, {"ref": 20.0, "bus": "Amb", "delay": false})
		else:
			Sfx.play("bird", ap, {"ref": 20.0, "bus": "Amb", "delay": false})
	# Heartbeat when badly hurt.
	if status == "alive" and float(me.get("health", 100)) < 30:
		heart_t -= dt
		if heart_t <= 0:
			heart_t = 0.9
			Sfx.play("heartbeat", null, {"bus": "UI"})

var _mouse_delta := Vector2.ZERO

func _unhandled_input(e: InputEvent) -> void:
	# Keyboard and mouse (testing on a computer, or a phone with a keyboard).
	if e is InputEventMouseMotion and mouse_look:
		_mouse_delta += e.relative
	elif e is InputEventMouseButton:
		if e.button_index == MOUSE_BUTTON_LEFT:
			if e.pressed and not mouse_look and hud.panel == null and DisplayServer.is_touchscreen_available() == false:
				Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
				mouse_look = true
			keys["fire"] = e.pressed and mouse_look
		elif e.button_index == MOUSE_BUTTON_RIGHT:
			if e.pressed:
				touch.ads = not touch.ads
	elif e is InputEventKey and not e.echo:
		var k: int = e.physical_keycode
		var down: bool = e.pressed
		keys[k] = down
		if down:
			match k:
				KEY_ESCAPE:
					on_back()
				KEY_R:
					touch.pressed["reload"] = true
				KEY_B:
					touch.pressed["buy"] = true
				KEY_G:
					touch.pressed["nade"] = true
				KEY_N:
					touch.pressed["pill"] = true
				KEY_E:
					touch.pressed["use"] = true
					touch.use_held = true
				KEY_Q:
					touch.pressed["swap"] = true
				KEY_TAB:
					touch.pressed["scores"] = true
				KEY_C, KEY_CTRL:
					touch.crouch = not touch.crouch
				KEY_1:
					_slot("primary")
				KEY_2:
					_slot("secondary")
				KEY_3:
					_slot("melee")
		elif k == KEY_E:
			touch.use_held = false

func _kmove() -> Vector2:
	var v := Vector2.ZERO
	if keys.get(KEY_W, false):
		v.y += 1
	if keys.get(KEY_S, false):
		v.y -= 1
	if keys.get(KEY_D, false):
		v.x += 1
	if keys.get(KEY_A, false):
		v.x -= 1
	return v.limit_length(1.0)

func on_back() -> void:
	if settings_overlay and is_instance_valid(settings_overlay):
		settings_overlay.queue_free()
		settings_overlay = null
		return
	if hud.panel != null and hud.panel_kind != "death" and hud.panel_kind != "end":
		hud.close_panel()
		paused = false
		return
	if mouse_look:
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
		mouse_look = false
	paused = true
	hud.show_pause()

func _open_settings() -> void:
	settings_overlay = preload("res://ui/settings.gd").new()
	settings_overlay.closed.connect(func():
		settings_overlay = null
		cam.fov = float(Cfg.get_s("fov", 75.0))
		touch.left_fire = bool(Cfg.get_s("left_hand_fire", false)))
	ui.add_child(settings_overlay)

func net_status(on: bool) -> void:
	if not on:
		hud.toast("Connection lost. Reconnecting…", "bad", 3)

func shutdown() -> void:
	Net.off_owner(self)
	if hud:
		Net.off_owner(hud)
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE

# ---------- movement (port of the lite app's move()) ----------
func _move(dt: float, now: float) -> void:
	if driving != null:
		if status == "alive":
			_drive(dt)
		return
	var b := body
	var mv := touch.move + _kmove()
	mv = mv.limit_length(1.0)
	var menu: bool = hud.panel != null or paused or ended
	if menu and hud.panel_kind != "buy":
		mv = Vector2.ZERO
	var s := sin(yaw)
	var c := cos(yaw)
	var wx := mv.x * c - mv.y * s
	var wz := -mv.x * s - mv.y * c
	var w := Cfg.weapon(_weapon())
	var fac: Dictionary = Cfg.faction(faction).get("perks", {})
	if status == "spirit":
		var sp := float(Cfg.rules.get("RESPAWN", {}).get("spiritSpeed", 9))
		b.x = clamp(b.x + wx * sp * dt, -phys.half + 2, phys.half - 2)
		b.z = clamp(b.z + wz * sp * dt, -phys.half + 2, phys.half - 2)
		b.y = 0.0
		vel = Vector2(wx * sp, wz * sp)
		sprinting = false
		ads_on = false
		return
	if status != "alive":
		vel = Vector2.ZERO
		sprinting = false
		ads_on = false
		return
	if touch.crouch:
		b.crouch = true
	elif b.crouch and not phys.inside_any_box(b.x, b.y, b.z, false):
		b.crouch = false
	var forward := mv.y > 0.3
	var want_sprint = (touch.sprint or keys.get(KEY_SHIFT, false)) and forward and not b.crouch
	ads_on = touch.ads and not menu and not w.get("melee", false)
	var sk: Dictionary = me.get("skills", {"swim": 0, "fitness": 0})
	var fit := float(sk.get("fitness", 0))
	var max_stam = float(P.get("stamina", 6)) * (1.0 + min(100.0, fit) / 100.0 * 0.7)
	sprinting = want_sprint and stamina > 0.2 and not ads_on and reload_until == 0.0
	if sprinting:
		stamina = max(0.0, stamina - dt)
	else:
		stamina = min(max_stam, stamina + dt * 0.8)
	var speed := float(P.get("jog", 4.4))
	if sprinting:
		speed = float(P.get("run", 5.6)) * (1.0 + min(100.0, fit) / 100.0 * 0.06)
	if b.crouch:
		speed = float(P.get("crouchSpeed", 1.7))
	if ads_on:
		speed *= float(P.get("adsSpeed", 0.6)) + 0.2
	speed *= float(w.get("speed", 1.0)) * float(fac.get("speedMult", 1.0))
	if b.y < 0.1 and phys.in_water(b.x, b.z):
		var deep := _deep_water(b.x, b.z)
		var swim := float(sk.get("swim", 0))
		var sf := 1.0
		if deep:
			sf = 1.35 if swim >= 70 else 1.0 if swim >= 30 else 0.55
		speed *= float(P.get("waterSpeed", 0.6)) * float(fac.get("swimMult", 1.0)) * sf
	var accel := 14.0 if b.on_ground else 2.5
	var k := 1.0 - exp(-accel * dt)
	vel.x += (wx * speed - vel.x) * k
	vel.y += (wz * speed - vel.y) * k
	var jump: bool = (touch.tapped("jump") or keys.get(KEY_SPACE, false)) and b.on_ground and not b.crouch and not menu
	var was_ground: bool = b.on_ground
	var vy_before: float = b.vy
	var before := Vector2(b.x, b.z)
	phys.move_body(b, vel.x, vel.y, dt, jump)
	if jump:
		Sfx.play("jump")
	if not was_ground and b.on_ground and vy_before < -4.0:
		vm.landed()
		Sfx.footstep(phys.surface_at(b.x, b.y, b.z, world.biome), null, 1.6)
	var moved := Vector2(b.x, b.z).distance_to(before)
	if b.on_ground:
		step_dist += moved
		var stride := 2.6 if sprinting else 1.4 if b.crouch else 2.1
		if step_dist > stride:
			step_dist = 0.0
			var quiet: bool = b.crouch or fac.get("quietSteps", false)
			Sfx.footstep(phys.surface_at(b.x, b.y, b.z, world.biome), null, 0.9 if sprinting else 0.25 if quiet else 0.55)

func _deep_water(x: float, z: float) -> bool:
	for w in map.get("water", []):
		if x <= w.x0 or x >= w.x1 or z <= w.z0 or z >= w.z1:
			continue
		var edge: float = min(min(x - w.x0, w.x1 - x), min(z - w.z0, w.z1 - z))
		if edge > 3.2:
			return true
	return false

func _drive(dt: float) -> void:
	var mv := touch.move + _kmove()
	var brake: bool = keys.get(KEY_SPACE, false) or touch.fingers.values().any(func(f): return f.role == "jump")
	var impact := vehicles.drive_step(driving, mv.y, mv.x, brake, dt)
	if impact > 7.0:
		fx.shake = min(1.4, fx.shake + impact / 18.0)
		Sfx.play("impact_metal", null, {"db": 3.0})
	vehicles._place(driving)
	var d := vehicles.def(driving.type)
	body.x = driving.x
	body.z = driving.z
	body.y = float(d.get("seatY", 0.4))
	body.vy = 0.0
	body.on_ground = true
	body.crouch = false
	vel = Vector2.ZERO
	sprinting = false
	# The camera swings round behind the vehicle.
	if absf(driving.speed) > 3.0 and touch.fingers.values().all(func(f): return f.role != "look"):
		yaw = lerp_angle(yaw, driving.yaw, min(1.0, dt * 1.6))
		pitch += (-0.12 - pitch) * min(1.0, dt * 1.2)

func _camera(dt: float, now: float, look: Vector2) -> void:
	var w := Cfg.weapon(_weapon())
	var target_eye := float(P.get("eye", 1.62))
	if status == "downed":
		target_eye = 0.45
	elif body.crouch:
		target_eye = float(P.get("crouchEye", 1.08))
	eye += (target_eye - eye) * min(1.0, dt * 12.0)
	var zt := 1.0
	if ads_on:
		zt = float(w.get("zoom", 1.12 if w.get("slot", "") == "secondary" else 1.3))
	zoom += (zt - zoom) * min(1.0, dt * 14.0)
	cam.fov = float(Cfg.get_s("fov", 75.0)) / zoom
	vm.visible = status == "alive" and driving == null and not (ads_on and w.has("zoom") and zoom > 2.5)
	var sh := fx.shake
	var shake_v := Vector3(randf_range(-1, 1), randf_range(-1, 1), 0) * sh * sh * 0.02
	if driving != null:
		# Chase camera behind the vehicle.
		var d := vehicles.def(driving.type)
		var back := 4.5 + float(d.get("L", 4.6)) * 0.6
		var dir := Phys.dir_from_angles(yaw, pitch - 0.15)
		var target := Vector3(driving.x, float(d.get("H", 1.5)) + 0.6, driving.z)
		cam.global_position = target - dir * back + Vector3(0, 0.8, 0)
		cam.look_at(target + dir * 3.0, Vector3.UP)
		return
	cam.global_position = Vector3(body.x, body.y + eye, body.z) + shake_v
	cam.rotation = Vector3(pitch + punch.x, yaw + punch.y, 0)
	if status == "dead" or status == "medevac":
		# Look down at your fallen body from above.
		cam.global_position = Vector3(body.x, body.y + 6.0, body.z + 4.0)
		cam.look_at(Vector3(body.x, body.y, body.z), Vector3.UP)

# ---------- shooting ----------
func _spread_now(w: Dictionary, speed: float) -> float:
	if w.is_empty() or w.get("melee", false):
		return 0.0
	var s := float(w.get("adsSpread", 0.004)) if ads_on else float(w.get("spread", 0.01))
	s += float(w.get("moveSpread", 0.0)) * clamp(speed / float(P.get("jog", 4.4)), 0.0, 1.2) * (0.6 if ads_on else 1.0)
	if not body.on_ground:
		s += 0.08
	if body.crouch:
		s *= 0.75
	if w.get("auto", false):
		s += min(0.03, burst * 0.0035)
	return s

func _try_fire(now: float) -> void:
	var id := _weapon()
	var w := Cfg.weapon(id)
	if w.is_empty():
		return
	if w.get("melee", false):
		if now - last_fire < 520:
			return
		last_fire = now
		Net.send({"t": "melee"})
		vm.swing()
		Sfx.play("swing")
		return
	if not w.get("auto", false) and not trigger:
		return
	if now - last_fire < 60000.0 / float(w.rpm):
		return
	if reload_until > now:
		return
	if ammo.is_empty() or int(ammo.get("mag", 0)) <= 0:
		if trigger:
			Sfx.play("dry")
		trigger = false
		if not ammo.is_empty() and int(ammo.get("reserve", 0)) > 0:
			_reload()
		return
	trigger = false
	burst = burst + 1 if now - last_fire < 60000.0 / float(w.rpm) * 1.6 else 0
	last_fire = now
	ammo.mag = int(ammo.mag) - 1
	var o := cam.global_position
	var d := Phys.dir_from_angles(yaw + punch.y, pitch + punch.x)
	if not w.has("pellets"):
		d = Phys.spread_dir(d, _spread_now(w, vel.length()))
	Net.send({"t": "fire", "w": id, "o": [snappedf(o.x, 0.001), snappedf(o.y, 0.001), snappedf(o.z, 0.001)], "d": [snappedf(d.x, 0.0001), snappedf(d.y, 0.0001), snappedf(d.z, 0.0001)], "ts": int(Net.server_now() - INTERP_MS)})
	var kick := float(w.get("kick", 0.02)) * (0.75 if ads_on else 1.0) * (0.8 if body.crouch else 1.0)
	punch.x += kick * 0.6
	punch.y += randf_range(-0.5, 0.5) * kick * 0.7
	pitch = clamp(pitch + kick * 0.45, -1.5, 1.5)
	vm.fire(kick)
	Sfx.gunshot(str(w.get("sound", "rifle")), null, true)
	var muzzle := cam.global_position + cam.global_basis * Vector3(0.1, -0.08, -0.55)
	fx.muzzle(muzzle, 1.3 if w.has("pellets") else 1.0)
	fx.shake = min(1.0, fx.shake + (0.25 if w.has("pellets") or float(w.dmg) > 50 else 0.06))
	_hud_me()
	if w.has("projectile"):
		return
	# Local hit effects (the server decides the damage).
	var pellets := int(w.get("pellets", 1))
	for i in pellets:
		var dir := Phys.spread_dir(d, float(w.spread)) if pellets > 1 else d
		var hit := phys.raycast(o, dir, float(w.range), driving.box if driving != null else -1)
		var t: float = hit.t
		var who = null
		for so in soldiers.values():
			if not so.visible or so.is_mate or so.flags & (256 | 4):
				continue
			var h := Phys.hit_soldier(o, dir, so.position, so.flags & 1 != 0, so.flags & 2 != 0)
			if not h.is_empty() and h.t < t:
				t = h.t
				who = so
		var end := o + dir * t
		if i % 2 == 0:
			fx.tracer(muzzle, end)
		if who != null:
			fx.blood(end)
		elif hit.box != -1 and t < float(w.range):
			var surf := "dirt"
			if hit.box >= 0:
				var k: String = phys.boxes[hit.box].get("kind", "")
				surf = "metal" if k in ["metal", "zinc", "container", "tank", "pipe", "vehicle", "wagon", "warehouse"] else "wood" if k in ["plank", "crate", "stall", "bridge"] else "concrete"
			elif phys.in_water(end.x, end.z):
				surf = "water"
			fx.impact(end, surf)

func _reload() -> void:
	var id := _weapon()
	var w := Cfg.weapon(id)
	if w.is_empty() or w.get("melee", false) or ammo.is_empty() or int(ammo.mag) >= int(w.mag) or int(ammo.reserve) <= 0 or reload_until > Time.get_ticks_msec():
		return
	Net.send({"t": "reload"})
	reload_until = Time.get_ticks_msec() + float(w.reload) * 1000.0
	reload_id = id
	vm.reload(float(w.reload))
	var key := "reload_" + ("pkm" if id == "pkm" else "danegun" if id in ["danegun", "ancestral"] else "rpg" if id in ["rpg", "gl"] else "")
	Sfx.play(key if Sfx.has(key) else "reload")

func _finish_reload() -> void:
	var w := Cfg.weapon(reload_id)
	if not w.is_empty() and not ammo.is_empty() and _weapon() == reload_id:
		var take: int = min(int(w.mag) - int(ammo.mag), int(ammo.reserve))
		ammo.mag = int(ammo.mag) + take
		ammo.reserve = int(ammo.reserve) - take
	reload_until = 0.0
	_hud_me()

func _slot(slot: String) -> void:
	var ws: Dictionary = me.get("weapons", {})
	if ws.get(slot) == null or me.get("slot") == slot:
		return
	me.slot = slot
	Net.send({"t": "slot", "slot": slot})
	reload_until = 0.0
	var w: String = str(ws[slot])
	vm.set_weapon(w, faction)
	ammo = me.get("ammo", {}).get(w, {}).duplicate()
	last_fire = Time.get_ticks_msec() - 200
	Sfx.ui("click")
	_hud_me()

func _buttons(now: float) -> void:
	if touch.tapped("pause"):
		on_back()
	if touch.tapped("scores"):
		if hud.panel_kind == "scores":
			hud.close_panel()
		else:
			hud.show_scores(roster_list, my_id)
	if status != "alive":
		touch.pressed.clear()
		return
	if touch.tapped("reload"):
		_reload()
	if touch.tapped("swap"):
		var order := ["primary", "secondary", "melee"]
		var cur: int = order.find(str(me.get("slot", "secondary")))
		for k in range(1, 4):
			var s: String = order[(cur + k) % 3]
			if me.get("weapons", {}).get(s) != null:
				_slot(s)
				break
	if touch.tapped("buy"):
		if hud.panel_kind == "buy":
			hud.close_panel()
		elif _in_buy_zone():
			hud.show_buy(me, int(me.get("level", 1)))
		else:
			hud.toast("You can only buy at your base or right after you deploy.", "bad", 1.5)
	if touch.tapped("pill"):
		if int(me.get("bloodpill", 0)) > 0 and float(me.get("health", 100)) < 100:
			Net.send({"t": "pill"})
		elif int(me.get("medkit", 0)) > 0 and float(me.get("health", 100)) < 100:
			Net.send({"t": "medkit"})
		else:
			hud.toast("You have no blood pills. Buy some at the armoury.", "bad", 1.5)
	if touch.tapped("nade"):
		_throw()
	if touch.tapped("use"):
		if driving != null:
			Net.send({"t": "veh", "a": "exit"})
		else:
			var mate = _downed_mate()
			if mate != null:
				Net.send({"t": "revive", "target": mate.id})
			else:
				var v = vehicles.nearest(body.x, body.z)
				if v != null:
					Net.send({"t": "veh", "a": "enter", "i": v.i})
	# Streaks.
	var sa: Dictionary = me.get("streaksAvail", {})
	if sa.get("uav", false) and keys.get(KEY_5, false):
		Net.send({"t": "streak", "kind": "uav"})

func _throw() -> void:
	var kind := ""
	for k in ["frag", "smoke", "flash"]:
		if int(me.get(k, 0)) > 0:
			kind = k
			break
	if kind == "":
		hud.toast("You have no grenades. Buy some at the armoury.", "bad", 1.5)
		return
	var d := Phys.dir_from_angles(yaw, pitch + 0.12)
	var p := cam.global_position
	var sp := 17.0
	var v := [d.x * sp + vel.x * 0.5, d.y * sp + 2.0, d.z * sp + vel.y * 0.5]
	Net.send({"t": "throw", "kind": kind, "o": [snappedf(p.x + d.x * 0.4, 0.01), snappedf(p.y - 0.1, 0.01), snappedf(p.z + d.z * 0.4, 0.01)], "v": [snappedf(v[0], 0.01), snappedf(v[1], 0.01), snappedf(v[2], 0.01)]})
	Sfx.play("throw")

func _in_buy_zone() -> bool:
	if mode_id == "practice":
		return true
	var b: Dictionary = map.get("bases", {}).get(side, {})
	var mon: Dictionary = Cfg.rules.get("MONEY", {})
	if b.is_empty():
		return false
	if Vector2(body.x - float(b.x), body.z - float(b.z)).length() < float(mon.get("buyZoneRadius", 16)):
		return true
	return Net.server_now() < float(me.get("buyUntil", 0))

func _downed_mate():
	for so in soldiers.values():
		if so.is_mate and so.flags & 2 and so.position.distance_to(Vector3(body.x, body.y, body.z)) < 2.4:
			return so
	return null

## Touch aim help: look slows a little when the crosshair is on an enemy.
func _aim_assist() -> float:
	if not Cfg.get_s("aim_assist", true) or mouse_look:
		return 1.0
	var o := cam.global_position
	var d := Phys.dir_from_angles(yaw, pitch)
	for so in soldiers.values():
		if not so.visible or so.is_mate or so.flags & (256 | 4 | 2048):
			continue
		var to: Vector3 = so.chest() - o
		var dist := to.length()
		if dist > 80.0 or dist < 0.5:
			continue
		var off := (to - d * to.dot(d)).length()
		if off < 0.9 + dist * 0.01 and to.dot(d) > 0:
			return 0.6
	return 1.0

## Billboards you can actually see right now (in range, facing you, on screen, not blocked).
func _visible_boards() -> Array:
	var out: Array = []
	var radius := {"sky": 260.0, "led": 80.0, "ground": 140.0, "wall": 45.0}
	var o := cam.global_position
	for bd in boards:
		var mi: MeshInstance3D = bd[1]
		var p := mi.global_position
		if o.distance_to(p) > radius.get(bd[2], 60.0):
			continue
		if not cam.is_position_in_frustum(p):
			continue
		var n := mi.global_basis.z
		if bd[2] != "ground" and n.dot((o - p).normalized()) < 0.1:
			continue
		if phys.line_blocked(o, p + (o - p).normalized() * 0.6):
			continue
		if not out.has(bd[0]):
			out.append(bd[0])
	return out
