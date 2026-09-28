#!/usr/bin/env python3
"""
生成 FastNote 文件关联图标源图（1024x1024 透明 PNG）。
文件关联图标语义 = 「一页文档 + FastNote 品牌角标」，与程序主图标区分：
  - 白色圆角纸张 + 右上折角（经典文档隐喻）
  - 左上角叠放 FastNote 品牌方块（渐变 + 白色 F），点明「这是 FastNote 打开的文件」
  - 纸张内几条灰色文字线
后续由 make_file_assoc_icon.py 转成多尺寸 ICO。
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

SIZE = 1024
S = 3
W = SIZE * S
img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# ---------- 文档纸张 ----------
pad = W * 0.14
fold = W * 0.20
page = [
    (pad, W * 0.06),
    (W - pad - fold, W * 0.06),
    (W - pad, W * 0.06 + fold),
    (W - pad, W * 0.94),
    (pad, W * 0.94),
]
# 阴影
sh = Image.new("RGBA", (W, W), (0, 0, 0, 0))
ImageDraw.Draw(sh).polygon(page, fill=(30, 50, 90, 90))
sh = sh.filter(ImageFilter.GaussianBlur(int(10 * S)))
off = Image.new("RGBA", (W, W), (0, 0, 0, 0)); off.paste(sh, (0, int(8 * S)))
img = Image.alpha_composite(img, off)
d = ImageDraw.Draw(img)
# 纸张主体白
d.polygon(page, fill=(255, 255, 255, 255))
d.line(page + [page[0]], fill=(203, 213, 225, 255), width=int(3 * S))
# 折角
fold_tri = [(W - pad - fold, W * 0.06), (W - pad, W * 0.06 + fold), (W - pad - fold, W * 0.06 + fold)]
d.polygon(fold_tri, fill=(226, 232, 240, 255))
d.line(fold_tri + [fold_tri[0]], fill=(203, 213, 225, 255), width=int(3 * S))

# ---------- 文字行 ----------
lx0 = pad + W * 0.10
lx1 = W - pad - W * 0.10
for i, y in enumerate([0.55, 0.63, 0.71, 0.79, 0.87]):
    yy = W * y
    end = lx1 if i not in (0, 4) else lx1 - W * 0.12
    d.rounded_rectangle([lx0, yy - int(6 * S), end, yy + int(6 * S)], radius=int(6 * S), fill=(100, 116, 139, 255))

# ---------- 左上 FastNote 品牌角标 ----------
bx0, by0 = pad - W * 0.02, W * 0.10
bs = W * 0.34
bx1, by1 = bx0 + bs, by0 + bs
brad = int(bs * 0.24)
# 渐变方块
grad = Image.new("RGBA", (int(bs), int(bs)), (0, 0, 0, 0))
gpx = grad.load()
for yy in range(int(bs)):
    t = yy / (bs - 1)
    r = int(30 * (1 - t) + 6 * t)
    g = int(70 * (1 - t) + 165 * t)
    b = int(160 * (1 - t) + 212 * t)
    for xx in range(int(bs)):
        gpx[xx, yy] = (r, g, b, 255)
bmask = Image.new("L", (int(bs), int(bs)), 0)
ImageDraw.Draw(bmask).rounded_rectangle([0, 0, int(bs) - 1, int(bs) - 1], radius=brad, fill=255)
img.paste(grad, (int(bx0), int(by0)), bmask)
d = ImageDraw.Draw(img)
# 方块内白色 F
fcx, fcy = bx0 + bs * 0.5, by0 + bs * 0.5
sw = bs * 0.14
fl = bx0 + bs * 0.30
ft = by0 + bs * 0.24
fb = by0 + bs * 0.76
d.rounded_rectangle([fl, ft, fl + sw, fb], radius=int(sw * 0.35), fill=(255, 255, 255, 255))
d.rounded_rectangle([fl, ft, fl + bs * 0.42, ft + sw], radius=int(sw * 0.35), fill=(255, 255, 255, 255))
d.rounded_rectangle([fl, fcy - sw * 0.5, fl + bs * 0.30, fcy + sw * 0.5], radius=int(sw * 0.35), fill=(255, 255, 255, 255))

final = img.resize((SIZE, SIZE), resample=Image.Resampling.LANCZOS)
out = Path("scripts/FastNote_fileicon_raw.png")
final.save(out, format="PNG", optimize=True)
print(f"OK -> {out} {final.size}")
