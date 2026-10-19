extends Node
## Settings saved on the phone, the game server's address, and the game rules
## (weapons, sides, modes, states) fetched from the server so both apps always agree.

const SERVER := "https://three6states.onrender.com"
const VERSION := "0.1"
const SAVE := "user://settings.cfg"

var server := SERVER
var build := 0
var rules: Dictionary = {}   # from /api/native/config
var settings := {
	"name": "",
	"token": "",
	"username": "",
	"faction": "army",
	"bots": true,
	"sens": 1.0,
	"volume": 0.9,
	"music": 0.5,
	"quality": "medium",   # low / medium / high
	"fov": 75.0,
	"aim_assist": true,
	"left_hand_fire": false,
	"scheme": "classic",
	"country": "",
}

signal rules_loaded

func _ready() -> void:
	var f := ConfigFile.new()
	if f.load(SAVE) == OK:
		for k in settings.keys():
			settings[k] = f.get_value("s", k, settings[k])
	# A server address can be set for testing: --server=http://10.0.2.2:2599
	for a in OS.get_cmdline_user_args() + OS.get_cmdline_args():
		if a.begins_with("--server="):
			server = a.substr(9).trim_suffix("/")
	if ProjectSettings.has_setting("application/config/build"):
		build = int(ProjectSettings.get_setting("application/config/build"))
	var bf := FileAccess.open("res://build.txt", FileAccess.READ)
	if bf:
		build = int(bf.get_as_text().strip_edges())

func save() -> void:
	var f := ConfigFile.new()
	for k in settings.keys():
		f.set_value("s", k, settings[k])
	f.save(SAVE)

func get_s(k: String, def = null):
	return settings.get(k, def)

func set_s(k: String, v) -> void:
	settings[k] = v
	save()

func reset_settings() -> void:
	for k in ["sens", "volume", "music", "quality", "fov", "aim_assist", "left_hand_fire", "scheme"]:
		settings[k] = {"sens": 1.0, "volume": 0.9, "music": 0.5, "quality": "medium", "fov": 75.0, "aim_assist": true, "left_hand_fire": false, "scheme": "classic"}[k]
	save()

func ws_url() -> String:
	return server.replace("https://", "wss://").replace("http://", "ws://") + "/ws"

func api(path: String) -> String:
	return server + path

## The game rules. Kept on the phone so the game still opens on a bad network.
func load_rules(done: Callable) -> void:
	var cache := "user://rules.json"
	var http := HTTPRequest.new()
	http.timeout = 20
	add_child(http)
	http.request_completed.connect(func(result, code, _h, body):
		http.queue_free()
		if result == HTTPRequest.RESULT_SUCCESS and code == 200:
			var d = JSON.parse_string(body.get_string_from_utf8())
			if d is Dictionary:
				rules = d
				var f := FileAccess.open(cache, FileAccess.WRITE)
				if f:
					f.store_string(body.get_string_from_utf8())
				rules_loaded.emit()
				done.call(true)
				return
		if FileAccess.file_exists(cache):
			var d2 = JSON.parse_string(FileAccess.get_file_as_string(cache))
			if d2 is Dictionary:
				rules = d2
				rules_loaded.emit()
				done.call(true)
				return
		done.call(false))
	http.request(api("/api/native/config"))

func weapon(id) -> Dictionary:
	if id == null:
		return {}
	return rules.get("WEAPONS", {}).get(str(id), {})

func weapon_ids() -> Array:
	return rules.get("WEAPON_IDS", [])

func player() -> Dictionary:
	return rules.get("PLAYER", {})

# ---------- countries and regions ----------
var regions := {}        # region id -> region (from loaded countries and match info)
var countries_data := {} # country code -> country file (outline, regions with shapes)

func state_by_id(id: String) -> Dictionary:
	for s in rules.get("STATES", []):
		if s.id == id:
			return s
	return regions.get(id, {})

func register_region(r) -> void:
	if r is Dictionary and r.has("id"):
		regions[str(r.id)] = r

func cc_of(id: String) -> String:
	return id.split(".")[0].to_upper() if "." in id else "NG"

func countries() -> Array:
	return rules.get("COUNTRIES", [])

func country(cc: String) -> Dictionary:
	for c in countries():
		if c.cc == cc:
			return c
	return {}

# A country's own war map (its regions and shapes), cached on the phone.
func load_country(cc: String, done: Callable) -> void:
	cc = cc.to_upper()
	if countries_data.has(cc):
		done.call(countries_data[cc])
		return
	var cache := "user://world/%s.json" % cc.to_lower()
	var http := HTTPRequest.new()
	http.timeout = 30
	add_child(http)
	http.request_completed.connect(func(result, code, _h, body):
		http.queue_free()
		var txt := ""
		if result == HTTPRequest.RESULT_SUCCESS and code == 200:
			txt = body.get_string_from_utf8()
			DirAccess.make_dir_recursive_absolute("user://world")
			var f := FileAccess.open(cache, FileAccess.WRITE)
			if f:
				f.store_string(txt)
		elif FileAccess.file_exists(cache):
			txt = FileAccess.get_file_as_string(cache)
		var d = JSON.parse_string(txt) if txt != "" else null
		if d is Dictionary:
			countries_data[cc] = d
			if cc != "NG":
				for r in d.get("regions", []):
					r["cc"] = cc
					register_region(r)
			done.call(d)
		else:
			done.call({}))
	http.request(api("/api/world/" + cc.to_lower()))

# The flag of a country, drawn from its code (regional indicator letters).
static func flag(cc: String) -> String:
	if cc.length() != 2:
		return ""
	return char(0x1F1E6 + cc.unicode_at(0) - 65) + char(0x1F1E6 + cc.unicode_at(1) - 65)

func faction(id: String) -> Dictionary:
	return rules.get("FACTIONS", {}).get(id, {})
