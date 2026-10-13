extends Control
## Boot: a burning night skyline with searchlights and tracers, the POD title, loading the
## game rules from the server, a Pidgin tip, then "Enter".

signal done

const TIPS := [
	"Every advert wall get life gem. If you take am, nobody fit take am again till 2 minutes.",
	"If you fall, your person get 10 seconds to revive you. Shout am!",
	"As spirit, enemy no fit see you. Run go any gem wey dey shine.",
	"Bullet fit pass through mud, zinc and plank wall. Concrete no gree.",
	"Red drum wey write PMS na fuel. Shoot am near enemy and watch am burst.",
	"Army fit call artillery after 4 kills. Others na 5.",
	"Gold beam for map mean say new deposit don show. E carry double point.",
]
const RADIO := [
	"[RADIO] Alpha One, una don reach Kano? Over.",
	"[RADIO] Bandits dey move for the creek. Eyes open o!",
	"[RADIO] HQ, we need medevac for Sector B. Quick quick!",
	"[RADIO] Drone dey up. Enemy position don show for radar.",
	"[RADIO] All units: na Proof of Duty be this. Over and out.",
]

var t := 0.0
var skyline: Array = []
var tracers: Array = []
var flashes: Array = []
var status: Label
var enter: Button
var bar: ProgressBar
var radio: Label
var loaded := false
var title_box: VBoxContainer

func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	var rng := RandomNumberGenerator.new()
	rng.seed = 36
	var x := 0.0
	while x < 1.0:
		var w := rng.randf_range(0.02, 0.06)
		skyline.append([x, w, rng.randf_range(0.08, 0.32), rng.randi() % 4])
		x += w
	var m := Kit.safe_margin(24)
	add_child(m)
	var v := Kit.vbox(8)
	v.alignment = BoxContainer.ALIGNMENT_CENTER
	m.add_child(v)
	title_box = v
	var pres := Kit.label("TCEE PRESENTS", 18, Kit.POD2, true)
	pres.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(pres)
	var tt := Kit.title("PROOF OF DUTY", 64)
	tt.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	tt.add_theme_color_override("font_color", Color("#fff3e6"))
	v.add_child(tt)
	var tag := Kit.label("Shoot  •  Survive  •  Win", 20, Kit.MUTED)
	tag.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(tag)
	v.add_child(Kit.spacer(18))
	bar = ProgressBar.new()
	bar.custom_minimum_size = Vector2(420, 10)
	bar.show_percentage = false
	bar.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	bar.add_theme_stylebox_override("background", Kit.box(Color(1, 1, 1, 0.08), 5, Color(0, 0, 0, 0), 0, 0))
	bar.add_theme_stylebox_override("fill", Kit.box(Kit.POD, 5, Color(0, 0, 0, 0), 0, 0))
	v.add_child(bar)
	status = Kit.label("Loading the battlefield…", 17, Kit.MUTED)
	status.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(status)
	enter = Kit.button("ENTER", true, 24)
	enter.custom_minimum_size = Vector2(260, 60)
	enter.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	enter.visible = false
	enter.pressed.connect(func(): done.emit())
	v.add_child(enter)
	v.add_child(Kit.spacer(10))
	var tip := Kit.para("TIP: " + TIPS[randi() % TIPS.size()], 16, Kit.MUTED)
	tip.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	tip.custom_minimum_size = Vector2(600, 0)
	tip.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	v.add_child(tip)
	radio = Kit.label("", 14, Color(0.55, 0.95, 0.6, 0.8))
	radio.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(radio)
	var ver := Kit.label("V%s · build %d · Developed by Tcee" % [Cfg.VERSION, Cfg.build], 13, Kit.MUTED.darkened(0.3))
	ver.set_anchors_and_offsets_preset(Control.PRESET_BOTTOM_RIGHT)
	ver.position -= Vector2(12, 8)
	add_child(ver)
	Cfg.load_rules(_on_rules)

func _on_rules(ok: bool) -> void:
	if ok:
		loaded = true
		status.text = "Ready. %d states dey wait for you." % Cfg.rules.get("STATES", []).size()
		enter.visible = true
		Sfx.ui("alert")
	else:
		status.text = "We no fit reach the game server. Check your network. Trying again…"
		get_tree().create_timer(3.0).timeout.connect(func(): if is_inside_tree(): Cfg.load_rules(_on_rules))

func _process(delta: float) -> void:
	t += delta
	bar.value = move_toward(bar.value, 100.0, delta * 120.0) if loaded else min(90.0, bar.value + delta * 25.0)
	radio.text = RADIO[int(t / 3.2) % RADIO.size()]
	if randf() < delta * 3.0:
		tracers.append([randf(), randf_range(0.55, 0.8), randf_range(-0.6, 0.6), randf_range(0.2, 0.45), 0.0, Color(1, randf_range(0.6, 0.9), 0.3)])
	if randf() < delta * 0.7:
		flashes.append([randf(), randf_range(0.6, 0.75), 0.0])
	for tr in tracers:
		tr[4] += delta
	tracers = tracers.filter(func(a): return a[4] < 1.2)
	for f in flashes:
		f[2] += delta
	flashes = flashes.filter(func(a): return a[2] < 0.8)
	queue_redraw()

func _draw() -> void:
	var s := size
	# Night sky gradient.
	var top := Color("#0b0a12")
	var bot := Color("#3a1a0c")
	for i in 24:
		var a := float(i) / 24.0
		draw_rect(Rect2(0, s.y * a, s.x, s.y / 24.0 + 1), top.lerp(bot, a * a))
	# Searchlights sweeping.
	for k in 3:
		var bx := s.x * (0.2 + k * 0.3)
		var ang := sin(t * 0.4 + k * 2.1) * 0.5 - PI / 2
		var tip := Vector2(bx, s.y * 0.8) + Vector2(cos(ang), sin(ang)) * s.y * 1.2
		var side := Vector2(-sin(ang), cos(ang)) * 60.0
		draw_colored_polygon(PackedVector2Array([Vector2(bx, s.y * 0.8), tip + side, tip - side]), Color(1, 0.95, 0.8, 0.05))
	# Flashes on the horizon.
	for f in flashes:
		var a: float = 1.0 - f[2] / 0.8
		draw_circle(Vector2(f[0] * s.x, f[1] * s.y), 80.0 * (0.4 + f[2]), Color(1, 0.55, 0.2, 0.25 * a))
	# Tracers.
	for tr in tracers:
		var p0 := Vector2(tr[0] * s.x, tr[1] * s.y)
		var dir := Vector2(tr[2], -1).normalized()
		var head = p0 + dir * tr[4] * s.y * 0.9
		draw_line(head - dir * 30.0, head, tr[5], 2.0, true)
	# Skyline silhouettes with a few lit windows.
	for b in skyline:
		var h: float = b[2] * s.y
		var r := Rect2(b[0] * s.x, s.y - h, b[1] * s.x + 1, h)
		draw_rect(r, Color("#08070a"))
		if b[3] == 0:
			for wy in range(int(r.position.y) + 10, int(s.y) - 10, 18):
				if sin(wy * 7.1 + b[0] * 99.0) > 0.4:
					draw_rect(Rect2(r.position.x + r.size.x * 0.3, wy, 5, 7), Color(1, 0.75, 0.3, 0.6))
	# Smoke glow along the ground.
	draw_rect(Rect2(0, s.y * 0.88, s.x, s.y * 0.12), Color(0.9, 0.35, 0.1, 0.12))
