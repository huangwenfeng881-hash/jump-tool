extends Node3D

## 扣篮模拟器 · MVP
## 体验：填身体数据 → 看摸高与篮筐的差距 → 点起跳 → 3D 小人起跳并判定能否扣进。

const RIM_H := 3.05
const G := 9.81
const HOOP_Z := -3.2

var stats := DunkStats.new()
var humanoid: Humanoid
var ball: MeshInstance3D
var cam: Camera3D

var state := "SETUP"
var t := 0.0
var v0 := 0.0
var air_total := 0.0
var reached_cm := 0.0
var frame_count := 0
var shot_mode := false
var shot_taken := false

var lbl_info: Label
var lbl_result: Label
var lbl_hint: Label
var edits := {}
var btn_start: Button

func _ready() -> void:
	shot_mode = OS.get_cmdline_user_args().has("--shot")
	_build_world()
	_build_ui()
	_reset_player()
	_refresh_info()

# ---------------- 场景 ----------------

func _mat(c: Color, rough := 0.7) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = rough
	return m

func _box(size: Vector3, pos: Vector3, c: Color) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.material_override = _mat(c)
	mi.position = pos
	add_child(mi)
	return mi

func _build_world() -> void:
	# 环境
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.06, 0.07, 0.10)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.55, 0.60, 0.75)
	env.ambient_light_energy = 0.55
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)

	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-52, -38, 0)
	sun.light_energy = 1.15
	sun.shadow_enabled = true
	add_child(sun)

	var fill := DirectionalLight3D.new()
	fill.rotation_degrees = Vector3(-28, 140, 0)
	fill.light_energy = 0.35
	fill.light_color = Color(0.6, 0.7, 1.0)
	add_child(fill)

	# 地板（木色球场）
	_box(Vector3(24, 0.2, 24), Vector3(0, -0.1, 0), Color(0.30, 0.20, 0.12))
	# 三分线弧（用细长盒子拼）
	for i in range(48):
		var a := deg_to_rad(-160.0 + i * 3.0)
		var r := 6.75
		var p := Vector3(cos(a) * r, 0.01, sin(a) * r + HOOP_Z + 0.3)
		var seg := _box(Vector3(0.28, 0.02, 0.06), p, Color(0.95, 0.95, 0.95))
		seg.rotation.y = a
	# 篮下矩形
	_box(Vector3(4.9, 0.02, 0.06), Vector3(0, 0.01, -4.6), Color(0.9, 0.9, 0.9))

	# 篮架
	_box(Vector3(0.6, 0.8, 0.6), Vector3(0, 0.4, HOOP_Z - 1.1), Color(0.15, 0.15, 0.18))
	var pole := MeshInstance3D.new()
	var cyl := CylinderMesh.new()
	cyl.top_radius = 0.09
	cyl.bottom_radius = 0.09
	cyl.height = 3.4
	pole.mesh = cyl
	pole.material_override = _mat(Color(0.18, 0.18, 0.22), 0.4)
	pole.position = Vector3(0, 2.0, HOOP_Z - 1.1)
	add_child(pole)

	# 篮板
	var board := _box(Vector3(1.8, 1.05, 0.05), Vector3(0, 3.45, HOOP_Z - 0.45), Color(0.92, 0.95, 1.0))
	board.material_override.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	board.material_override.albedo_color = Color(0.85, 0.92, 1.0, 0.35)
	# 篮板框
	_box(Vector3(1.9, 0.06, 0.06), Vector3(0, 3.98, HOOP_Z - 0.45), Color(0.9, 0.2, 0.2))
	_box(Vector3(0.62, 0.45, 0.04), Vector3(0, 2.98, HOOP_Z - 0.44), Color(0.9, 0.2, 0.2))

	# 篮筐（圆环）
	var rim := MeshInstance3D.new()
	var torus := TorusMesh.new()
	torus.inner_radius = 0.20
	torus.outer_radius = 0.245
	rim.mesh = torus
	rim.material_override = _mat(Color(1.0, 0.45, 0.12), 0.4)
	rim.position = Vector3(0, RIM_H, HOOP_Z - 0.15)
	rim.rotation_degrees.x = 90.0
	add_child(rim)

	# 相机
	cam = Camera3D.new()
	cam.position = Vector3(4.6, 2.9, 6.8)
	add_child(cam)
	cam.look_at(Vector3(0, 2.0, -0.6))

func _reset_player() -> void:
	if humanoid:
		humanoid.queue_free()
	humanoid = Humanoid.new()
	humanoid.build(stats.height_cm)
	humanoid.position = Vector3(0, 0, 2.6)
	humanoid.rotation_degrees.y = 180.0
	add_child(humanoid)
	humanoid.set_pose(0.0, 0.0)

	if ball:
		ball.queue_free()
	ball = MeshInstance3D.new()
	var sp := SphereMesh.new()
	sp.radius = 0.12
	sp.height = 0.24
	ball.mesh = sp
	ball.material_override = _mat(Color(1.0, 0.45, 0.1), 0.5)
	ball.position = Vector3(0.42, 1.0, 2.4)
	add_child(ball)

# ---------------- UI ----------------

func _build_ui() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)

	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	layer.add_child(root)

	lbl_info = Label.new()
	lbl_info.position = Vector2(24, 24)
	lbl_info.add_theme_font_size_override("font_size", 20)
	lbl_info.modulate = Color(0.95, 0.97, 1.0)
	root.add_child(lbl_info)

	lbl_result = Label.new()
	lbl_result.position = Vector2(24, 240)
	lbl_result.add_theme_font_size_override("font_size", 34)
	lbl_result.modulate = Color(0.55, 0.95, 0.75)
	root.add_child(lbl_result)

	lbl_hint = Label.new()
	lbl_hint.position = Vector2(24, 300)
	lbl_hint.add_theme_font_size_override("font_size", 17)
	lbl_hint.modulate = Color(0.75, 0.8, 0.9)
	lbl_hint.text = "空格 / 点击「起跳」开始"
	root.add_child(lbl_hint)

	var panel := VBoxContainer.new()
	panel.position = Vector2(24, 880)
	panel.size = Vector2(520, 380)
	panel.add_theme_constant_override("separation", 10)
	root.add_child(panel)

	var defs := [
		["身高 cm", "height", "175"],
		["臂展 cm", "armspan", "180"],
		["体重 kg", "weight", "65"],
		["弹跳 cm", "jump", "55"],
		["站立摸高 cm（可留空）", "reach", ""],
	]
	for d in defs:
		var row := HBoxContainer.new()
		panel.add_child(row)
		var l := Label.new()
		l.text = d[0]
		l.custom_minimum_size = Vector2(260, 0)
		l.add_theme_font_size_override("font_size", 17)
		row.add_child(l)
		var e := LineEdit.new()
		e.text = d[2]
		e.custom_minimum_size = Vector2(150, 42)
		row.add_child(e)
		edits[d[1]] = e

	btn_start = Button.new()
	btn_start.text = "起跳"
	btn_start.custom_minimum_size = Vector2(300, 64)
	btn_start.add_theme_font_size_override("font_size", 24)
	btn_start.pressed.connect(_on_start)
	panel.add_child(btn_start)

func _read_inputs() -> void:
	stats.height_cm = _num("height", stats.height_cm)
	stats.armspan_cm = _num("armspan", stats.armspan_cm)
	stats.weight_kg = _num("weight", stats.weight_kg)
	stats.jump_cm = _num("jump", stats.jump_cm)
	stats.standing_reach_cm = _num("reach", 0.0)

func _num(key: String, fallback: float) -> float:
	var e: LineEdit = edits[key]
	if e == null:
		return fallback
	var s := e.text.strip_edges()
	if s == "":
		return 0.0 if key == "reach" else fallback
	return s.to_float()

func _refresh_info() -> void:
	_read_inputs()
	lbl_info.text = stats.describe()

# ---------------- 逻辑 ----------------

func _on_start() -> void:
	if state == "AIR" or state == "RUNUP":
		return
	_read_inputs()
	_reset_player()
	_refresh_info()
	v0 = stats.takeoff_speed()
	air_total = stats.airtime()
	t = 0.0
	reached_cm = 0.0
	state = "RUNUP"
	btn_start.disabled = true
	lbl_result.text = ""
	lbl_hint.text = "助跑…"
	# 起步位置
	humanoid.position = Vector3(0, 0, 5.2)
	ball.position = Vector3(0.42, 1.0, 5.0)

func _process(delta: float) -> void:
	frame_count += 1
	if shot_mode and frame_count == 90 and not shot_taken:
		shot_taken = true
		var img := get_viewport().get_texture().get_image()
		img.save_png("res://_shot.png")
		print("SHOT SAVED")
		get_tree().quit()
		return

	match state:
		"RUNUP":
			t += delta
			humanoid.position.z = lerp(5.2, 1.2, clamp(t / 0.75, 0.0, 1.0))
			humanoid.set_pose(0.0, 0.15 + 0.1 * sin(t * 22.0))
			ball.position.z = humanoid.position.z - 0.2
			if t >= 0.75:
				t = 0.0
				state = "AIR"
				humanoid.set_pose(0.0, 1.0)
		"AIR":
			t += delta
			var y := v0 * t - 0.5 * G * t * t
			humanoid.position.y = max(y, 0.0)
			var lift := clamp(t / max(air_total * 0.45, 0.001), 0.0, 1.0)
			humanoid.set_pose(0.0, 1.0)
			ball.position.y = humanoid.position.y + 2.0
			if t >= air_total:
				state = "RESULT"
				_on_landed()

func _on_landed() -> void:
	reached_cm = stats.touch_reach()
	var gap := stats.dunk_need() - reached_cm
	if gap <= 0.0:
		lbl_result.text = "扣进！富余 %.0f cm" % (-gap)
		lbl_result.modulate = Color(0.5, 1.0, 0.7)
		ball.position = Vector3(0, RIM_H, HOOP_Z - 0.15)
	else:
		lbl_result.text = "没够到，还差 %.0f cm" % gap
		lbl_result.modulate = Color(1.0, 0.55, 0.45)
		lbl_hint.text = "想扣进？弹跳再加 %.0fcm，或减 %.0fkg / 加 %.0fcm 臂展" % [gap, 0.0, 0.0]
		ball.position = Vector3(0, humanoid.position.y + 1.9, humanoid.position.z)
	btn_start.disabled = false
	state = "SETUP"
	humanoid.position = Vector3(0, 0, 2.6)
	humanoid.set_pose(0.0, 0.0)

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and event.physical_keycode == KEY_SPACE:
		_on_start()
