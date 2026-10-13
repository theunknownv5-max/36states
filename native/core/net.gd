extends Node
## WebSocket link to the game server (the same server the lite app uses), with clock
## sync so everyone agrees on server time.

signal status(online: bool)

var ws := WebSocketPeer.new()
var handlers := {}
var online := false
var connecting := false
var stopped := true
var hello := {}
var token := ""
var offset := 0.0     # server ms - local ms
var rtt := 80.0
var samples: Array = []
var retries := 0
var _ping_t := 0.0
var _pending: Callable = Callable()
var _was_open := false

func _ready() -> void:
	ws.inbound_buffer_size = 1 << 20
	ws.outbound_buffer_size = 1 << 16
	process_mode = Node.PROCESS_MODE_ALWAYS

func now_ms() -> float:
	return Time.get_unix_time_from_system() * 1000.0

func server_now() -> float:
	return now_ms() + offset

func on(type: String, fn: Callable) -> void:
	if not handlers.has(type):
		handlers[type] = []
	handlers[type].append(fn)

func off_owner(obj: Object) -> void:
	for k in handlers.keys():
		handlers[k] = handlers[k].filter(func(c: Callable): return c.is_valid() and c.get_object() != obj)

func emit_msg(type: String, msg: Dictionary) -> void:
	for fn in handlers.get(type, []).duplicate():
		if fn.is_valid():
			fn.call(msg)

## hello: { name, token } for a guest, or { mode: "login"/"register", username, password }.
## done(ok: bool) is called once the socket opens (or fails).
func connect_server(h: Dictionary, done: Callable = Callable()) -> void:
	hello = h
	stopped = false
	_pending = done
	_open()

func _open() -> void:
	ws = WebSocketPeer.new()
	ws.inbound_buffer_size = 1 << 20
	ws.outbound_buffer_size = 1 << 16
	var err := ws.connect_to_url(Cfg.ws_url())
	connecting = err == OK
	_was_open = false
	if err != OK:
		_fail()

func _fail() -> void:
	connecting = false
	if _pending.is_valid():
		var p := _pending
		_pending = Callable()
		p.call(false)
	status.emit(false)
	if not stopped:
		retries += 1
		get_tree().create_timer(min(8.0, 0.8 * retries)).timeout.connect(_reconnect)

func _reconnect() -> void:
	if stopped or online:
		return
	# Come back as the same profile: accounts log in again, guests reuse their token.
	if not hello.has("mode"):
		hello = {"name": hello.get("name", ""), "token": token if token != "" else hello.get("token", "")}
	emit_msg("reconnecting", {"n": retries})
	_open()

func close() -> void:
	stopped = true
	online = false
	ws.close()

func send(obj: Dictionary) -> void:
	if online and ws.get_ready_state() == WebSocketPeer.STATE_OPEN:
		ws.send_text(JSON.stringify(obj))

func _process(delta: float) -> void:
	if not connecting and not online:
		return
	ws.poll()
	var st := ws.get_ready_state()
	if st == WebSocketPeer.STATE_OPEN:
		if not _was_open:
			_was_open = true
			connecting = false
			online = true
			retries = 0
			var h := hello.duplicate()
			h["t"] = "hello"
			h["app"] = true
			h["native"] = true
			h["build"] = Cfg.build
			send(h)
			status.emit(true)
			_ping()
			get_tree().create_timer(0.3).timeout.connect(_ping)
			get_tree().create_timer(0.7).timeout.connect(_ping)
			if _pending.is_valid():
				var p := _pending
				_pending = Callable()
				p.call(true)
		while ws.get_available_packet_count() > 0:
			var raw := ws.get_packet().get_string_from_utf8()
			var msg = JSON.parse_string(raw)
			if not (msg is Dictionary) or not msg.has("t"):
				continue
			var t: String = msg.t
			if t == "pong":
				_on_pong(msg)
				continue
			if t == "welcome":
				token = str(msg.get("token", ""))
			if t == "authError":
				stopped = true
			if msg.has("serverTime") and samples.is_empty():
				offset = float(msg.serverTime) - now_ms()
			emit_msg(t, msg)
		_ping_t += delta
		if _ping_t > 2.0:
			_ping_t = 0.0
			_ping()
	elif st == WebSocketPeer.STATE_CLOSED:
		var was := online
		online = false
		connecting = false
		if was:
			status.emit(false)
			if not stopped:
				retries += 1
				get_tree().create_timer(min(8.0, 0.8 * retries)).timeout.connect(_reconnect)
		else:
			_fail()

func _ping() -> void:
	send({"t": "ping", "c": now_ms()})

func _on_pong(m: Dictionary) -> void:
	var n := now_ms()
	var r: float = n - float(m.c)
	samples.append({"rtt": r, "off": float(m.s) - (float(m.c) + r / 2.0)})
	if samples.size() > 9:
		samples.pop_front()
	var best := samples.duplicate()
	best.sort_custom(func(a, b): return a.rtt < b.rtt)
	best = best.slice(0, 4)
	var o := 0.0
	for s in best:
		o += s.off
	offset = o / best.size()
	var tot := 0.0
	for s in samples:
		tot += s.rtt
	rtt = tot / samples.size()
	emit_msg("ping", {"ms": int(rtt)})
