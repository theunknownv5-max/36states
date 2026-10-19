class_name Kit
extends RefCounted
## The look of every menu: colours, fonts, buttons and panels, matching the lite app.

const BG := Color("#060506")
const POD := Color("#ff7a1a")
const POD2 := Color("#ffb347")
const PANEL := Color(0.047, 0.063, 0.086, 0.9)
const PANEL2 := Color(0.086, 0.11, 0.149, 0.95)
const LINE := Color(1, 1, 1, 0.1)
const TEXT := Color("#eef2f6")
const MUTED := Color("#9aa6b4")
const SEC := Color("#4f9dff")
const OUT := Color("#ff5a4f")
const GOLD := Color("#ffb347")
const GEM := Color("#3fe0ff")
const GOOD := Color("#4fe08a")
const BAD := Color("#ff4f4f")

static var _theme: Theme
static var font_body: Font
static var font_bold: Font

static func fonts() -> void:
	if font_body:
		return
	# DejaVu fills in symbols Poppins lacks (₦, arrows, stars, ◆).
	var sym: FontFile = load("res://fonts/DejaVuSans-Bold.ttf")
	font_body = load("res://fonts/Poppins-Medium.ttf")
	font_bold = load("res://fonts/Poppins-Bold.ttf")
	font_body.fallbacks = [sym]
	font_bold.fallbacks = [sym]

static func box(bg: Color, radius := 10, border := Color(0, 0, 0, 0), bw := 0, pad := 10) -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = bg
	s.set_corner_radius_all(radius)
	if bw > 0:
		s.border_color = border
		s.set_border_width_all(bw)
	s.content_margin_left = pad + 4
	s.content_margin_right = pad + 4
	s.content_margin_top = pad
	s.content_margin_bottom = pad
	s.anti_aliasing = true
	return s

static func theme() -> Theme:
	if _theme:
		return _theme
	fonts()
	var t := Theme.new()
	t.default_font = font_body
	t.default_font_size = 20
	# Buttons
	t.set_stylebox("normal", "Button", box(Color(1, 1, 1, 0.06), 10, LINE, 1))
	t.set_stylebox("hover", "Button", box(Color(1, 1, 1, 0.1), 10, Color(1, 1, 1, 0.2), 1))
	t.set_stylebox("pressed", "Button", box(POD.darkened(0.35), 10, POD, 2))
	t.set_stylebox("disabled", "Button", box(Color(1, 1, 1, 0.03), 10, LINE, 1))
	t.set_stylebox("focus", "Button", StyleBoxEmpty.new())
	t.set_color("font_color", "Button", TEXT)
	t.set_color("font_hover_color", "Button", Color.WHITE)
	t.set_color("font_pressed_color", "Button", Color.WHITE)
	t.set_color("font_disabled_color", "Button", MUTED.darkened(0.3))
	t.set_font("font", "Button", font_bold)
	# Text boxes
	var le := box(Color(0, 0, 0, 0.45), 10, Color(1, 1, 1, 0.16), 1, 12)
	t.set_stylebox("normal", "LineEdit", le)
	var lef := box(Color(0, 0, 0, 0.55), 10, POD, 2, 12)
	t.set_stylebox("focus", "LineEdit", lef)
	t.set_color("font_color", "LineEdit", TEXT)
	t.set_color("font_placeholder_color", "LineEdit", MUTED.darkened(0.2))
	t.set_color("caret_color", "LineEdit", POD)
	t.set_stylebox("normal", "TextEdit", le)
	t.set_stylebox("focus", "TextEdit", lef)
	# Panels
	t.set_stylebox("panel", "PanelContainer", box(PANEL, 14, LINE, 1, 14))
	t.set_stylebox("panel", "Panel", box(PANEL, 14, LINE, 1))
	t.set_color("font_color", "Label", TEXT)
	# Scroll bars: slim, out of the way.
	var grab := StyleBoxFlat.new()
	grab.bg_color = Color(1, 1, 1, 0.25)
	grab.set_corner_radius_all(4)
	grab.content_margin_left = 3
	grab.content_margin_right = 3
	t.set_stylebox("grabber", "VScrollBar", grab)
	t.set_stylebox("grabber_highlight", "VScrollBar", grab)
	t.set_stylebox("grabber_pressed", "VScrollBar", grab)
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0, 0, 0, 0.0)
	sb.content_margin_left = 3
	sb.content_margin_right = 3
	t.set_stylebox("scroll", "VScrollBar", sb)
	# Check boxes and sliders
	t.set_color("font_color", "CheckButton", TEXT)
	t.set_color("font_color", "CheckBox", TEXT)
	t.set_stylebox("slider", "HSlider", box(Color(1, 1, 1, 0.15), 4, Color(0, 0, 0, 0), 0, 3))
	var fill := box(POD, 4, Color(0, 0, 0, 0), 0, 3)
	t.set_stylebox("grabber_area", "HSlider", fill)
	t.set_stylebox("grabber_area_highlight", "HSlider", fill)
	t.set_stylebox("panel", "PopupMenu", box(PANEL2, 10, LINE, 1))
	t.set_stylebox("normal", "OptionButton", box(Color(1, 1, 1, 0.06), 10, LINE, 1))
	_theme = t
	return t

static func label(text: String, size := 20, color := TEXT, bold := false) -> Label:
	fonts()
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	if bold:
		l.add_theme_font_override("font", font_bold)
	return l

static func para(text: String, size := 18, color := MUTED) -> Label:
	var l := label(text, size, color)
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return l

static func title(text: String, size := 44) -> Label:
	var l := label(text, size, Color.WHITE, true)
	l.add_theme_constant_override("outline_size", 6)
	l.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.6))
	return l

static func button(text: String, primary := false, size := 20) -> Button:
	var b := Button.new()
	b.text = text
	b.add_theme_font_size_override("font_size", size)
	b.custom_minimum_size = Vector2(0, 52)
	b.focus_mode = Control.FOCUS_NONE
	if primary:
		b.add_theme_stylebox_override("normal", box(POD, 10, POD2, 1))
		b.add_theme_stylebox_override("hover", box(POD.lightened(0.1), 10, POD2, 1))
		b.add_theme_stylebox_override("pressed", box(POD.darkened(0.2), 10, POD2, 2))
		b.add_theme_stylebox_override("disabled", box(POD.darkened(0.6), 10, Color(0, 0, 0, 0), 0))
		b.add_theme_color_override("font_color", Color("#1a0d02"))
		b.add_theme_color_override("font_hover_color", Color("#1a0d02"))
		b.add_theme_color_override("font_pressed_color", Color("#1a0d02"))
	b.pressed.connect(func(): Sfx.ui("click"))
	return b

static func chip(text: String, on := false) -> Button:
	var b := Button.new()
	b.text = text
	b.toggle_mode = true
	b.button_pressed = on
	b.focus_mode = Control.FOCUS_NONE
	b.custom_minimum_size = Vector2(0, 44)
	b.add_theme_font_size_override("font_size", 17)
	b.add_theme_stylebox_override("pressed", box(POD.darkened(0.55), 22, POD, 2, 8))
	b.add_theme_stylebox_override("normal", box(Color(1, 1, 1, 0.05), 22, LINE, 1, 8))
	b.add_theme_stylebox_override("hover", box(Color(1, 1, 1, 0.09), 22, LINE, 1, 8))
	b.pressed.connect(func(): Sfx.ui("click"))
	return b

static func input(placeholder: String, secret := false) -> LineEdit:
	var e := LineEdit.new()
	e.placeholder_text = placeholder
	e.secret = secret
	e.custom_minimum_size = Vector2(0, 54)
	e.add_theme_font_size_override("font_size", 20)
	e.virtual_keyboard_enabled = true
	return e

static func panel(pad := 16) -> PanelContainer:
	var p := PanelContainer.new()
	p.add_theme_stylebox_override("panel", box(PANEL, 14, LINE, 1, pad))
	return p

static func vbox(sep := 10) -> VBoxContainer:
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", sep)
	return v

static func hbox(sep := 10) -> HBoxContainer:
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", sep)
	return h

static func spacer(h := 0.0, w := 0.0) -> Control:
	var c := Control.new()
	c.custom_minimum_size = Vector2(w, h)
	return c

static func grow(c: Control) -> Control:
	c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return c

static func fill(c: Control) -> Control:
	c.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	return c

static func bg_rect(col := BG) -> ColorRect:
	var r := ColorRect.new()
	r.color = col
	r.mouse_filter = Control.MOUSE_FILTER_IGNORE
	fill(r)
	return r

## A scroll area that never traps the player: content scrolls with a finger drag.
static func scroller() -> ScrollContainer:
	var s := ScrollContainer.new()
	s.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	s.follow_focus = true
	s.size_flags_vertical = Control.SIZE_EXPAND_FILL
	s.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	return s

## Safe-area margins (notches, rounded corners) plus a gutter.
static func safe_margin(gutter := 16) -> MarginContainer:
	var m := MarginContainer.new()
	fill(m)
	var safe := DisplayServer.get_display_safe_area()
	var win := DisplayServer.window_get_size()
	var vp := Vector2(1280, 720)
	var sx := 1.0
	if win.x > 0:
		sx = vp.x / float(win.x)
	var l := gutter
	var r := gutter
	var t := gutter
	var b := gutter
	if win.x > 0 and safe.size.x > 0:
		l += int(safe.position.x * sx)
		r += int((win.x - safe.end.x) * sx)
		t += int(safe.position.y * sx)
		b += int((win.y - safe.end.y) * sx)
	m.add_theme_constant_override("margin_left", l)
	m.add_theme_constant_override("margin_right", r)
	m.add_theme_constant_override("margin_top", t)
	m.add_theme_constant_override("margin_bottom", b)
	return m

static func side_color(side: String) -> Color:
	return SEC if side == "sec" else OUT

# Battle cash: naira in Nigeria, dollars everywhere else (Kit.cash_cc is set when a battle starts).
static var cash_cc := "NG"
static func cash_sign() -> String:
	return "₦" if cash_cc == "NG" else "$"

static func naira(n) -> String:
	var s := str(int(n))
	var out := ""
	var c := 0
	for i in range(s.length() - 1, -1, -1):
		out = s[i] + out
		c += 1
		if c % 3 == 0 and i > 0 and s[i - 1] != "-":
			out = "," + out
	return cash_sign() + out
