class_name Humanoid
extends Node3D

## 程序化小人：用基础几何体拼一个比例正确的球员，避免依赖外部美术资源。
## 单位：米。以 175cm 为基准缩放。

var height_m := 1.75
var parts := {}
var mat_skin: StandardMaterial3D
var mat_jersey: StandardMaterial3D
var mat_short: StandardMaterial3D

func _make_mesh(mesh: Mesh, mat: Material, name: String) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat
	mi.name = name
	add_child(mi)
	return mi

func build(p_height_cm: float) -> void:
	height_m = p_height_cm / 100.0
	var k := height_m / 1.75

	mat_skin = StandardMaterial3D.new()
	mat_skin.albedo_color = Color(0.85, 0.68, 0.55)
	mat_skin.roughness = 0.6

	mat_jersey = StandardMaterial3D.new()
	mat_jersey.albedo_color = Color(0.85, 0.15, 0.18)
	mat_jersey.roughness = 0.75

	mat_short = StandardMaterial3D.new()
	mat_short.albedo_color = Color(0.12, 0.12, 0.16)
	mat_short.roughness = 0.8

	# 躯干
	var torso := CapsuleMesh.new()
	torso.radius = 0.15 * k
	torso.height = 0.55 * k
	var torso_mi := _make_mesh(torso, mat_jersey, "torso")
	torso_mi.position = Vector3(0, 1.12 * k, 0)

	# 头
	var head := SphereMesh.new()
	head.radius = 0.105 * k
	head.height = 0.21 * k
	var head_mi := _make_mesh(head, mat_skin, "head")
	head_mi.position = Vector3(0, 1.55 * k, 0)

	# 髋部/短裤
	var hip := BoxMesh.new()
	hip.size = Vector3(0.30 * k, 0.22 * k, 0.19 * k)
	var hip_mi := _make_mesh(hip, mat_short, "hip")
	hip_mi.position = Vector3(0, 0.88 * k, 0)

	# 手臂（肩关节为支点，用 Node3D 包一层方便旋转）
	for side in [-1, 1]:
		var pivot := Node3D.new()
		pivot.name = "arm_%s" % ("l" if side < 0 else "r")
		pivot.position = Vector3(side * 0.20 * k, 1.38 * k, 0)
		add_child(pivot)

		var upper := CapsuleMesh.new()
		upper.radius = 0.045 * k
		upper.height = 0.32 * k
		var um := _make_mesh(upper, mat_skin, "upper_%d" % side)
		um.reparent(pivot, false)
		um.position = Vector3(0, -0.16 * k, 0)

		var fore := CapsuleMesh.new()
		fore.radius = 0.04 * k
		fore.height = 0.30 * k
		var fm := _make_mesh(fore, mat_skin, "fore_%d" % side)
		fm.reparent(pivot, false)
		fm.position = Vector3(0, -0.46 * k, 0)

		var hand := SphereMesh.new()
		hand.radius = 0.05 * k
		hand.height = 0.10 * k
		var hm := _make_mesh(hand, mat_skin, "hand_%d" % side)
		hm.reparent(pivot, false)
		hm.position = Vector3(0, -0.63 * k, 0)

		parts["arm_" + ("l" if side < 0 else "r")] = pivot

	# 腿
	for side in [-1, 1]:
		var leg := CapsuleMesh.new()
		leg.radius = 0.065 * k
		leg.height = 0.72 * k
		var lm := _make_mesh(leg, mat_skin, "leg_%d" % side)
		lm.position = Vector3(side * 0.11 * k, 0.42 * k, 0)

		# 小腿（缩略）
		var low := CapsuleMesh.new()
		low.radius = 0.055 * k
		low.height = 0.42 * k
		var lom := _make_mesh(low, mat_short, "low_%d" % side)
		lom.position = Vector3(side * 0.11 * k, 0.18 * k, 0)

	# 手举到最高的参考点
	var marker := Node3D.new()
	marker.name = "reach_point"
	marker.position = Vector3(0, 2.05 * k, 0)
	add_child(marker)

## pose: 0=站立, 1=起跳举臂, 2=下蹲蓄力
func set_pose(pose: float, arm_lift: float) -> void:
	var arm_l: Node3D = parts.get("arm_l")
	var arm_r: Node3D = parts.get("arm_r")
	if arm_l and arm_r:
		arm_l.rotation_degrees.z = lerp(-12.0, -168.0, arm_lift)
		arm_r.rotation_degrees.z = lerp(12.0, 168.0, arm_lift)
		arm_l.rotation_degrees.x = lerp(0.0, -10.0, arm_lift)
		arm_r.rotation_degrees.x = lerp(0.0, -10.0, arm_lift)
