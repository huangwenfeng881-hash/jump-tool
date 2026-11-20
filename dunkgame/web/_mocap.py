# -*- coding: utf-8 -*-
import pathlib
P = pathlib.Path(r"D:/jump app/dunkgame/web/index.html")
s = P.read_text(encoding="utf-8")

MOCAP = pathlib.Path(r"D:/jump app/dunkgame/mocap.json").read_text(encoding="utf-8")

js = """
// ================= 视频动捕数据（从参考视频逐帧估计算出的骨骼方向） =================
// 每帧: [x前, y上] 单位方向，共 24 帧
const MOCAP = """ + MOCAP + """;

const _mq1 = new THREE.Quaternion(), _mpq = new THREE.Quaternion();
const _mv1 = new THREE.Vector3(), _mv2 = new THREE.Vector3();

function dirWorld(x, y){
  // 角色朝 -Z 方向站立：图像里的"前"映射到 -Z，"上"映射到 +Y
  return new THREE.Vector3(0, y, -x).normalize();
}

function aimBone(boneName, childName, dx, dy){
  const bone = findBone(boneName), child = findBone(childName);
  if (!bone || !child) return;
  const target = dirWorld(dx, dy);
  bone.updateWorldMatrix(true, false);
  bone.getWorldPosition(_mv1);
  child.updateWorldMatrix(true, false);
  child.getWorldPosition(_mv2);
  const cur = _mv2.clone().sub(_mv1);
  if (cur.lengthSq() < 1e-8) return;
  cur.normalize();
  _mq1.setFromUnitVectors(cur, target);
  bone.parent.getWorldQuaternion(_mpq);
  const localQ = _mpq.clone().invert().multiply(_mq1).multiply(_mpq);
  bone.quaternion.premultiply(localQ);
  bone.updateWorldMatrix(false, true);
}

function lerpDir(a, b, k){
  return [a[0] + (b[0]-a[0])*k, a[1] + (b[1]-a[1])*k];
}

function applyMocap(p){
  const t = Math.min(1, Math.max(0, p));
  let i = 0;
  while (i < MOCAP.length - 2 && t > MOCAP[i+1].t) i++;
  const A = MOCAP[i], B = MOCAP[Math.min(i+1, MOCAP.length-1)];
  const span = Math.max(1e-4, B.t - A.t);
  const k = Math.min(1, Math.max(0, (t - A.t) / span));
  const g = (n) => lerpDir(A[n], B[n], k);
  aimBone('Spine', 'Spine1', g('spine')[0], g('spine')[1]);
  aimBone('LeftArm', 'LeftForeArm', g('uaL')[0], g('uaL')[1]);
  aimBone('RightArm', 'RightForeArm', g('uaR')[0], g('uaR')[1]);
  aimBone('LeftForeArm', 'LeftHand', g('faL')[0], g('faL')[1]);
  aimBone('RightForeArm', 'RightHand', g('faR')[0], g('faR')[1]);
  aimBone('LeftUpLeg', 'LeftLeg', g('thL')[0], g('thL')[1]);
  aimBone('RightUpLeg', 'RightLeg', g('thR')[0], g('thR')[1]);
  aimBone('LeftLeg', 'LeftFoot', g('shL')[0], g('shL')[1]);
  aimBone('RightLeg', 'RightFoot', g('shR')[0], g('shR')[1]);
}
"""
idx = s.rindex("// ================= 调参面板 =================")
s = s[:idx] + js + "\n" + s[idx:]

# 腾空时优先用动捕
s = s.replace(
  """    } else {
      dunkPose(t/airT);
    }""",
  """    } else {
      if (USE_MOCAP) applyMocap(t/airT); else dunkPose(t/airT);
    }"""
)
s = s.replace("const SLOWMO = ", "const USE_MOCAP = !new URLSearchParams(location.search).has('keyed');\nconst SLOWMO = ")
# 调试：?mocap=0.5 冻结在动捕某一帧
s = s.replace(
  """  if (q.has('pr') || q.has('prR') || q.has('prL')){""",
  """  if (q.has('mocap')){
    const mv = Math.max(0, Math.min(1, parseFloat(q.get('mocap')) || 0));
    if (mixerRefs.actions['idle']) { mixerRefs.actions['idle'].reset().play(); mixerRefs.current = 'idle'; }
    frozenPose = null; customPose = null;
    setTimeout(() => { applyMocap(mv); }, 200);
    mocapFreeze = mv;
  } else if (q.has('pr') || q.has('prR') || q.has('prL')){"""
)
s = s.replace("let autoJump = false;", "let autoJump = false;\nlet mocapFreeze = null;")
s = s.replace(
  """    if (customPose){
      applyPose(customPose);
      holdBall(0.05, true);""",
  """    if (mocapFreeze !== null){
      applyMocap(mocapFreeze);
      holdBall(0.05, true);
    } else if (customPose){
      applyPose(customPose);
      holdBall(0.05, true);"""
)
P.write_text(s, encoding="utf-8")
print("mocap retarget installed, data chars:", len(MOCAP))
