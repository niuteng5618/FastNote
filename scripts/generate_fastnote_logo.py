#!/usr/bin/env python3
"""
生成 FastNote 品牌全套设计图标（1024x1024，超采样抗锯齿光栅渲染）。

设计说明
--------
语义：FastNote = 极速(Fast) + 笔记(Note)。
构图：
  - 背景：靛蓝→青蓝的深邃对角渐变 + iOS 风格圆角方形(Squircle)，细腻描边微光。
  - 主体：厚重、利落、纯白的大写「F」（圆角笔画，向右微倾带来极速动势），
    代表 Fast，同时是产品首字母。
  - 右侧：三条由短到长、圆角胶囊状的速度感横线，代表 Note（笔记文字行）与冲刺速度。
  - 点缀：极小的白色粒子/星点，呼应原产品「代码/速度粒子」的科技气质。
所有图形均由基本图元(矩形/圆角矩形/多边形/椭圆)绘制，保证稳定可控、无渲染空洞。
"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

SIZE = 1024
S = 3                     # 超采样倍率
W = SIZE * S

img = Image.new("RGBA", (W, W), (0, 0, 0, 0))

# ---------- 1. 对角渐变背景 ----------
grad = Image.new("RGBA", (W, W), (0, 0, 0, 0))
gpx = grad.load()
# 顶部靛蓝 #172a52 → 中部品牌蓝 #1e56c8 → 底部青蓝 #06b6d4
top = (23, 42, 82)
mid = (30, 86, 200)
bot = (6, 182, 212)
for y in range(W):
    t = y / (W - 1)
    if t < 0.5:
        k = t / 0.5
        r = int(top[0] * (1 - k) + mid[0] * k)
        g = int(top[1] * (1 - k) + mid[1] * k)
        b = int(top[2] * (1 - k) + mid[2] * k)
    else:
        k = (t - 0.5) / 0.5
        r = int(mid[0] * (1 - k) + bot[0] * k)
        g = int(mid[1] * (1 - k) + bot[1] * k)
        b = int(mid[2] * (1 - k) + bot[2] * k)
    for x in range(W):
        # 轻微对角亮度：右上更亮一点
        gpx[x, y] = (r, g, b, 255)

# ---------- 2. 圆角方形蒙版 ----------
radius = int(W * 0.225)
margin = int(W * 0.015)
box = [margin, margin, W - margin, W - margin]
mask = Image.new("L", (W, W), 0)
ImageDraw.Draw(mask).rounded_rectangle(box, radius=radius, fill=255)
bg = Image.composite(grad, Image.new("RGBA", (W, W), (0, 0, 0, 0)), mask)

# 边缘细微内发光描边
border_mask = Image.new("L", (W, W), 0)
ImageDraw.Draw(border_mask).rounded_rectangle(box, radius=radius, outline=255, width=int(3 * S))
bg = Image.composite(Image.new("RGBA", (W, W), (255, 255, 255, 50)), bg, border_mask)

cx, cy = W / 2, W / 2

# ---------- 3. 柔和投影 ----------
shadow = Image.new("RGBA", (W, W), (0, 0, 0, 0))
sdraw = ImageDraw.Draw(shadow)

# 用于绘制「F」的辅助：以基线坐标定义三个矩形（竖干 + 上横 + 中横），再统一右倾
def skew_point(x, y, shear=0.12):
    """相对中心的点，向右上做水平错切，制造极速倾斜动势。"""
    return (cx + x - (y * shear), cy + y)

def rounded_poly_rect(drawer, x0, y0, x1, y1, fill, rad):
    drawer.rounded_rectangle([x0, y0, x1, y1], radius=rad, fill=fill)

# F 的几何（相对中心，单位=画布比例）
stem_w = W * 0.115      # 竖干宽
top_h  = W * 0.105      # 上横高
mid_h  = W * 0.095      # 中横高
fx = -W * 0.245         # F 左边缘
f_top = -W * 0.255      # F 顶部
f_bot =  W * 0.255      # F 底部
top_len = W * 0.36      # 上横长度
mid_len = W * 0.265     # 中横长度
rad_stem = stem_w * 0.42

# 由于要右倾，采用多边形逐个绘制（错切后仍是平行四边形，polygon 可靠填充）
def sheared_rect(x0, y0, x1, y1, shear=0.12):
    return [
        skew_point(x0, y0, shear),
        skew_point(x1, y0, shear),
        skew_point(x1, y1, shear),
        skew_point(x0, y1, shear),
    ]

# 阴影（整体下移+模糊）
for rect in [
    (fx, f_top, fx + stem_w, f_bot),               # 竖干
    (fx, f_top, fx + top_len, f_top + top_h),      # 上横
    (fx, -mid_h / 2, fx + mid_len, mid_h / 2),     # 中横
]:
    sdraw.polygon(sheared_rect(*rect), fill=(0, 18, 55, 110))

shadow = shadow.filter(ImageFilter.GaussianBlur(int(16 * S)))
off = Image.new("RGBA", (W, W), (0, 0, 0, 0))
off.paste(shadow, (int(2 * S), int(12 * S)))
bg = Image.alpha_composite(bg, off)

# ---------- 4. 绘制主体 F（纯白） ----------
icon = Image.new("RGBA", (W, W), (0, 0, 0, 0))
idraw = ImageDraw.Draw(icon)
white = (255, 255, 255, 252)
for rect in [
    (fx, f_top, fx + stem_w, f_bot),               # 竖干
    (fx, f_top, fx + top_len, f_top + top_h),      # 上横
    (fx, -mid_h / 2, fx + mid_len, mid_h / 2),     # 中横
]:
    idraw.polygon(sheared_rect(*rect), fill=white)

# 圆角修饰：在竖干上下端、横条末端盖圆点让边角柔和
def cap(x, y, r, shear=0.12):
    px, py = skew_point(x, y, shear)
    idraw.ellipse([px - r, py - r, px + r, py + r], fill=white)

# ---------- 5. 右侧速度感笔记线条（青白胶囊） ----------
line_specs = [
    # (x0, y, length, thick, color)
    (W * 0.03, -W * 0.16, W * 0.20, W * 0.052, (255, 255, 255, 235)),
    (W * 0.01,  W * 0.00, W * 0.235, W * 0.052, (224, 246, 255, 245)),
    (-W * 0.06, W * 0.16, W * 0.28, W * 0.052, (255, 255, 255, 220)),
]
for x0, y, ln, th, col in line_specs:
    x1 = x0 + ln
    pts = sheared_rect(x0, y - th / 2, x1, y + th / 2, shear=0.12)
    idraw.polygon(pts, fill=col)
    # 圆角端帽
    r = th / 2
    for ex in (x0, x1):
        px, py = skew_point(ex, y, 0.12)
        idraw.ellipse([px - r, py - r, px + r, py + r], fill=col)

# ---------- 6. 装饰粒子 ----------
for dx, dy, dr, a in [
    (-W * 0.19, -W * 0.30, W * 0.012, 190),
    ( W * 0.29,  W * 0.29, W * 0.015, 175),
    (-W * 0.30,  W * 0.14, W * 0.010, 160),
    ( W * 0.26, -W * 0.30, W * 0.009, 150),
]:
    px, py = cx + dx, cy + dy
    idraw.ellipse([px - dr, py - dr, px + dr, py + dr], fill=(255, 255, 255, a))

final_hi = Image.alpha_composite(bg, icon)
final = final_hi.resize((SIZE, SIZE), resample=Image.Resampling.LANCZOS)

out = Path("scripts/FastNote_logo_raw.png")
final.save(out, format="PNG", optimize=True)
print(f"OK -> {out} {final.size}")
