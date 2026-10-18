extends Control
## "Report for duty": play as a guest with just a name, or log in / create an account so your
## rank, gems and crew follow you to any phone. The whole page scrolls, so the keyboard never
## hides the button.

var error := ""
var mode := "guest"   # guest / login / register
var tabs: Dictionary = {}
var name_in: LineEdit
var user_in: LineEdit
var pass_in: LineEdit
var guest_box: VBoxContainer
var acc_box: VBoxContainer
var err_label: Label
var go: Button
var scroll: ScrollContainer

func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(Kit.bg_rect(Color("#0a0809")))
	var m := Kit.safe_margin(16)
	add_child(m)
	scroll = Kit.scroller()
	m.add_child(scroll)
	var center := CenterContainer.new()
	center.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	center.size_flags_vertical = Control.SIZE_EXPAND_FILL
	scroll.add_child(center)
	var card := Kit.panel(22)
	card.custom_minimum_size = Vector2(min(560.0, get_viewport_rect().size.x - 40.0), 0)
	center.add_child(card)
	var v := Kit.vbox(12)
	card.add_child(v)
	var t := Kit.title("REPORT FOR DUTY", 34)
	t.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(t)
	var sub := Kit.para("Choose how you go play. Guests fit start sharp sharp; an account keeps your rank on any phone.", 16)
	sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(sub)
	var row := Kit.hbox(8)
	v.add_child(row)
	for k in [["guest", "Guest"], ["login", "Log in"], ["register", "New account"]]:
		var c := Kit.chip(k[1], k[0] == mode)
		c.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		c.pressed.connect(_set_mode.bind(k[0]))
		row.add_child(c)
		tabs[k[0]] = c
	guest_box = Kit.vbox(8)
	v.add_child(guest_box)
	guest_box.add_child(Kit.label("Your soldier name", 16, Kit.MUTED))
	name_in = Kit.input("e.g. Ada, Tunde, Musa")
	name_in.max_length = 18
	name_in.text = str(Cfg.get_s("name", ""))
	name_in.text_submitted.connect(func(_t): _submit())
	guest_box.add_child(name_in)
	acc_box = Kit.vbox(8)
	v.add_child(acc_box)
	acc_box.add_child(Kit.label("Username", 16, Kit.MUTED))
	user_in = Kit.input("3-16 letters, numbers or _")
	user_in.max_length = 16
	user_in.text = str(Cfg.get_s("username", ""))
	acc_box.add_child(user_in)
	acc_box.add_child(Kit.label("Password", 16, Kit.MUTED))
	pass_in = Kit.input("At least 6 characters", true)
	pass_in.text_submitted.connect(func(_t): _submit())
	acc_box.add_child(pass_in)
	err_label = Kit.para(error, 16, Kit.BAD)
	err_label.visible = error != ""
	v.add_child(err_label)
	go = Kit.button("REPORT FOR DUTY", true, 22)
	go.custom_minimum_size = Vector2(0, 60)
	go.pressed.connect(_submit)
	v.add_child(go)
	var foot := Kit.para("Same account works for the lite app and this one.", 14, Kit.MUTED.darkened(0.2))
	foot.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(foot)
	# Keep the field you are typing in visible above the keyboard.
	for e in [name_in, user_in, pass_in]:
		e.focus_entered.connect(func(): scroll.ensure_control_visible.call_deferred(e))
	if Cfg.get_s("username", "") != "" and Cfg.get_s("token", "") == "":
		_set_mode("login")
	else:
		_set_mode("guest")

func _set_mode(m: String) -> void:
	mode = m
	for k in tabs:
		tabs[k].set_pressed_no_signal(k == m)
	guest_box.visible = m == "guest"
	acc_box.visible = m != "guest"
	go.text = {"guest": "REPORT FOR DUTY", "login": "LOG IN", "register": "CREATE ACCOUNT"}[m]

func _submit() -> void:
	err_label.visible = false
	var hello := {}
	if mode == "guest":
		var n := name_in.text.strip_edges()
		if n.length() < 2:
			_err("Write your soldier name first (at least 2 letters).")
			return
		Cfg.set_s("name", n)
		hello = {"name": n}
		var tok: String = Cfg.get_s("token", "")
		if tok != "":
			hello["token"] = tok
	else:
		var u := user_in.text.strip_edges()
		if not RegEx.create_from_string("^[a-zA-Z0-9_]{3,16}$").search(u):
			_err("Username: 3-16 letters, numbers or _ only")
			return
		if pass_in.text.length() < 6:
			_err("Password suppose reach at least 6 characters")
			return
		Cfg.set_s("username", u)
		hello = {"mode": mode, "username": u, "password": pass_in.text}
	go.disabled = true
	go.text = "CONNECTING…"
	DisplayServer.virtual_keyboard_hide()
	Net.connect_server(hello, func(ok):
		if not is_inside_tree():
			return
		go.disabled = false
		_set_mode(mode)
		if not ok:
			_err("We no fit reach the game server. Check your network and try again."))

func _err(t: String) -> void:
	err_label.text = t
	err_label.visible = true
	Sfx.ui("alert")

func on_back() -> void:
	ExitDialog.ask(self)
