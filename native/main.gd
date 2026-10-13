extends Node
## Screen router: boot, sign-in, the war map (lobby), then a battle.

const Boot = preload("res://ui/boot.gd")
const SignIn = preload("res://ui/signin.gd")
const Lobby = preload("res://ui/lobby.gd")
const Battle = preload("res://game/battle.gd")

var ui_layer: CanvasLayer
var screen: Node = null
var battle: Node = null
var welcome := {}
var profile := {}
var lobby_states: Array = []
var online := 0
var last_join := {}
var in_battle := false
var last_spawn := {}
var last_me := {}

func _ready() -> void:
	get_tree().root.theme = Kit.theme()
	RenderingServer.set_default_clear_color(Kit.BG)
	ui_layer = CanvasLayer.new()
	ui_layer.layer = 10
	add_child(ui_layer)
	Net.on("welcome", _on_welcome)
	Net.on("lobby", _on_lobby)
	Net.on("authError", _on_auth_error)
	Net.on("matchInfo", _on_match_info)
	Net.on("joinError", _on_join_error)
	# These can arrive just before the battle starts: keep the latest for it.
	Net.on("spawn", func(m): last_spawn = m)
	Net.on("me", func(m): last_me = m)
	Net.status.connect(_on_net_status)
	get_tree().set_auto_accept_quit(false)
	show_boot()
	# Self-test driver (development only; not in the exported app).
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--autotest") and ResourceLoader.exists("res://test/autotest.gd"):
			var at: Node = load("res://test/autotest.gd").new()
			at.set("main", self)
			add_child(at)

func _notification(what: int) -> void:
	# Android back button: leave the battle (pause menu) or go back a screen.
	if what == NOTIFICATION_WM_GO_BACK_REQUEST or what == NOTIFICATION_WM_CLOSE_REQUEST:
		if battle and battle.has_method("on_back"):
			battle.on_back()
		elif screen and screen.has_method("on_back"):
			screen.on_back()
		elif what == NOTIFICATION_WM_CLOSE_REQUEST:
			get_tree().quit()
	elif what == NOTIFICATION_APPLICATION_PAUSED:
		Sfx.duck = 0.0
	elif what == NOTIFICATION_APPLICATION_RESUMED:
		Sfx.duck = 1.0

func _set_screen(node: Control) -> void:
	if screen:
		screen.queue_free()
	screen = node
	if node:
		ui_layer.add_child(node)

func show_boot() -> void:
	Sfx.music("menu")
	var b := Boot.new()
	b.done.connect(show_signin)
	_set_screen(b)

func show_signin(error := "") -> void:
	var s := SignIn.new()
	s.error = error
	_set_screen(s)

func show_lobby() -> void:
	in_battle = false
	Sfx.music("menu")
	var l := Lobby.new()
	l.main = self
	_set_screen(l)

func _on_welcome(m: Dictionary) -> void:
	welcome = m
	profile = m.get("profile", {})
	lobby_states = m.get("lobby", [])
	online = int(m.get("online", 0))
	if not m.get("account", false):
		Cfg.set_s("token", str(m.get("token", "")))
	if in_battle:
		# Reconnected in the middle of a battle: go back in.
		if not last_join.is_empty():
			Net.send(last_join)
		return
	show_lobby()

func _on_lobby(m: Dictionary) -> void:
	lobby_states = m.get("states", lobby_states)
	profile = m.get("profile", profile)
	online = int(m.get("online", online))
	if screen and screen.has_method("refresh"):
		screen.refresh()

func _on_auth_error(m: Dictionary) -> void:
	show_signin(str(m.get("error", "Sign-in failed")))

func _on_net_status(on: bool) -> void:
	if screen and screen.has_method("net_status"):
		screen.net_status(on)
	if battle and battle.has_method("net_status"):
		battle.net_status(on)

## Deploy: ask the server for a seat in a battle.
func join(state: String, faction: String, mode: String) -> void:
	last_join = {"t": "join", "state": state, "faction": faction, "mode": mode, "bots": Cfg.get_s("bots", true)}
	Cfg.set_s("faction", faction)
	Net.send(last_join)

func _on_join_error(m: Dictionary) -> void:
	if screen and screen.has_method("join_error"):
		screen.join_error(str(m.get("error", "")))
	elif battle:
		leave_battle()

func _on_match_info(m: Dictionary) -> void:
	# A new round in the battle we are already in: the battle handles it.
	if battle:
		battle.on_match_info(m)
		return
	in_battle = true
	if screen:
		screen.queue_free()
		screen = null
	battle = Battle.new()
	battle.main = self
	add_child(battle)
	battle.begin(m)

func leave_battle() -> void:
	Net.send({"t": "leave"})
	last_join = {}
	if battle:
		battle.shutdown()
		battle.queue_free()
		battle = null
	Sfx.stop_loops()
	show_lobby()
