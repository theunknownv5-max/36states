extends Control
## The lobby: your soldier, online count, game modes, the war map of all 36 states + FCT,
## the state briefing, "wetin you be" (side and faction), bots or real players, and Deploy.

const WarMap = preload("res://ui/warmap.gd")
const Settings = preload("res://ui/settings.gd")
const NATIVE_MODES := ["conquest", "tdm", "practice"]

var main: Node
var map: Control
var info: VBoxContainer
var name_label: Label
var rank_label: Label
var gems_label: Label
var online_label: Label
var mode := "conquest"
var faction := "army"
var mode_chips := {}
var deploy: Button
var err: Label
var overlay: Control

func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(Kit.bg_rect(Color("#07080b")))
	faction = str(Cfg.get_s("faction", "army"))
	if Cfg.faction(faction).is_empty():
		faction = "army"
	var m := Kit.safe_margin(12)
	add_child(m)
	var col := Kit.vbox(8)
	m.add_child(col)
	# Top bar.
	var top := Kit.hbox(10)
	col.add_child(top)
	var logo := Kit.title("POD", 30)
	logo.add_theme_color_override("font_color", Kit.POD)
	top.add_child(logo)
	var who := Kit.vbox(0)
	name_label = Kit.label("", 19, Kit.TEXT, true)
	rank_label = Kit.label("", 14, Kit.MUTED)
	who.add_child(name_label)
	who.add_child(rank_label)
	top.add_child(who)
	top.add_child(Kit.grow(Control.new()))
	gems_label = Kit.label("", 18, Kit.GEM, true)
	top.add_child(gems_label)
	online_label = Kit.label("", 16, Kit.GOOD)
	top.add_child(online_label)
	var set_b := Kit.button("⚙")
	set_b.custom_minimum_size = Vector2(52, 48)
	set_b.pressed.connect(_open_settings)
	top.add_child(set_b)
	var about := Kit.button("About")
	about.custom_minimum_size = Vector2(0, 48)
	about.pressed.connect(_open_about)
	top.add_child(about)
	# Modes.
	var modes := Kit.hbox(8)
	col.add_child(modes)
	var defs: Dictionary = Cfg.rules.get("MODES", {})
	for id in ["conquest", "tdm", "practice", "bomb", "stage"]:
		if not defs.has(id):
			continue
		var c := Kit.chip(defs[id].label, id == mode)
		if not NATIVE_MODES.has(id):
			c.text = defs[id].label + " (soon)"
			c.disabled = true
		c.pressed.connect(_set_mode.bind(id))
		modes.add_child(c)
		mode_chips[id] = c
	# Map + briefing.
	var body := Kit.hbox(10)
	body.size_flags_vertical = Control.SIZE_EXPAND_FILL
	col.add_child(body)
	map = WarMap.new()
	map.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	map.size_flags_vertical = Control.SIZE_EXPAND_FILL
	map.size_flags_stretch_ratio = 1.25
	map.picked.connect(func(_id): _render_info())
	body.add_child(map)
	var side := Kit.panel(12)
	side.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	side.size_flags_vertical = Control.SIZE_EXPAND_FILL
	body.add_child(side)
	var sv := Kit.vbox(8)
	side.add_child(sv)
	var sc := Kit.scroller()
	sv.add_child(sc)
	info = Kit.vbox(8)
	info.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	sc.add_child(info)
	err = Kit.para("", 15, Kit.BAD)
	err.visible = false
	sv.add_child(err)
	deploy = Kit.button("PICK A STATE ON THE MAP", true, 21)
	deploy.custom_minimum_size = Vector2(0, 60)
	deploy.pressed.connect(_deploy)
	sv.add_child(deploy)
	var last: String = Cfg.get_s("last_state", "")
	if last != "":
		map.selected = last
	refresh()

func refresh() -> void:
	if main == null:
		return
	var p: Dictionary = main.profile
	name_label.text = str(p.get("name", "Soldier"))
	var rank: Dictionary = p.get("rank", {})
	rank_label.text = "%s · Level %d · %d XP" % [rank.get("name", "Recruit"), int(rank.get("level", 1)), int(p.get("xp", 0))]
	gems_label.text = "◆ %d" % int(p.get("gems", 0))
	online_label.text = "● %d online" % int(main.online)
	var live := {}
	for s in main.lobby_states:
		live[s.id] = s
	map.live = live
	_render_info()

func _set_mode(id: String) -> void:
	mode = id
	for k in mode_chips:
		mode_chips[k].set_pressed_no_signal(k == id)
	_render_info()

func _render_info() -> void:
	for c in info.get_children():
		c.queue_free()
	var sid: String = map.selected
	var defs: Dictionary = Cfg.rules.get("MODES", {})
	var md: Dictionary = defs.get(mode, {})
	if sid == "":
		info.add_child(Kit.title("PICK YOUR BATTLEFIELD", 22))
		info.add_child(Kit.para("Tap any state on the map. Orange glow = real soldiers dey fight there now.", 16))
		info.add_child(Kit.para(str(md.get("blurb", "")), 15))
		deploy.text = "PICK A STATE ON THE MAP"
		deploy.disabled = true
		return
	Cfg.set_s("last_state", sid)
	var st := Cfg.state_by_id(sid)
	var lv: Dictionary = {}
	for s in main.lobby_states:
		if s.id == sid:
			lv = s
	info.add_child(Kit.title(str(st.get("name", sid)).to_upper(), 26))
	var biome: Dictionary = Cfg.rules.get("BIOMES", {}).get(st.get("biome", ""), {})
	info.add_child(Kit.para("Capital: %s · %s · %s" % [st.get("capital", ""), Cfg.rules.get("ZONES", {}).get(st.get("zone", ""), ""), biome.get("label", "")], 15))
	var res: Array = []
	for r in st.get("resources", []):
		res.append(Cfg.rules.get("RESOURCES", {}).get(r, {}).get("site", r))
	if mode == "conquest":
		info.add_child(Kit.para("Sites to hold: " + ", ".join(res), 15, Kit.TEXT))
	info.add_child(Kit.para(str(md.get("blurb", "")), 15))
	# Bots or real players.
	var kind := Kit.panel(10)
	var kv := Kit.vbox(6)
	kind.add_child(kv)
	var bots: bool = Cfg.get_s("bots", true)
	var real_here := int(lv.get("realModes", {}).get(mode, 0))
	if mode == "practice":
		kv.add_child(Kit.para("Practice: na only you and your crew. Target dummies no dey shoot back.", 15, Kit.TEXT))
	elif bots:
		kv.add_child(Kit.para("You go fight with bots and any real soldier wey dey there (%d now)." % int(lv.get("modes", {}).get(mode, 0)), 15, Kit.TEXT))
		var b := Kit.button("Play real players only · %d online" % int(main.online), false, 16)
		b.pressed.connect(func():
			Cfg.set_s("bots", false)
			_render_info())
		kv.add_child(b)
	else:
		kv.add_child(Kit.para("Real players only: %d online, %d for this battle room now." % [int(main.online), real_here], 15, Kit.GOOD))
		var b := Kit.button("Add bots", false, 16)
		b.pressed.connect(func():
			Cfg.set_s("bots", true)
			_render_info())
		kv.add_child(b)
	info.add_child(kind)
	# Side and faction.
	info.add_child(Kit.label("WETIN YOU BE?", 18, Kit.POD2, true))
	var facs: Dictionary = Cfg.rules.get("FACTIONS", {})
	for side_id in ["sec", "out"]:
		var sd: Dictionary = Cfg.rules.get("SIDES", {}).get(side_id, {})
		info.add_child(Kit.label(str(sd.get("label", side_id)), 15, Kit.side_color(side_id), true))
		var grid := GridContainer.new()
		grid.columns = 2
		grid.add_theme_constant_override("h_separation", 6)
		grid.add_theme_constant_override("v_separation", 6)
		info.add_child(grid)
		for fid in facs:
			var f: Dictionary = facs[fid]
			if f.side != side_id:
				continue
			var c := Kit.chip(str(f.label), fid == faction)
			c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			c.tooltip_text = str(f.blurb)
			c.pressed.connect(func():
				faction = fid
				_render_info())
			grid.add_child(c)
	var ff: Dictionary = facs.get(faction, {})
	info.add_child(Kit.para(str(ff.get("blurb", "")), 14, Kit.MUTED))
	deploy.disabled = false
	deploy.text = ("OPEN PRACTICE RANGE IN " if mode == "practice" else "DEPLOY TO ") + str(st.get("name", sid)).to_upper()

func _deploy() -> void:
	if map.selected == "":
		return
	err.visible = false
	deploy.disabled = true
	deploy.text = "DEPLOYING…"
	Sfx.ui("alert")
	main.join(map.selected, faction, mode)
	get_tree().create_timer(12.0).timeout.connect(func():
		if is_inside_tree() and deploy.disabled:
			_render_info())

func join_error(t: String) -> void:
	err.text = t
	err.visible = true
	_render_info()

func net_status(on: bool) -> void:
	if not on:
		online_label.text = "● reconnecting…"
		online_label.add_theme_color_override("font_color", Kit.BAD)
	else:
		online_label.add_theme_color_override("font_color", Kit.GOOD)

func _open_settings() -> void:
	overlay = Settings.new()
	overlay.closed.connect(func(): overlay = null; _render_info())
	add_child(overlay)

func _open_about() -> void:
	var o := Control.new()
	o.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	o.mouse_filter = Control.MOUSE_FILTER_STOP
	o.add_child(Kit.bg_rect(Color(0, 0, 0, 0.7)))
	var c := CenterContainer.new()
	Kit.fill(c)
	o.add_child(c)
	var p := Kit.panel(20)
	p.custom_minimum_size = Vector2(min(600.0, size.x - 40.0), 0)
	c.add_child(p)
	var v := Kit.vbox(10)
	p.add_child(v)
	var g: Dictionary = Cfg.rules.get("GAME", {})
	v.add_child(Kit.title("PROOF OF DUTY", 30))
	v.add_child(Kit.para(str(g.get("about", "")), 16, Kit.TEXT))
	v.add_child(Kit.para("Version %s · native build %d\nDeveloped by Tcee 🇳🇬".replace(" 🇳🇬", "") % [Cfg.VERSION, Cfg.build], 15))
	var site := str(g.get("website", "https://proofofduty.com"))
	var web := Kit.button("Visit the official website · " + site.replace("https://", ""), true, 17)
	web.pressed.connect(func(): OS.shell_open(site))
	v.add_child(web)
	var close := Kit.button("Close")
	close.pressed.connect(func(): o.queue_free(); overlay = null)
	v.add_child(close)
	overlay = o
	add_child(o)

func on_back() -> void:
	if overlay and is_instance_valid(overlay):
		if overlay.has_method("on_back"):
			overlay.on_back()
		else:
			overlay.queue_free()
		overlay = null
