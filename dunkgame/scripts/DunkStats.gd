class_name DunkStats
extends RefCounted

## 身体数据 -> 派生量。全部使用 cm / kg。

var height_cm := 175.0
var armspan_cm := 180.0
var weight_kg := 65.0
var jump_cm := 55.0          # 垂直弹跳（可用 App 里 AI 分析的结果填）
var standing_reach_cm := 0.0 # 站立摸高：0 表示按臂展估算

const RIM_CM := 305.0        # 标准篮筐高度
const BALL_CLEAR_CM := 15.0  # 球要过框，手掌需要高出的余量
const G := 9.81

## 站立摸高估算：站摸 ≈ 臂展 × 1.27（175cm/180cm 臂展 → 约 229cm）
func reach() -> float:
	if standing_reach_cm > 0.0:
		return standing_reach_cm
	return armspan_cm * 1.27

## 原地摸高 = 站摸 + 弹跳
func touch_reach() -> float:
	return reach() + jump_cm

## 扣篮所需摸高
func dunk_need() -> float:
	return RIM_CM + BALL_CLEAR_CM

## 距离扣篮还差多少（负数=已经能扣）
func gap() -> float:
	return dunk_need() - touch_reach()

func can_dunk() -> bool:
	return touch_reach() >= dunk_need()

## 起跳初速度（m/s）：v = sqrt(2gh)
func takeoff_speed() -> float:
	return sqrt(2.0 * G * jump_cm / 100.0)

## 腾空总时间（秒）
func airtime() -> float:
	return 2.0 * takeoff_speed() / G

func describe() -> String:
	var s := "身高 %.0f  臂展 %.0f  体重 %.0f\n" % [height_cm, armspan_cm, weight_kg]
	s += "站立摸高 %.0fcm · 弹跳 %.0fcm → 摸高 %.0fcm\n" % [reach(), jump_cm, touch_reach()]
	s += "篮筐 305cm，需要 %.0fcm" % dunk_need()
	if can_dunk():
		s += "\n✅ 可以扣（富余 %.0fcm）" % (-gap())
	else:
		s += "\n❌ 还差 %.0fcm（弹跳要多 %.0fcm）" % [gap(), gap()]
	return s
