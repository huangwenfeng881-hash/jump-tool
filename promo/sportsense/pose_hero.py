# -*- coding: utf-8 -*-
import json, pathlib, numpy as np, torch, cv2
from PIL import Image
from torchvision.models.detection import keypointrcnn_resnet50_fpn, KeypointRCNN_ResNet50_FPN_Weights

ROOT = pathlib.Path(r"D:/jump app/promo/sportsense")
src = ROOT / "assets/hero.webp"
img = Image.open(src).convert("RGB")
img.save(ROOT / "assets/hero.png")
print("hero size", img.size)

W = KeypointRCNN_ResNet50_FPN_Weights.DEFAULT
model = keypointrcnn_resnet50_fpn(weights=W).eval()
arr = np.array(img)
t = torch.from_numpy(arr).permute(2, 0, 1).float() / 255.0
with torch.no_grad():
    pred = model([t])[0]
KP = ["nose","leye","reye","lear","rear","lsho","rsho","lelb","relb","lwri","rwri",
      "lhip","rhip","lkne","rkne","lank","rank"]
kps = pred["keypoints"].numpy()
areas = ((pred["boxes"][:,2]-pred["boxes"][:,0])*(pred["boxes"][:,3]-pred["boxes"][:,1])).numpy()
j = int(np.argmax(areas))
k = kps[j]
d = {KP[i]: [round(float(k[i][0]),1), round(float(k[i][1]),1)] for i in range(17)}
d["_scores"] = [round(float(x),2) for x in pred["keypoints_scores"].numpy()[j]]
json.dump(d, open(ROOT / "assets/hero_kp.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(json.dumps({kk: d[kk] for kk in ["nose","lsho","rsho","lwri","lhip","rank","lank"]}, ensure_ascii=False))
