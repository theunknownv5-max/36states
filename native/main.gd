extends Node
## Screen router: sign-in, then the war map (lobby), then a battle.

func _ready() -> void:
	var l := Label.new()
	l.text = "Proof of Duty"
	add_child(l)
