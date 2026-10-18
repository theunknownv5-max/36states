extends Control
## Settings (from the lobby or the pause menu): sound, music, look speed, field of view,
## graphics quality, aim assist, fire button side, and reset to defaults.

signal closed

var rows: VBoxContainer

func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(Kit.bg_rect(Color(0, 0, 0, 0.7)))
	var m := Kit.safe_margin(20)
	add_child(m)
	var center := CenterContainer.new()
	m.add_child(center)
	var card := Kit.panel(18)
	card.custom_minimum_size = Vector2(min(620.0, get_viewport_rect().size.x - 40.0), min(600.0, get_viewport_rect().size.y - 40.0))
	center.add_child(card)
	var v := Kit.vbox(10)
	card.add_child(v)
	var top := Kit.hbox()
	v.add_child(top)
	top.add_child(Kit.grow(Kit.title("SETTINGS", 28)))
	var x := Kit.button("✕  Close")
	x.pressed.connect(_close)
	top.add_child(x)
	var sc := Kit.scroller()
	v.add_child(sc)
	rows = Kit.vbox(14)
	rows.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	sc.add_child(rows)
	_build()

func _build() -> void:
	for c in rows.get_children():
		c.queue_free()
	_slider("Sound volume", "volume", 0.0, 1.0, func(_v): Sfx.apply_volumes())
	_slider("Music volume", "music", 0.0, 1.0, func(_v): Sfx.apply_volumes())
	_slider("Look speed", "sens", 0.3, 2.5, Callable())
	_slider("Field of view", "fov", 60.0, 95.0, Callable())
	var q := Kit.hbox(8)
	q.add_child(Kit.grow(Kit.label("Graphics", 19)))
	for k in [["low", "Smooth"], ["medium", "Balanced"], ["high", "Sharp"]]:
		var c := Kit.chip(k[1], Cfg.get_s("quality") == k[0])
		c.pressed.connect(func():
			Cfg.set_s("quality", k[0])
			_build())
		q.add_child(c)
	rows.add_child(q)
	var sch := Kit.vbox(6)
	sch.add_child(Kit.label("Touch controls", 19))
	var row := Kit.hbox(8)
	for k in [["classic", "Classic"], ["tap", "Tap to shoot"], ["swipe", "Swipe to move"]]:
		var c := Kit.chip(k[1], str(Cfg.get_s("scheme", "classic")) == k[0])
		c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		c.pressed.connect(func():
			Cfg.set_s("scheme", k[0])
			_build())
		row.add_child(c)
	sch.add_child(row)
	var why := {"classic": "Stick on the left, drag the right side to look, fire button.", "tap": "Tap anywhere on the right side to shoot; drag to look.", "swipe": "One finger anywhere moves you; twist two fingers to turn; tap to shoot."}
	sch.add_child(Kit.para(why.get(str(Cfg.get_s("scheme", "classic")), ""), 15, Kit.MUTED))
	rows.add_child(sch)
	_toggle("Aim assist (touch)", "aim_assist")
	_toggle("Fire button on the left", "left_hand_fire")
	_toggle("Fight with bots", "bots")
	var reset := Kit.button("↻  Reset all settings to default")
	reset.pressed.connect(func():
		Cfg.reset_settings()
		Sfx.apply_volumes()
		_build())
	rows.add_child(reset)

func _slider(text: String, key: String, lo: float, hi: float, on_change: Callable) -> void:
	var h := Kit.hbox(12)
	var l := Kit.label(text, 19)
	l.custom_minimum_size = Vector2(190, 0)
	h.add_child(l)
	var s := HSlider.new()
	s.min_value = lo
	s.max_value = hi
	s.step = (hi - lo) / 100.0
	s.value = float(Cfg.get_s(key))
	s.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	s.custom_minimum_size = Vector2(0, 40)
	var val := Kit.label("", 17, Kit.MUTED)
	val.custom_minimum_size = Vector2(56, 0)
	var show := func(v):
		val.text = str(int(v)) if hi > 10 else "%d%%" % int((v - lo) / (hi - lo) * 100) if key != "sens" else "%.1fx" % v
	show.call(s.value)
	s.value_changed.connect(func(v):
		Cfg.settings[key] = v
		show.call(v)
		if on_change.is_valid():
			on_change.call(v))
	s.drag_ended.connect(func(_c): Cfg.save())
	h.add_child(s)
	h.add_child(val)
	rows.add_child(h)

func _toggle(text: String, key: String) -> void:
	var c := CheckButton.new()
	c.text = text
	c.button_pressed = bool(Cfg.get_s(key))
	c.add_theme_font_size_override("font_size", 19)
	c.focus_mode = Control.FOCUS_NONE
	c.toggled.connect(func(on): Cfg.set_s(key, on))
	rows.add_child(c)

func _close() -> void:
	Cfg.save()
	closed.emit()
	queue_free()

func on_back() -> void:
	_close()
