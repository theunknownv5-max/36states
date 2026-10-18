class_name ExitDialog
extends Control
## "Leave the game?" — so the back button and the Exit button never quit by accident.

static func ask(parent: Node) -> void:
	for c in parent.get_children():
		if c is ExitDialog:
			return
	var d := ExitDialog.new()
	parent.add_child(d)

func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(Kit.bg_rect(Color(0, 0, 0, 0.7)))
	var c := CenterContainer.new()
	Kit.fill(c)
	add_child(c)
	var p := Kit.panel(20)
	p.custom_minimum_size = Vector2(440, 0)
	c.add_child(p)
	var v := Kit.vbox(12)
	p.add_child(v)
	v.add_child(Kit.title("LEAVE THE GAME?", 26))
	v.add_child(Kit.para("Your rank, gems and crew are saved on the server.", 16))
	var row := Kit.hbox(10)
	v.add_child(row)
	var stay := Kit.button("Stay", true)
	stay.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	stay.pressed.connect(queue_free)
	row.add_child(stay)
	var quit := Kit.button("Exit game")
	quit.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	quit.add_theme_color_override("font_color", Kit.BAD)
	quit.pressed.connect(func():
		Net.close()
		get_tree().quit())
	row.add_child(quit)

func on_back() -> void:
	queue_free()
