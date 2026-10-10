#!/usr/bin/env python
# tools/extract_poses.py — Python MediaPipe(PoseLandmarker) 批量提取视频姿态特征
# 输出与网页版 js/pose.js computeFrame 完全一致的 poseData（供 tools/calibrate.js 离线校准）。
#
# 用法（在项目根目录，用装了 mediapipe 的 python 跑）:
#   python tools/extract_poses.py                       # 跑 test video/ 全部 .mp4
#   python tools/extract_poses.py --input "my videos"    # 跑指定目录
#   python tools/extract_poses.py "a.mp4" "b.mp4"        # 跑指定文件
#   python tools/extract_poses.py --dim 320 --output _mp_poses
#
# 依赖: pip install mediapipe opencv-contrib-python   （见 tools/README.md）
# 模型: 默认 mediapipe/tasks-vision/pose_landmarker_lite.task（5.7MB，与网页版同源）
import os, sys, json, glob, math, argparse
import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # 项目根（tools/ 上一级）
DEFAULT_MODEL = os.path.join(ROOT, 'mediapipe', 'tasks-vision', 'pose_landmarker_lite.task')
DEFAULT_INPUT = os.path.join(ROOT, 'test video')
DEFAULT_OUT = os.path.join(ROOT, '_mp_poses')

# ---- 与 js/pose.js computeFrame 完全一致的辅助函数 ----
def vis(p):
    return p is not None and getattr(p, 'visibility', 1.0) > 0.5

def ang(a, b, c):
    if not (vis(a) and vis(b) and vis(c)):
        return None
    v1x, v1y = a.x - b.x, a.y - b.y
    v2x, v2y = c.x - b.x, c.y - b.y
    m1 = math.sqrt(v1x*v1x + v1y*v1y); m2 = math.sqrt(v2x*v2x + v2y*v2y)
    if not m1 or not m2:
        return None
    dot = v1x*v2x + v1y*v2y
    deg = math.acos(max(-1.0, min(1.0, dot/(m1*m2)))) * 180.0 / math.pi
    return round(deg*10)/10

def mid(a, b):
    if not (vis(a) and vis(b)):
        return None
    return ((a.x+b.x)/2, (a.y+b.y)/2)

def r3(v):
    return None if v is None else round(v*1000)/1000

def compute_frame(lm):
    if not lm or len(lm) < 33:
        return None
    kneeL = ang(lm[23], lm[25], lm[27]); kneeR = ang(lm[24], lm[26], lm[28])
    hipL = ang(lm[11], lm[23], lm[25]); hipR = ang(lm[12], lm[24], lm[26])
    comY = comX = None
    if vis(lm[23]) and vis(lm[24]):
        comY = (lm[23].y + lm[24].y)/2; comX = (lm[23].x + lm[24].x)/2
    elif vis(lm[23]):
        comY = lm[23].y; comX = lm[23].x
    feetY = None
    for i in range(27, 33):
        if vis(lm[i]) and (feetY is None or lm[i].y > feetY):
            feetY = lm[i].y
    leftFeetY = rightFeetY = None
    for j in range(27, 33):
        if not vis(lm[j]):
            continue
        if j in (27, 29, 31):
            if leftFeetY is None or lm[j].y > leftFeetY: leftFeetY = lm[j].y
        else:
            if rightFeetY is None or lm[j].y > rightFeetY: rightFeetY = lm[j].y
    hipM = mid(lm[23], lm[24]); ankM = mid(lm[27], lm[28])
    shM = mid(lm[11], lm[12]); wrM = mid(lm[15], lm[16])
    return {
        'kneeL': kneeL, 'kneeR': kneeR, 'hipL': hipL, 'hipR': hipR,
        'comH': None if comY is None else round((1-comY)*1000)/10,
        'comX': None if comX is None else round(comX*1000)/10,
        'feetY': feetY,
        'leftFeetY': None if leftFeetY is None else round(leftFeetY*1000)/1000,
        'rightFeetY': None if rightFeetY is None else round(rightFeetY*1000)/1000,
        'hipX': r3(hipM[0]) if hipM else None, 'hipY': r3(hipM[1]) if hipM else None,
        'ankleX': r3(ankM[0]) if ankM else None, 'ankleY': r3(ankM[1]) if ankM else None,
        'shX': r3(shM[0]) if shM else None, 'shY': r3(shM[1]) if shM else None,
        'wrX': r3(wrM[0]) if wrM else None, 'wrY': r3(wrM[1]) if wrM else None,
    }

def empty_frame():
    return {'kneeL':None,'kneeR':None,'hipL':None,'hipR':None,'comH':None,'comX':None,
            'feetY':None,'leftFeetY':None,'rightFeetY':None,'hipX':None,'hipY':None,
            'ankleX':None,'ankleY':None,'shX':None,'shY':None,'wrX':None,'wrY':None}

def scale_frame(frame, max_dim):
    h, w = frame.shape[:2]
    if max_dim and max_dim > 0:
        scale = min(1.0, max_dim / max(w, h))
        if scale < 1.0:
            return cv2.resize(frame, (max(2, round(w*scale)), max(2, round(h*scale))))
    return frame

def process(video_path, landmarker, base_ts, max_dim, out_dir):
    name = os.path.basename(video_path)
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print('OPEN FAIL ' + name); return base_ts
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    if fps <= 0 or fps > 200: fps = 30.0
    data = []
    i = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frame = scale_frame(frame, max_dim)
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        mpimg = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        ts = base_ts + i * 16  # 全局递增（MediaPipe VIDEO 要求跨帧严格递增）
        res = landmarker.detect_for_video(mpimg, ts)
        entry = empty_frame()
        entry['t'] = round(i / fps, 4)
        if res.pose_landmarks and len(res.pose_landmarks) > 0:
            f = compute_frame(res.pose_landmarks[0])
            if f is not None:
                entry.update(f); entry['lost'] = False
            else:
                entry['lost'] = True
        else:
            entry['lost'] = True
        data.append(entry)
        i += 1
    cap.release()
    out = {'video': name, 'fps': fps, 'frames': i, 'poseData': data}
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, name + '.json')
    with open(out_path, 'w', encoding='utf-8') as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(',', ':'))
    print('saved %s  (%d frames, fps=%.2f)' % (name, i, fps))
    return base_ts + (i + 1) * 16 + 10000  # 视频间留间隔，保证全局严格递增

def build_landmarker(model_path):
    options = vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=model_path),
        running_mode=vision.RunningMode.VIDEO,
        num_poses=1,
        min_pose_detection_confidence=0.3,
        min_pose_presence_confidence=0.3,
        min_tracking_confidence=0.3,
    )
    return vision.PoseLandmarker.create_from_options(options)

def main():
    ap = argparse.ArgumentParser(description='MediaPipe 批量姿态提取（与网页版特征一致）')
    ap.add_argument('videos', nargs='*', help='视频文件；缺省用 --input 目录里全部 .mp4')
    ap.add_argument('--input', default=DEFAULT_INPUT, help='视频目录（默认 test video）')
    ap.add_argument('--output', default=DEFAULT_OUT, help='输出 JSON 目录（默认 _mp_poses）')
    ap.add_argument('--model', default=DEFAULT_MODEL, help='PoseLandmarker .task 模型路径')
    ap.add_argument('--dim', type=int, default=480, help='抽帧最长边分辨率（默认 480，与网页一致）')
    args = ap.parse_args()
    vids = args.videos or sorted(glob.glob(os.path.join(args.input, '*.mp4')))
    if not vids:
        print('没有找到视频：' + args.input); sys.exit(1)
    print('将处理 %d 个视频（dim=%d，输出 %s）' % (len(vids), args.dim, args.output))
    landmarker = build_landmarker(args.model)
    base_ts = 0
    for v in vids:
        try:
            base_ts = process(v, landmarker, base_ts, args.dim, args.output)
        except Exception as e:
            print('ERR %s: %s' % (os.path.basename(v), e))
    landmarker.close()
    print('完成：输出到 ' + args.output)

if __name__ == '__main__':
    main()
