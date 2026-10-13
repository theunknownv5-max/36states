extends Node
## Every sound in the game: guns, footsteps, explosions, hits, the menu and battle music and
## the ambience of each biome. Sounds are placed in 3D, muffled with distance, and far ones
## arrive a beat after the flash (speed of sound), like in the lite app.

const SPEED_OF_SOUND := 343.0
const POOL_3D := 26
const POOL_2D := 10

var bank := {}          # name -> Array[AudioStream] (variants)
var pool3d: Array[AudioStreamPlayer3D] = []
var pool2d: Array[AudioStreamPlayer] = []
var next3d := 0
var next2d := 0
var delayed: Array = []  # [time_left, name, pos, opts]
var loops := {}          # key -> AudioStreamPlayer / AudioStreamPlayer3D
var music_a: AudioStreamPlayer
var music_b: AudioStreamPlayer
var music_now := ""
var music_level := {"a": 0.0, "b": 0.0}
var music_target := {"a": 0.0, "b": 0.0}
var listener := Vector3.ZERO
var duck := 1.0
var guns_on := true

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	_buses()
	_load_bank()
	for i in POOL_3D:
		var p := AudioStreamPlayer3D.new()
		p.bus = "SFX"
		p.attenuation_model = AudioStreamPlayer3D.ATTENUATION_INVERSE_DISTANCE
		p.max_distance = 600.0
		p.attenuation_filter_cutoff_hz = 6000.0
		p.attenuation_filter_db = -18.0
		p.panning_strength = 0.9
		add_child(p)
		pool3d.append(p)
	for i in POOL_2D:
		var p := AudioStreamPlayer.new()
		p.bus = "SFX"
		add_child(p)
		pool2d.append(p)
	music_a = AudioStreamPlayer.new()
	music_b = AudioStreamPlayer.new()
	for m in [music_a, music_b]:
		m.bus = "Music"
		add_child(m)
	apply_volumes()

func _buses() -> void:
	# Master: a gentle compressor and a limiter so gunfights stay loud without clipping.
	var comp := AudioEffectCompressor.new()
	comp.threshold = -14.0
	comp.ratio = 6.0
	comp.attack_us = 3000.0
	comp.release_ms = 250.0
	AudioServer.add_bus_effect(0, comp)
	AudioServer.add_bus_effect(0, AudioEffectLimiter.new())
	for name in ["SFX", "Amb", "UI", "Music"]:
		if AudioServer.get_bus_index(name) == -1:
			AudioServer.add_bus()
			var i := AudioServer.bus_count - 1
			AudioServer.set_bus_name(i, name)
			AudioServer.set_bus_send(i, "Master")
	# A little outdoor slap on the battle sounds.
	var rev := AudioEffectReverb.new()
	rev.room_size = 0.55
	rev.damping = 0.6
	rev.dry = 1.0
	rev.wet = 0.12
	rev.spread = 0.8
	AudioServer.add_bus_effect(AudioServer.get_bus_index("SFX"), rev)

func apply_volumes() -> void:
	var v: float = Cfg.get_s("volume", 0.9)
	var mu: float = Cfg.get_s("music", 0.5)
	AudioServer.set_bus_volume_db(0, linear_to_db(max(0.0001, v)))
	AudioServer.set_bus_volume_db(AudioServer.get_bus_index("Music"), linear_to_db(max(0.0001, mu * 0.8)))
	AudioServer.set_bus_volume_db(AudioServer.get_bus_index("Amb"), linear_to_db(0.55))
	AudioServer.set_bus_volume_db(AudioServer.get_bus_index("UI"), linear_to_db(0.7))

func _load_bank() -> void:
	var dir := DirAccess.open("res://sounds")
	if dir == null:
		return
	var names := {}
	for f in dir.get_files():
		var n := f.trim_suffix(".import").trim_suffix(".remap")
		if n.ends_with(".wav"):
			names[n] = true
	for f in names.keys():
		var s = load("res://sounds/" + f)
		if s == null:
			continue
		var key: String = f.get_basename()
		# Variants: gun_rifle_0, gun_rifle_1 -> "gun_rifle"
		var parts := key.rsplit("_", true, 1)
		if parts.size() == 2 and parts[1].is_valid_int():
			key = parts[0]
		if not bank.has(key):
			bank[key] = []
		bank[key].append(s)

func has(name: String) -> bool:
	return bank.has(name)

func _pick(name: String) -> AudioStream:
	var list: Array = bank.get(name, [])
	if list.is_empty():
		return null
	return list[randi() % list.size()]

## Play a sound. pos: world position (3D) or null (in your head). opts: db, pitch, ref, max, bus.
func play(name: String, pos = null, opts := {}) -> void:
	var s := _pick(name)
	if s == null:
		return
	if pos is Vector3 and opts.get("delay", true):
		var d: float = (pos as Vector3).distance_to(listener)
		if d > 25.0:
			delayed.append([min(1.2, d / SPEED_OF_SOUND), name, pos, opts.merged({"delay": false})])
			return
	var db: float = opts.get("db", 0.0)
	var pitch: float = opts.get("pitch", 1.0) * randf_range(0.96, 1.04)
	if pos is Vector3:
		var p := pool3d[next3d]
		next3d = (next3d + 1) % pool3d.size()
		# Out of voices: don't cut off a close sound for a far one.
		if p.playing and p.global_position.distance_to(listener) < (pos as Vector3).distance_to(listener) and (pos as Vector3).distance_to(listener) > 15.0:
			return
		p.stream = s
		p.global_position = pos
		p.unit_size = opts.get("ref", 6.0)
		p.max_distance = opts.get("max", 600.0)
		p.volume_db = db
		p.pitch_scale = pitch
		p.bus = opts.get("bus", "SFX")
		p.play()
	else:
		var p := pool2d[next2d]
		next2d = (next2d + 1) % pool2d.size()
		p.stream = s
		p.volume_db = db
		p.pitch_scale = pitch
		p.bus = opts.get("bus", "SFX")
		p.play()

func ui(name: String) -> void:
	play(name, null, {"bus": "UI"})

func gunshot(sound: String, pos = null, mine := false) -> void:
	if not guns_on:
		return
	if sound == "rpg":
		play("rpg", pos, {"ref": 10.0, "db": 0.0 if mine else 3.0})
		return
	var key := "gun_" + (sound if bank.has("gun_" + sound) else "rifle")
	if mine:
		play(key + "_mine", null, {"db": -1.5})
	else:
		play(key, pos, {"ref": 10.0, "db": 4.0, "max": 900.0})

func footstep(surface: String, pos = null, loud := 1.0) -> void:
	var key := "step_" + surface
	if not bank.has(key):
		key = "step_dirt"
	play(key, pos, {"ref": 2.2, "db": linear_to_db(clamp(loud, 0.05, 2.0)), "delay": false})

func explosion(pos: Vector3, size := 1.0) -> void:
	var far := pos.distance_to(listener) > 90.0
	play("explosion_far" if far else "explosion", pos, {"ref": 14.0, "db": 6.0 + linear_to_db(size), "max": 2000.0})

func set_listener(p: Vector3) -> void:
	listener = p

func _process(delta: float) -> void:
	if not delayed.is_empty():
		var keep: Array = []
		for d in delayed:
			d[0] -= delta
			if d[0] <= 0.0:
				play(d[1], d[2], d[3])
			else:
				keep.append(d)
		delayed = keep
	# Music crossfade between the menu theme and the battle theme.
	for k in ["a", "b"]:
		var lvl: float = music_level[k]
		var tgt: float = music_target[k]
		lvl = move_toward(lvl, tgt, delta / 1.6)
		music_level[k] = lvl
		var pl := music_a if k == "a" else music_b
		pl.volume_db = linear_to_db(max(0.0001, lvl * duck))
		if lvl <= 0.0001 and pl.playing and tgt == 0.0:
			pl.stop()

## Menu or battle theme ("menu" / "battle" / "").
func music(which: String) -> void:
	if which == music_now:
		return
	music_now = which
	var file := {"menu": "res://music/pod-menu.ogg", "battle": "res://music/pod-theme.ogg"}.get(which, "")
	# The new theme goes on the quieter player.
	var use_a: bool = music_level["a"] <= music_level["b"]
	var pl := music_a if use_a else music_b
	var other_key := "b" if use_a else "a"
	music_target[other_key] = 0.0
	if file == "":
		music_target["a" if use_a else "b"] = 0.0
		return
	var st = load(file)
	if st is AudioStreamOggVorbis:
		st.loop = true
	pl.stream = st
	pl.play()
	music_target["a" if use_a else "b"] = 0.72 if which == "battle" else 1.0

## Looping sounds (ambience, fires, the drone): start/stop by key.
func loop_on(key: String, name: String, pos = null, db := 0.0, bus := "Amb") -> void:
	if loops.has(key):
		return
	var s := _pick(name)
	if s == null:
		return
	if s is AudioStreamWAV:
		s = s.duplicate()
		s.loop_mode = AudioStreamWAV.LOOP_FORWARD
		s.loop_begin = 0
		s.loop_end = int(s.get_length() * s.mix_rate)
	var p
	if pos is Vector3:
		p = AudioStreamPlayer3D.new()
		p.unit_size = 5.0
		p.max_distance = 120.0
		add_child(p)
		p.global_position = pos
	else:
		p = AudioStreamPlayer.new()
		add_child(p)
	p.stream = s
	p.bus = bus
	p.volume_db = db
	p.play()
	loops[key] = p

func loop_off(key: String) -> void:
	var p = loops.get(key)
	if p:
		loops.erase(key)
		var tw := create_tween()
		tw.tween_property(p, "volume_db", -60.0, 0.6)
		tw.tween_callback(p.queue_free)

func stop_loops() -> void:
	for k in loops.keys():
		loop_off(k)

## Biome ambience: wind, insects, water, traffic, rain, and the odd bird or horn.
func ambience(biome: String, raining: bool) -> void:
	stop_loops()
	loop_on("wind", "amb_wind_dry" if biome == "sahel" else "amb_wind", null, -6.0)
	if biome in ["rainforest", "creeks", "savanna"]:
		loop_on("insects", "amb_insects", null, -10.0)
	if biome == "creeks":
		loop_on("water", "amb_water", null, -6.0)
	if biome == "urban":
		loop_on("traffic", "amb_traffic", null, -6.0)
	if raining:
		loop_on("rain", "amb_rain", null, -4.0)

func flash_duck(strength: float) -> void:
	# Flashbang: ringing ears, everything else ducks for a moment.
	play("ring", null, {"db": linear_to_db(max(0.05, strength)), "bus": "Master"})
	var sfx := AudioServer.get_bus_index("SFX")
	AudioServer.set_bus_volume_db(sfx, -16.0)
	var tw := create_tween()
	tw.tween_method(func(v): AudioServer.set_bus_volume_db(sfx, v), -16.0, 0.0, 1.0 + strength * 3.5)
