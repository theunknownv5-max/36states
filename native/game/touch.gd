class_name Touch
extends Control
## Phone controls. Left thumb: a floating joystick (push to the edge to sprint). Right thumb:
## drag anywhere to look; the fire button also aims while you hold it. Buttons for aim, jump,
## crouch, reload, weapon swap, grenade, pill, use, armoury, scores and pause.
## Every finger is tracked on its own, so you can run, look and shoot at the same time.

var move := Vector2.ZERO
var look := Vector2.ZERO
var fire := false
var ads := false
var crouch := false
var sprint := false
var use_held := false
var pressed := {}         # one-shot taps: name -> true
var fingers := {}         # index -> {role, start, pos}
var stick_center := Vector2.ZERO
var stick_pos := Vector2.ZERO
var stick_on := false
var buttons: Array = []   # {name, label, pos (0..1 of screen from bottom-right), r, toggle}
var show_buy := false
var show_use := false
var use_label := "USE"
var enabled := true
var left_fire := false
var scheme := "classic"     # classic | tap | swipe
var starts := {}            # finger index -> {pos, t, moved}
var tap_until := 0
var twist_prev = null

const STICK_R := 70.0

func _ready() -> void:
	Kit.fill(self)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	left_fire = bool(Cfg.get_s("left_hand_fire", false))
	scheme = str(Cfg.get_s("scheme", "classic"))
	_layout()

func _layout() -> void:
	# Positions in pixels from the bottom-right corner (x left, y up) at 1280×720.
	buttons = [
		{"name": "fire", "label": "FIRE", "off": Vector2(150, 150), "r": 62.0},
		{"name": "ads", "label": "AIM", "off": Vector2(60, 280), "r": 38.0},
		{"name": "jump", "label": "JUMP", "off": Vector2(60, 70), "r": 38.0},
		{"name": "crouch", "label": "DUCK", "off": Vector2(260, 60), "r": 36.0},
		{"name": "reload", "label": "R", "off": Vector2(270, 175), "r": 32.0},
		{"name": "swap", "label": "⇄", "off": Vector2(170, 290), "r": 32.0},
		{"name": "nade", "label": "NADE", "off": Vector2(280, 290), "r": 30.0},
		{"name": "pill", "label": "PILL", "off": Vector2(370, 60), "r": 30.0},
		{"name": "use", "label": "USE", "off": Vector2(370, 175), "r": 34.0},
		{"name": "buy", "label": "BUY", "off": Vector2(-1, -1), "r": 30.0},
		{"name": "pause", "label": "MENU", "off": Vector2(-2, -2), "r": 30.0},
		{"name": "scores", "label": "≡", "off": Vector2(-3, -3), "r": 26.0},
	]

func _btn_pos(b: Dictionary) -> Vector2:
	var s := size
	var off: Vector2 = b.off
	# Small buttons in a row at the top right: armoury, scores, pause.
	if off == Vector2(-1, -1):
		return Vector2(s.x - 176, 42)
	if off == Vector2(-2, -2):
		return Vector2(s.x - 44, 42)
	if off == Vector2(-3, -3):
		return Vector2(s.x - 110, 42)
	var p := Vector2(s.x - off.x, s.y - off.y)
	if left_fire and b.name == "fire":
		p = Vector2(off.x + 120, s.y - off.y - 120)
	return p

func _visible_btn(b: Dictionary) -> bool:
	match b.name:
		"buy":
			return show_buy
		"use":
			return show_use
	return true

func take_look() -> Vector2:
	var l := look
	look = Vector2.ZERO
	return l

func tapped(name: String) -> bool:
	if pressed.has(name):
		pressed.erase(name)
		return true
	return false

func reset() -> void:
	if fingers.is_empty() and not stick_on and not fire:
		return
	fingers.clear()
	stick_on = false
	move = Vector2.ZERO
	fire = false
	use_held = false
	sprint = false

func _input(e: InputEvent) -> void:
	if not enabled or not is_visible_in_tree():
		return
	if e is InputEventScreenTouch:
		if e.pressed:
			_press(e.index, e.position)
		else:
			_release(e.index)
	elif e is InputEventScreenDrag:
		_drag(e.index, e.position, e.relative)

func _press(i: int, p: Vector2) -> void:
	for b in buttons:
		if not _visible_btn(b):
			continue
		if p.distance_to(_btn_pos(b)) <= b.r * 1.25:
			fingers[i] = {"role": b.name, "pos": p}
			match b.name:
				"fire":
					fire = true
				"ads":
					ads = not ads
				"crouch":
					crouch = not crouch
				"use":
					use_held = true
					pressed["use"] = true
				_:
					pressed[b.name] = true
			if b.name != "fire":
				Input.vibrate_handheld(12)
			get_viewport().set_input_as_handled()
			return
	starts[i] = {"pos": p, "t": Time.get_ticks_msec(), "moved": 0.0}
	if scheme == "swipe":
		# One finger anywhere is a floating stick; a second finger turns it into a two-finger twist.
		var sticks := fingers.values().filter(func(f): return f.role == "stick")
		if sticks.is_empty() and not fingers.values().any(func(f): return f.role == "twist"):
			fingers[i] = {"role": "stick", "pos": p}
			stick_center = p
			stick_pos = p
			stick_on = true
			move = Vector2.ZERO
		else:
			for k in fingers:
				if fingers[k].role == "stick":
					fingers[k].role = "twist"
			fingers[i] = {"role": "twist", "pos": p}
			stick_on = false
			move = Vector2.ZERO
			sprint = false
			twist_prev = _twist()
		get_viewport().set_input_as_handled()
		return
	if p.x < size.x * 0.42:
		fingers[i] = {"role": "stick", "pos": p}
		stick_center = p
		stick_pos = p
		stick_on = true
		move = Vector2.ZERO
	else:
		fingers[i] = {"role": "look", "pos": p}
	get_viewport().set_input_as_handled()

# The angle and height of the line between the two twisting fingers.
func _twist():
	var pts: Array = []
	for f in fingers.values():
		if f.role == "twist":
			pts.append(f.pos)
	if pts.size() < 2:
		return null
	return {"ang": (pts[1] - pts[0]).angle(), "my": (pts[0].y + pts[1].y) / 2.0}

func _drag(i: int, p: Vector2, rel: Vector2) -> void:
	var f = fingers.get(i)
	if f == null:
		return
	f.pos = p
	if starts.has(i):
		starts[i].moved = max(float(starts[i].moved), p.distance_to(starts[i].pos))
	match f.role:
		"stick":
			var d := p - stick_center
			if d.length() > STICK_R:
				# Drag the joystick base along so it never gets "stuck".
				stick_center = p - d.normalized() * STICK_R
				d = p - stick_center
			stick_pos = p
			move = Vector2(d.x / STICK_R, -d.y / STICK_R)
			sprint = move.y > 0.92 and absf(move.x) < 0.5
		"look", "fire":
			look += rel
		"twist":
			var now = _twist()
			if now != null and twist_prev != null:
				look.x += wrapf(now.ang - twist_prev.ang, -PI, PI) * 420.0
				look.y += now.my - twist_prev.my
			twist_prev = now
	get_viewport().set_input_as_handled()

func _release(i: int) -> void:
	var f = fingers.get(i)
	var s = starts.get(i)
	starts.erase(i)
	# A quick tap fires (tap and swipe schemes).
	if s != null and f != null and scheme != "classic" and f.role in ["look", "stick", "twist"] and float(s.moved) < 14.0 and Time.get_ticks_msec() - int(s.t) < 260:
		fire = true
		tap_until = Time.get_ticks_msec() + 110
	if f == null:
		return
	match f.role:
		"stick":
			stick_on = false
			move = Vector2.ZERO
			sprint = false
		"fire":
			fire = false
		"use":
			use_held = false
	fingers.erase(i)

func _process(_d: float) -> void:
	if tap_until and Time.get_ticks_msec() >= tap_until:
		tap_until = 0
		if not fingers.values().any(func(x): return x.role == "fire"):
			fire = false
	if scheme == "swipe" and fingers.values().filter(func(x): return x.role == "twist").size() < 2:
		twist_prev = null
	queue_redraw()

func _draw() -> void:
	if not enabled:
		return
	var font := Kit.font_bold
	# Joystick.
	if stick_on:
		draw_circle(stick_center, STICK_R, Color(1, 1, 1, 0.08))
		draw_arc(stick_center, STICK_R, 0, TAU, 40, Color(1, 1, 1, 0.3), 2.0)
		var knob := stick_center + (stick_pos - stick_center).limit_length(STICK_R)
		draw_circle(knob, 30, Color(1, 1, 1, 0.35 if not sprint else 0.6))
		if sprint:
			draw_string(font, stick_center + Vector2(-30, -STICK_R - 10), "SPRINT", HORIZONTAL_ALIGNMENT_LEFT, -1, 16, Kit.POD2)
	else:
		var hint := Vector2(150, size.y - 150)
		draw_arc(hint, STICK_R, 0, TAU, 40, Color(1, 1, 1, 0.12), 2.0)
	for b in buttons:
		if not _visible_btn(b):
			continue
		var p := _btn_pos(b)
		var on := false
		for f in fingers.values():
			if f.role == b.name:
				on = true
		if b.name == "ads" and ads or b.name == "crouch" and crouch:
			on = true
		var base := Color(1, 1, 1, 0.12)
		if b.name == "fire":
			base = Color(1, 0.35, 0.2, 0.28)
		if b.name == "buy":
			base = Color(1, 0.6, 0.1, 0.35)
		if b.name == "use":
			base = Color(0.2, 0.9, 0.5, 0.3)
		if on:
			base = Color(base.r, base.g, base.b, min(0.75, base.a + 0.35))
		draw_circle(p, b.r, base)
		draw_arc(p, b.r, 0, TAU, 32, Color(1, 1, 1, 0.35), 2.0)
		var lbl: String = use_label if b.name == "use" else b.label
		var fs := 15 if lbl.length() > 2 else 22
		var w := font.get_string_size(lbl, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
		draw_string(font, p + Vector2(-w / 2.0, fs * 0.35), lbl, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color(1, 1, 1, 0.9))
