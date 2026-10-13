class_name Hud
extends Control
## Everything on screen in battle: crosshair and hit markers, damage direction, health and
## armour, ammo, money and gems, the score bar with the sites, the radar, kill feed, toasts and
## banners, and the full-screen panels (armoury, scoreboard, death choices, match end, pause).

signal buy(item: String)
signal respawn(mode: String)
signal quick_chat(i: int)
signal leave
signal settings
signal resume

const QUICK := ["Follow me!", "Enemy dey here!", "I need help o!", "Cover me!", "Hold this place!", "Well done, my guy!"]

var battle: Node
var cross: Control
var radar: Control
var health_bar: ProgressBar
var armor_bar: ProgressBar
var health_lbl: Label
var money_lbl: Label
var gems_lbl: Label
var ammo_lbl: Label
var weapon_lbl: Label
var kit_lbl: Label
var score_sec: Label
var score_out: Label
var timer_lbl: Label
var sites_box: HBoxContainer
var feed: VBoxContainer
var toasts: VBoxContainer
var banner: Label
var vignette: ColorRect
var hurt_flash := 0.0
var hit_t := 0.0
var hit_kill := false
var hit_head := false
var dmg_dirs: Array = []   # [angle, life]
var spread := 0.02
var scoped := false
var panel: Control = null
var panel_kind := ""
var status_lbl: Label
var ping_lbl: Label
var buy_hint: Label
var prompt_lbl: Label
var white := 0.0

func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	vignette = ColorRect.new()
	Kit.fill(vignette)
	vignette.mouse_filter = Control.MOUSE_FILTER_IGNORE
	vignette.color = Color(0.6, 0, 0, 0)
	add_child(vignette)
	cross = Control.new()
	Kit.fill(cross)
	cross.mouse_filter = Control.MOUSE_FILTER_IGNORE
	cross.draw.connect(_draw_cross)
	add_child(cross)
	var m := Kit.safe_margin(10)
	m.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(m)
	var frame := Control.new()
	frame.mouse_filter = Control.MOUSE_FILTER_IGNORE
	m.add_child(frame)
	# Radar (top left).
	radar = Control.new()
	radar.custom_minimum_size = Vector2(150, 150)
	radar.size = Vector2(150, 150)
	radar.position = Vector2(0, 0)
	radar.mouse_filter = Control.MOUSE_FILTER_IGNORE
	radar.draw.connect(_draw_radar)
	frame.add_child(radar)
	ping_lbl = Kit.label("", 12, Kit.MUTED)
	ping_lbl.position = Vector2(4, 152)
	frame.add_child(ping_lbl)
	# Score bar (top centre).
	var top := HBoxContainer.new()
	top.add_theme_constant_override("separation", 8)
	top.set_anchors_and_offsets_preset(Control.PRESET_CENTER_TOP)
	top.alignment = BoxContainer.ALIGNMENT_CENTER
	top.mouse_filter = Control.MOUSE_FILTER_IGNORE
	frame.add_child(top)
	score_sec = _pill(top, "0", Kit.SEC)
	timer_lbl = _pill(top, "15:00", Kit.TEXT)
	score_out = _pill(top, "0", Kit.OUT)
	sites_box = HBoxContainer.new()
	sites_box.add_theme_constant_override("separation", 6)
	sites_box.set_anchors_and_offsets_preset(Control.PRESET_CENTER_TOP)
	sites_box.position.y = 44
	sites_box.alignment = BoxContainer.ALIGNMENT_CENTER
	sites_box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	frame.add_child(sites_box)
	# Kill feed (top right).
	feed = VBoxContainer.new()
	feed.set_anchors_and_offsets_preset(Control.PRESET_TOP_RIGHT)
	feed.grow_horizontal = Control.GROW_DIRECTION_BEGIN
	feed.position.y = 78
	feed.alignment = BoxContainer.ALIGNMENT_BEGIN
	feed.mouse_filter = Control.MOUSE_FILTER_IGNORE
	feed.add_theme_constant_override("separation", 2)
	frame.add_child(feed)
	# Toasts and banner (centre).
	toasts = VBoxContainer.new()
	toasts.set_anchors_and_offsets_preset(Control.PRESET_CENTER_TOP)
	toasts.position.y = 84
	toasts.grow_horizontal = Control.GROW_DIRECTION_BOTH
	toasts.alignment = BoxContainer.ALIGNMENT_CENTER
	toasts.mouse_filter = Control.MOUSE_FILTER_IGNORE
	frame.add_child(toasts)
	banner = Kit.title("", 34)
	banner.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	banner.position.y -= 120
	banner.grow_horizontal = Control.GROW_DIRECTION_BOTH
	banner.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	banner.modulate.a = 0.0
	frame.add_child(banner)
	prompt_lbl = Kit.label("", 18, Color.WHITE, true)
	prompt_lbl.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	prompt_lbl.position.y += 70
	prompt_lbl.grow_horizontal = Control.GROW_DIRECTION_BOTH
	prompt_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	prompt_lbl.add_theme_constant_override("outline_size", 6)
	prompt_lbl.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.8))
	frame.add_child(prompt_lbl)
	status_lbl = Kit.label("", 22, Color.WHITE, true)
	status_lbl.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	status_lbl.position.y += 110
	status_lbl.grow_horizontal = Control.GROW_DIRECTION_BOTH
	status_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	status_lbl.add_theme_constant_override("outline_size", 8)
	status_lbl.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.8))
	frame.add_child(status_lbl)
	# Health, armour, money (bottom left).
	var bl := VBoxContainer.new()
	bl.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_LEFT)
	bl.grow_vertical = Control.GROW_DIRECTION_BEGIN
	bl.position.x = 170
	bl.mouse_filter = Control.MOUSE_FILTER_IGNORE
	bl.add_theme_constant_override("separation", 3)
	frame.add_child(bl)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	bl.add_child(row)
	money_lbl = Kit.label("", 18, Kit.GOOD, true)
	gems_lbl = Kit.label("", 18, Kit.GEM, true)
	row.add_child(money_lbl)
	row.add_child(gems_lbl)
	health_lbl = Kit.label("100", 30, Color.WHITE, true)
	health_lbl.add_theme_constant_override("outline_size", 6)
	health_lbl.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.7))
	bl.add_child(health_lbl)
	health_bar = _bar(Kit.GOOD, 220, 9)
	bl.add_child(health_bar)
	armor_bar = _bar(Color("#6fb6ff"), 220, 5)
	bl.add_child(armor_bar)
	# Ammo (bottom right, above the touch buttons).
	var br := VBoxContainer.new()
	br.set_anchors_and_offsets_preset(Control.PRESET_CENTER_BOTTOM)
	br.grow_vertical = Control.GROW_DIRECTION_BEGIN
	br.grow_horizontal = Control.GROW_DIRECTION_BOTH
	br.mouse_filter = Control.MOUSE_FILTER_IGNORE
	br.add_theme_constant_override("separation", 0)
	frame.add_child(br)
	ammo_lbl = Kit.label("", 30, Color.WHITE, true)
	ammo_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	ammo_lbl.add_theme_constant_override("outline_size", 6)
	ammo_lbl.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.7))
	ammo_lbl.custom_minimum_size = Vector2(180, 0)
	br.add_child(ammo_lbl)
	weapon_lbl = Kit.label("", 15, Kit.MUTED, true)
	weapon_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	br.add_child(weapon_lbl)
	kit_lbl = Kit.label("", 14, Kit.MUTED)
	kit_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	br.add_child(kit_lbl)
	buy_hint = Kit.label("", 14, Kit.POD2, true)
	buy_hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	br.add_child(buy_hint)

func _pill(parent: Control, text: String, col: Color) -> Label:
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", Kit.box(Color(0, 0, 0, 0.5), 8, Color(col.r, col.g, col.b, 0.6), 1, 4))
	p.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var l := Kit.label(text, 22, col, true)
	l.custom_minimum_size = Vector2(58, 0)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	p.add_child(l)
	parent.add_child(p)
	return l

func _bar(col: Color, w: float, h: float) -> ProgressBar:
	var b := ProgressBar.new()
	b.custom_minimum_size = Vector2(w, h)
	b.show_percentage = false
	b.max_value = 100
	b.mouse_filter = Control.MOUSE_FILTER_IGNORE
	b.add_theme_stylebox_override("background", Kit.box(Color(0, 0, 0, 0.5), 3, Color(0, 0, 0, 0), 0, 0))
	b.add_theme_stylebox_override("fill", Kit.box(col, 3, Color(0, 0, 0, 0), 0, 0))
	return b

# ---------- updates from the battle ----------
func set_me(me: Dictionary, ammo: Dictionary, wname: String, melee: bool) -> void:
	var hp := int(me.get("health", 100))
	health_lbl.text = str(hp)
	health_bar.value = hp
	var fill: StyleBoxFlat = health_bar.get_theme_stylebox("fill")
	fill.bg_color = Kit.GOOD if hp > 60 else Kit.GOLD if hp > 30 else Kit.BAD
	armor_bar.value = int(me.get("armor", 0))
	money_lbl.text = Kit.naira(me.get("money", 0))
	gems_lbl.text = "◆ %d" % int(me.get("gems", 0))
	if melee:
		ammo_lbl.text = "—"
	elif ammo.is_empty():
		ammo_lbl.text = ""
	else:
		ammo_lbl.text = "%d / %d" % [int(ammo.get("mag", 0)), int(ammo.get("reserve", 0))]
	weapon_lbl.text = wname
	var bits: Array = []
	for k in [["frag", "Frag"], ["smoke", "Smoke"], ["flash", "Flash"], ["medkit", "Medkit"], ["bloodpill", "Pill"]]:
		var n := int(me.get(k[0], 0))
		if n > 0:
			bits.append("%s ×%d" % [k[1], n])
	kit_lbl.text = "  ".join(bits)

func set_score(score: Dictionary, left_ms: float, sites: Array, my_side: String) -> void:
	score_sec.text = str(int(score.get("sec", 0)))
	score_out.text = str(int(score.get("out", 0)))
	var s := int(left_ms / 1000.0)
	timer_lbl.text = "%d:%02d" % [s / 60, s % 60]
	for c in sites_box.get_children():
		c.queue_free()
	for st in sites:
		var owner = st.get("owner")
		var col := Kit.MUTED if owner == null else Kit.side_color(str(owner))
		if st.get("contested", false):
			col = Kit.GOLD
		var p := PanelContainer.new()
		p.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var prog := float(st.get("progress", 0.0))
		var fillc := Kit.SEC if prog > 0 else Kit.OUT
		p.add_theme_stylebox_override("panel", Kit.box(Color(fillc.r, fillc.g, fillc.b, 0.15 + absf(prog) * 0.5), 6, col, 2, 2))
		var l := Kit.label(str(st.get("id", "?")), 16, Color.WHITE, true)
		l.custom_minimum_size = Vector2(30, 0)
		l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		p.add_child(l)
		sites_box.add_child(p)

func kill_feed(m: Dictionary, my_id: String) -> void:
	var weapon := str(m.get("w", ""))
	var wn: String = Cfg.weapon(weapon).get("name", weapon)
	var kn := str(m.get("kn", "")) if m.get("kn") != null else ""
	var text := "%s  [%s]%s  %s" % [kn, wn, " ✚" if m.get("head", false) else "", str(m.get("vn", ""))]
	if kn == "":
		text = "%s  [%s]" % [str(m.get("vn", "")), wn]
	var l := Kit.label(text, 15, Color.WHITE, true)
	var mine: bool = m.get("killer") == my_id or m.get("victim") == my_id
	var p := PanelContainer.new()
	p.mouse_filter = Control.MOUSE_FILTER_IGNORE
	p.add_theme_stylebox_override("panel", Kit.box(Color(0, 0, 0, 0.55) if not mine else Color(0.5, 0.25, 0.05, 0.75), 6, Color(0, 0, 0, 0), 0, 3))
	p.add_child(l)
	feed.add_child(p)
	while feed.get_child_count() > 5:
		feed.get_child(0).queue_free()
		feed.remove_child(feed.get_child(0))
	get_tree().create_timer(6.0).timeout.connect(func(): if is_instance_valid(p): p.queue_free())

func toast(text: String, kind := "info", secs := 3.5) -> void:
	var col := {"bad": Kit.BAD, "gem": Kit.GEM, "streak": Kit.GOLD, "good": Kit.GOOD}.get(kind, Color.WHITE)
	var p := PanelContainer.new()
	p.mouse_filter = Control.MOUSE_FILTER_IGNORE
	p.add_theme_stylebox_override("panel", Kit.box(Color(0, 0, 0, 0.62), 8, Color(col.r, col.g, col.b, 0.5), 1, 6))
	var l := Kit.label(text, 17, col, true)
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.custom_minimum_size = Vector2(min(560.0, size.x * 0.6), 0)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	p.add_child(l)
	toasts.add_child(p)
	while toasts.get_child_count() > 3:
		var c := toasts.get_child(0)
		toasts.remove_child(c)
		c.queue_free()
	get_tree().create_timer(secs).timeout.connect(func(): if is_instance_valid(p): p.queue_free())

func show_banner(text: String, col := Color.WHITE, secs := 2.5) -> void:
	banner.text = text
	banner.add_theme_color_override("font_color", col)
	banner.modulate.a = 1.0
	var tw := create_tween()
	tw.tween_interval(secs)
	tw.tween_property(banner, "modulate:a", 0.0, 0.6)

func hit(head: bool, kill: bool) -> void:
	hit_t = 0.25 if not kill else 0.45
	hit_kill = kill
	hit_head = head

func hurt(angle: float, dmg: float) -> void:
	hurt_flash = min(0.6, hurt_flash + dmg / 60.0)
	dmg_dirs.append([angle, 1.4])

func flashed(s: float) -> void:
	white = max(white, s)

func _process(delta: float) -> void:
	hit_t = max(0.0, hit_t - delta)
	hurt_flash = max(0.0, hurt_flash - delta * 0.8)
	white = max(0.0, white - delta * 0.35)
	for d in dmg_dirs:
		d[1] -= delta
	dmg_dirs = dmg_dirs.filter(func(d): return d[1] > 0)
	var hp := 100.0
	if battle and battle.me:
		hp = float(battle.me.get("health", 100))
	var low: float = clamp((35.0 - hp) / 35.0, 0.0, 1.0) if battle and battle.status == "alive" else 0.0
	vignette.color = Color(0.55, 0, 0, max(hurt_flash, low * 0.35)) if white <= 0.01 else Color(1, 1, 1, min(1.0, white))
	cross.queue_redraw()
	radar.queue_redraw()

func _draw_cross() -> void:
	var c := cross.size / 2.0
	if battle == null:
		return
	if scoped:
		# Sniper scope: black ring and fine reticle.
		var r: float = min(cross.size.x, cross.size.y) * 0.46
		var black := Color(0, 0, 0, 1)
		cross.draw_rect(Rect2(0, 0, c.x - r, cross.size.y), black)
		cross.draw_rect(Rect2(c.x + r, 0, cross.size.x - c.x - r, cross.size.y), black)
		cross.draw_arc(c, r + 30, 0, TAU, 64, black, 60.0)
		cross.draw_line(c - Vector2(r, 0), c + Vector2(r, 0), Color(0, 0, 0, 0.9), 1.5)
		cross.draw_line(c - Vector2(0, r), c + Vector2(0, r), Color(0, 0, 0, 0.9), 1.5)
		cross.draw_circle(c, 2.0, Color(1, 0.2, 0.2))
	elif battle.status == "alive" and not battle.ads_on:
		var gap: float = 6.0 + spread * 900.0
		var col := Color(1, 1, 1, 0.9)
		for d in [Vector2(1, 0), Vector2(-1, 0), Vector2(0, 1), Vector2(0, -1)]:
			cross.draw_line(c + d * gap, c + d * (gap + 9.0), Color(0, 0, 0, 0.5), 4.0)
			cross.draw_line(c + d * gap, c + d * (gap + 9.0), col, 2.0)
		cross.draw_circle(c, 1.6, col)
	elif battle.status == "alive":
		cross.draw_circle(c, 2.2, Color(1, 0.3, 0.2, 0.95))
	if hit_t > 0:
		var a: float = min(1.0, hit_t * 5.0)
		var col2 := Color(1, 0.25, 0.2, a) if hit_kill else Color(1, 0.9 if not hit_head else 0.4, 0.3 if hit_head else 1.0, a)
		for d in [Vector2(1, 1), Vector2(-1, 1), Vector2(1, -1), Vector2(-1, -1)]:
			cross.draw_line(c + d * 7.0, c + d * 16.0, col2, 3.0 if hit_kill else 2.0)
	for dd in dmg_dirs:
		var ang: float = dd[0]
		var a2: float = clamp(dd[1], 0.0, 1.0)
		var r2 := 90.0
		cross.draw_arc(c, r2, ang - 0.35 - PI / 2.0, ang + 0.35 - PI / 2.0, 12, Color(1, 0.15, 0.1, 0.8 * a2), 7.0)

func _draw_radar() -> void:
	var s := radar.size
	var c := s / 2.0
	var r := s.x / 2.0 - 2.0
	radar.draw_circle(c, r, Color(0, 0, 0, 0.45))
	radar.draw_arc(c, r, 0, TAU, 48, Color(1, 1, 1, 0.25), 1.5)
	if battle == null or battle.world == null:
		return
	var scale_m := r / 60.0
	var me: Vector3 = battle.body_pos()
	var yaw: float = battle.yaw
	var rot := func(p: Vector3) -> Vector2:
		var d := Vector2(p.x - me.x, p.z - me.z)
		var rr := d.rotated(yaw)
		return rr * scale_m
	for st in battle.sites:
		var p: Vector2 = rot.call(Vector3(st.x, 0, st.z))
		if p.length() > r - 8:
			p = p.normalized() * (r - 8)
		var owner = st.get("owner")
		var col := Kit.MUTED if owner == null else Kit.side_color(str(owner))
		radar.draw_circle(c + p, 8, Color(col.r, col.g, col.b, 0.55))
		radar.draw_string(Kit.font_bold, c + p + Vector2(-4, 5), str(st.id), HORIZONTAL_ALIGNMENT_LEFT, -1, 12, Color.WHITE)
	for so in battle.soldiers.values():
		if not so.visible:
			continue
		var f: int = so.flags
		if f & 256:
			continue
		var show: bool = so.is_mate or f & 8 or f & 512
		if not show:
			continue
		var p: Vector2 = rot.call(so.position)
		if p.length() > r - 3:
			if not so.is_mate:
				continue
			p = p.normalized() * (r - 3)
		radar.draw_circle(c + p, 3.5, Kit.SEC.lightened(0.2) if so.is_mate else Kit.OUT)
	# You: an arrow pointing up.
	radar.draw_colored_polygon(PackedVector2Array([c + Vector2(0, -7), c + Vector2(5, 5), c + Vector2(-5, 5)]), Color.WHITE)

# ---------- full-screen panels ----------
func close_panel() -> void:
	if panel and is_instance_valid(panel):
		panel.queue_free()
	panel = null
	panel_kind = ""

func _overlay(kind: String, dim := 0.55) -> VBoxContainer:
	close_panel()
	panel_kind = kind
	panel = Control.new()
	Kit.fill(panel)
	panel.mouse_filter = Control.MOUSE_FILTER_STOP
	panel.add_child(Kit.bg_rect(Color(0, 0, 0, dim)))
	add_child(panel)
	var m := Kit.safe_margin(18)
	panel.add_child(m)
	var center := CenterContainer.new()
	m.add_child(center)
	var card := Kit.panel(16)
	card.custom_minimum_size = Vector2(min(760.0, size.x - 40.0), 0)
	center.add_child(card)
	var v := Kit.vbox(10)
	card.add_child(v)
	return v

## The armoury: weapons by slot and gear, with prices for your faction.
func show_buy(me: Dictionary, level: int) -> void:
	var v := _overlay("buy", 0.4)
	var head := Kit.hbox()
	head.add_child(Kit.grow(Kit.title("ARMOURY", 26)))
	head.add_child(Kit.label(Kit.naira(me.get("money", 0)), 22, Kit.GOOD, true))
	var x := Kit.button("✕")
	x.custom_minimum_size = Vector2(52, 48)
	x.pressed.connect(close_panel)
	head.add_child(x)
	v.add_child(head)
	var sc := Kit.scroller()
	sc.custom_minimum_size = Vector2(0, min(440.0, size.y - 160.0))
	v.add_child(sc)
	var list := Kit.vbox(8)
	list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	sc.add_child(list)
	var fac: Dictionary = Cfg.faction(str(me.get("faction", "army")))
	var price_of := func(id: String, base: int) -> int:
		var p := base
		if fac.get("discount", "") == id:
			p = int(round(p * 0.5)) if id != "danegun" else 0
		if fac.get("perks", {}).has("explosiveDiscount") and (Cfg.weapon(id).get("explosive", false) or Cfg.rules.get("GEAR", {}).get(id, {}).get("explosive", false)):
			p = int(round(p * (1.0 - float(fac.perks.explosiveDiscount))))
		return p
	for group in [["Pistols", "secondary"], ["Main guns", "primary"]]:
		list.add_child(Kit.label(group[0].to_upper(), 15, Kit.POD2, true))
		var grid := GridContainer.new()
		grid.columns = 3
		grid.add_theme_constant_override("h_separation", 8)
		grid.add_theme_constant_override("v_separation", 8)
		list.add_child(grid)
		var ws: Dictionary = Cfg.rules.get("WEAPONS", {})
		for id in ws:
			var w: Dictionary = ws[id]
			if w.get("slot") != group[1] or w.get("melee", false) or w.get("loot", false) or id == "p9":
				continue
			var price: int = price_of.call(id, int(w.get("price", 0)))
			var locked: bool = int(w.get("unlockLevel", 0)) > level
			var b := Kit.button("%s\n%s" % [w.name, ("Rank %d" % int(w.unlockLevel)) if locked else Kit.naira(price)], false, 16)
			b.custom_minimum_size = Vector2(0, 64)
			b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			b.disabled = locked or price > int(me.get("money", 0))
			b.pressed.connect(func(): buy.emit(id))
			grid.add_child(b)
	list.add_child(Kit.label("GEAR", 15, Kit.POD2, true))
	var g2 := GridContainer.new()
	g2.columns = 3
	g2.add_theme_constant_override("h_separation", 8)
	g2.add_theme_constant_override("v_separation", 8)
	list.add_child(g2)
	var gear: Dictionary = Cfg.rules.get("GEAR", {})
	for id in gear:
		if id == "c4":
			continue
		var gd: Dictionary = gear[id]
		var price: int = price_of.call(id, int(gd.get("price", 0)))
		var b := Kit.button("%s\n%s" % [gd.name, Kit.naira(price)], false, 16)
		b.custom_minimum_size = Vector2(0, 64)
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.disabled = price > int(me.get("money", 0))
		b.pressed.connect(func(): buy.emit(id))
		g2.add_child(b)

func show_scores(roster: Array, my_id: String) -> void:
	var v := _overlay("scores", 0.5)
	var head := Kit.hbox()
	head.add_child(Kit.grow(Kit.title("SCOREBOARD", 24)))
	var x := Kit.button("✕")
	x.custom_minimum_size = Vector2(52, 48)
	x.pressed.connect(close_panel)
	head.add_child(x)
	v.add_child(head)
	var cols := Kit.hbox(14)
	v.add_child(cols)
	for side in ["sec", "out"]:
		var col := Kit.vbox(3)
		col.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		cols.add_child(col)
		col.add_child(Kit.label(str(Cfg.rules.get("SIDES", {}).get(side, {}).get("label", side)), 17, Kit.side_color(side), true))
		var rows := roster.filter(func(r): return r.side == side)
		rows.sort_custom(func(a, b): return int(a.points) > int(b.points))
		for r in rows:
			var line := Kit.label("%s%s   %d/%d   %d pts" % [r.name, " (bot)" if r.get("bot", false) else "", int(r.kills), int(r.deaths), int(r.points)], 15, Color.WHITE if r.id == my_id else Kit.MUTED, r.id == my_id)
			col.add_child(line)

## You fell: life gem, spirit run or medevac (or wait in practice).
func show_death(by: String, gems: int, can_respawn: bool, practice: bool) -> void:
	var v := _overlay("death", 0.35)
	v.add_child(Kit.title("YOU DON FALL", 30))
	v.add_child(Kit.para(("Na %s get you." % by) if by != "" else "You don go down.", 17, Kit.TEXT))
	if practice:
		v.add_child(Kit.para("Practice range: you go stand up again in 3 seconds.", 16))
		return
	if not can_respawn:
		v.add_child(Kit.para("No respawn for this mode. You go enter next round.", 16))
		return
	var row := Kit.hbox(10)
	v.add_child(row)
	var resp: Dictionary = Cfg.rules.get("RESPAWN", {})
	var g := Kit.button("◆ LIFE GEM\nBack now (you get %d)" % gems, true, 17)
	g.custom_minimum_size = Vector2(0, 84)
	g.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	g.disabled = gems < int(resp.get("gemCost", 1))
	g.pressed.connect(func(): respawn.emit("gem"))
	row.add_child(g)
	var s := Kit.button("SPIRIT RUN\nReach a glowing gem in %ds" % int(float(resp.get("spiritMs", 40000)) / 1000.0), false, 17)
	s.custom_minimum_size = Vector2(0, 84)
	s.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	s.pressed.connect(func(): respawn.emit("spirit"))
	row.add_child(s)
	var md := Kit.button("MEDEVAC\n%ds · %s" % [int(float(resp.get("medevacMs", 25000)) / 1000.0), Kit.naira(resp.get("medevacFee", 1000))], false, 17)
	md.custom_minimum_size = Vector2(0, 84)
	md.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	md.pressed.connect(func(): respawn.emit("medevac"))
	row.add_child(md)
	v.add_child(Kit.para("If you no choose, medevac go come carry you after 60 seconds.", 14))

func show_end(m: Dictionary, my_side: String, my_id: String) -> void:
	var v := _overlay("end", 0.6)
	var win: String = str(m.get("winner", ""))
	var won := win == my_side
	var t := Kit.title("VICTORY!" if won else ("DRAW" if win == "" else "DEFEAT"), 40)
	t.add_theme_color_override("font_color", Kit.GOOD if won else Kit.BAD if win != "" else Color.WHITE)
	v.add_child(t)
	var sc: Dictionary = m.get("score", {})
	v.add_child(Kit.label("Security %d  :  %d Outlaws" % [int(sc.get("sec", 0)), int(sc.get("out", 0))], 20, Color.WHITE, true))
	if m.get("mvp"):
		v.add_child(Kit.label("MVP: %s" % str(m.mvp), 18, Kit.GOLD, true))
	var roster: Array = m.get("roster", [])
	for r in roster.slice(0, 8):
		v.add_child(Kit.label("%s  %d kills · %d pts" % [r.name, int(r.kills), int(r.points)], 15, Color.WHITE if r.id == my_id else Kit.MUTED))
	v.add_child(Kit.para("Next battle dey start soon…", 15))
	var l := Kit.button("Leave to the war map")
	l.pressed.connect(func(): leave.emit())
	v.add_child(l)

func show_pause() -> void:
	var v := _overlay("pause", 0.6)
	v.add_child(Kit.title("PAUSED", 30))
	v.add_child(Kit.para("The battle no dey stop for others. Make it quick!", 15))
	var r := Kit.button("Back to the fight", true)
	r.pressed.connect(func():
		close_panel()
		resume.emit())
	v.add_child(r)
	var s := Kit.button("Settings")
	s.pressed.connect(func(): settings.emit())
	v.add_child(s)
	var qc := GridContainer.new()
	qc.columns = 3
	qc.add_theme_constant_override("h_separation", 6)
	qc.add_theme_constant_override("v_separation", 6)
	v.add_child(Kit.label("QUICK CHAT (TEAM)", 15, Kit.POD2, true))
	v.add_child(qc)
	for i in QUICK.size():
		var b := Kit.button(QUICK[i], false, 15)
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.pressed.connect(func():
			quick_chat.emit(i)
			close_panel()
			resume.emit())
		qc.add_child(b)
	var l := Kit.button("Leave battle")
	l.add_theme_color_override("font_color", Kit.BAD)
	l.pressed.connect(func(): leave.emit())
	v.add_child(l)
