# -*- coding: utf-8 -*-
"""生成 Android 启动图标（蓝色圆角方块 + 白色「五」字），输出到 phone/android/res/mipmap-*。"""
import os
from PIL import Image, ImageDraw, ImageFont

RES = r"E:\5bts deepseeklearn\phone\android\res"
FONT = r"C:\Windows\Fonts\msyhbd.ttc"

SIZES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}


def make(size: int) -> Image.Image:
    # 4 倍超采样，边缘更顺滑
    ss = 4
    n = size * ss
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))

    # 渐变底：从 #4F83FF 到 #1E4FD8
    grad = Image.new("RGBA", (n, n))
    gd = ImageDraw.Draw(grad)
    c1 = (0x4F, 0x83, 0xFF)
    c2 = (0x1E, 0x4F, 0xD8)
    for y in range(n):
        t = y / max(1, n - 1)
        gd.line(
            [(0, y), (n, y)],
            fill=(
                int(c1[0] + (c2[0] - c1[0]) * t),
                int(c1[1] + (c2[1] - c1[1]) * t),
                int(c1[2] + (c2[2] - c1[2]) * t),
                255,
            ),
        )

    # 圆角遮罩
    mask = Image.new("L", (n, n), 0)
    md = ImageDraw.Draw(mask)
    radius = int(n * 0.22)
    md.rounded_rectangle([0, 0, n - 1, n - 1], radius=radius, fill=255)
    img.paste(grad, (0, 0), mask)

    # 白色「五」
    d = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT, int(n * 0.62))
    ch = "五"
    box = d.textbbox((0, 0), ch, font=font)
    tw, th = box[2] - box[0], box[3] - box[1]
    d.text(
        ((n - tw) / 2 - box[0], (n - th) / 2 - box[1] - n * 0.01),
        ch,
        font=font,
        fill=(255, 255, 255, 255),
    )

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    for folder, px in SIZES.items():
        out_dir = os.path.join(RES, folder)
        os.makedirs(out_dir, exist_ok=True)
        img = make(px)
        path = os.path.join(out_dir, "ic_launcher.png")
        img.save(path, "PNG")
        # 圆形图标（部分启动器用）
        r = img.resize((px, px), Image.LANCZOS)
        mask = Image.new("L", (px, px), 0)
        ImageDraw.Draw(mask).ellipse([0, 0, px - 1, px - 1], fill=255)
        rnd = Image.new("RGBA", (px, px), (0, 0, 0, 0))
        rnd.paste(r, (0, 0), mask)
        rnd.save(os.path.join(out_dir, "ic_launcher_round.png"), "PNG")
        print("wrote", path, px)


if __name__ == "__main__":
    main()
