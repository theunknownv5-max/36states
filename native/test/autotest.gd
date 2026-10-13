extends Node
## Plays the game by itself for testing (run with -- --autotest[=state] --shots=DIR):
## boot → guest sign-in → lobby → deploy → move, look, shoot, buy, open menus; screenshots
## along the way; prints what happened; quits. Not part of the app (excluded from export).

var main: Node
var shots := ""
var state := "lagos"
var mode := "conquest"
var log_lines: Array = []
var t0 := 0.0

func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--shots="):
			shots = a.substr(8)
		if a.begins_with("--autotest="):
			state = a.substr(11)
		if a.begins_with("--mode="):
			mode = a.substr(7)
	t0 = Time.get_ticks_msec()
	_run.call_deferred()

func say(s: String) -> void:
	var line := "[%5.1fs] %s" % [(Time.get_ticks_msec() - t0) / 1000.0, s]
	print(line)
	log_lines.append(line)

func wait(secs: float) -> void:
	await get_tree().create_timer(secs).timeout

func shot(name: String) -> void:
	if shots == "":
		return
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	if img:
		img.save_png("%s/%s.png" % [shots, name])
		say("screenshot " + name)

func find(cls: String) -> Node:
	for n in get_tree().root.find_children("*", "", true, false):
		var sc = n.get_script()
		if sc and str(sc.resource_path).ends_with(cls):
			return n
	return null

func _run() -> void:
	await wait(0.5)
	var boot := find("ui/boot.gd")
	for i in 60:
		if boot and boot.loaded:
			break
		await wait(0.25)
	say("rules loaded: %s, %d states" % [str(boot != null and boot.loaded), Cfg.rules.get("STATES", []).size()])
	await shot("01-boot")
	boot.done.emit()
	await wait(0.4)
	var si := find("ui/signin.gd")
	si.name_in.text = "NativeTest"
	await shot("02-signin")
	si._submit()
	for i in 40:
		if find("ui/lobby.gd"):
			break
		await wait(0.25)
	var lobby := find("ui/lobby.gd")
	say("lobby: %s online=%d" % [str(lobby != null), main.online])
	lobby.map.selected = state
	lobby._set_mode(mode)
	lobby._render_info()
	await wait(0.6)
	await shot("03-lobby")
	lobby._deploy()
	var battle = null
	for i in 80:
		battle = main.battle
		if battle and battle.ready_world:
			break
		await wait(0.25)
	if battle == null or not battle.ready_world:
		say("FAIL: battle did not start")
		get_tree().quit(1)
		return
	say("battle: state=%s side=%s me=%s status=%s at (%.1f, %.1f, %.1f)" % [battle.state_id, battle.side, battle.my_id, battle.status, battle.body.x, battle.body.y, battle.body.z])
	await wait(2.0)
	say("soldiers seen: %d, vehicles: %d, boards: %d" % [battle.soldiers.size(), battle.vehicles.list.size(), battle.boards.size()])
	await shot("04-spawn")
	# Walk forward for 3 s.
	var start := Vector3(battle.body.x, battle.body.y, battle.body.z)
	battle.touch.move = Vector2(0, 1)
	await wait(3.0)
	battle.touch.move = Vector2.ZERO
	var moved := Vector3(battle.body.x, battle.body.y, battle.body.z).distance_to(start)
	say("walked %.1f m" % moved)
	# Turn around and look.
	battle.yaw += PI * 0.5
	await wait(0.5)
	await shot("05-look")
	# Shoot a few rounds.
	var mag_before := int(battle.ammo.get("mag", 0))
	battle.touch.fire = true
	await wait(1.2)
	battle.touch.fire = false
	await wait(0.6)
	say("fired: mag %d -> %d (server mag %d)" % [mag_before, int(battle.ammo.get("mag", 0)), int(battle.me.get("ammo", {}).get(battle._weapon(), {}).get("mag", -1))])
	# Buy a rifle.
	battle.touch.pressed["buy"] = true
	await wait(0.5)
	await shot("06-buy")
	battle.hud.buy.emit("ak47")
	await wait(1.0)
	battle.hud.close_panel()
	say("weapon after buying: %s, money %s" % [battle._weapon(), str(battle.me.get("money"))])
	battle.touch.ads = true
	await wait(0.6)
	await shot("07-ads")
	battle.touch.ads = false
	battle.touch.fire = true
	await wait(1.5)
	battle.touch.fire = false
	await wait(0.5)
	await shot("08-firefight")
	# Scoreboard and pause menu.
	battle.touch.pressed["scores"] = true
	await wait(0.4)
	await shot("09-scores")
	battle.hud.close_panel()
	battle.on_back()
	await wait(0.4)
	await shot("10-pause")
	battle.hud.close_panel()
	battle.paused = false
	# Look around the battlefield from above.
	battle.pitch = -0.35
	for k in 4:
		battle.yaw += PI / 2.0
		await wait(0.4)
		await shot("11-view%d" % k)
	# Get into the nearest car, drive it, get out.
	var car = null
	var cd := 1e9
	for v in battle.vehicles.list:
		var d: float = Vector2(v.x - battle.body.x, v.z - battle.body.z).length()
		if v.state < 2 and d < cd:
			cd = d
			car = v
	if car:
		var dd: Dictionary = battle.vehicles.def(car.type)
		var side_x: float = cos(car.yaw) * (float(dd.W) / 2.0 + 0.8)
		var side_z: float = -sin(car.yaw) * (float(dd.W) / 2.0 + 0.8)
		# Walk there (the server won't accept a teleport).
		for i in 120:
			var to := Vector2(car.x + side_x - battle.body.x, car.z + side_z - battle.body.z)
			if to.length() < 0.8:
				break
			battle.yaw = atan2(-to.x, -to.y)
			battle.touch.move = Vector2(0, 1)
			await wait(0.25)
		battle.touch.move = Vector2.ZERO
		await wait(0.6)
		say("walked to the %s: %.1f m away" % [car.type, Vector2(car.x - battle.body.x, car.z - battle.body.z).length()])
		battle.touch.pressed["use"] = true
		await wait(1.2)
		say("enter %s: driving=%s me.veh=%s" % [car.type, str(battle.driving != null), str(battle.me.get("veh"))])
		if battle.driving != null:
			var x0: float = car.x
			var z0: float = car.z
			battle.touch.move = Vector2(0, 1)
			await wait(2.5)
			battle.touch.move = Vector2.ZERO
			await wait(0.5)
			await shot("12b-driving")
			say("drove %.1f m (speed %.1f)" % [Vector2(car.x - x0, car.z - z0).length(), car.speed])
			battle.touch.pressed["use"] = true
			await wait(1.2)
			say("exit: driving=%s at (%.1f, %.1f)" % [str(battle.driving != null), battle.body.x, battle.body.z])
	# Walk up to the nearest other soldier and look at them.
	var best = null
	var bd := 1e9
	for so in battle.soldiers.values():
		var d: float = so.position.distance_to(Vector3(battle.body.x, battle.body.y, battle.body.z))
		if so.visible and d < bd:
			bd = d
			best = so
	if best:
		var p: Vector3 = best.position
		var away := (Vector3(battle.body.x, 0, battle.body.z) - Vector3(p.x, 0, p.z)).normalized()
		battle.body.x = p.x + away.x * 4.0
		battle.body.z = p.z + away.z * 4.0
		battle.body.y = p.y
		battle.yaw = atan2(away.x, away.z)
		battle.pitch = -0.1
		await wait(0.6)
		say("looking at %s (%s) from 4 m" % [best.pname, best.faction])
		await shot("12-soldier")
	if mode != "practice":
		# Run at the enemy until something happens, then come back with a life gem.
		battle.yaw = -PI / 2.0 if battle.side == "sec" else PI / 2.0
		battle.pitch = 0.0
		battle.touch.move = Vector2(0, 1)
		var died := false
		for i in 240:
			await wait(0.5)
			if i % 4 == 0:
				battle.touch.fire = not battle.touch.fire
			if battle.status != "alive":
				died = true
				break
		battle.touch.move = Vector2.ZERO
		battle.touch.fire = false
		say("after the push: status=%s health=%s kills=%s deaths=%s panel=%s" % [battle.status, str(battle.me.get("health")), str(battle.me.get("kills")), str(battle.me.get("deaths")), battle.hud.panel_kind])
		if died:
			for i in 30:
				if battle.status == "dead":
					break
				await wait(0.5)
			await shot("13-dead")
			battle.hud.respawn.emit("gem")
			await wait(1.5)
			say("after life gem: status=%s gems=%s" % [battle.status, str(battle.me.get("gems"))])
	say("final: status=%s health=%s kills=%s" % [battle.status, str(battle.me.get("health")), str(battle.me.get("kills"))])
	say("DONE")
	main.leave_battle()
	await wait(1.0)
	get_tree().quit(0)
