import os, sys
from PIL import Image, ImageDraw, ImageFont, ImageOps
import qrcode
from qrcode.constants import ERROR_CORRECT_H

URL = sys.argv[1]; NAME = sys.argv[2]; ROLE = sys.argv[3]; OUT = sys.argv[4]
W, H = 1170, 2532
BG = (10, 10, 10)
WHITE = (245, 240, 232)
MUTED = (200, 176, 144)   # C8B090 brand warm
DIM = (120, 112, 100)
F = os.path.expanduser("~/.fonts/")
corm = lambda s, w=400: ImageFont.truetype(F + f"cormorant-garamond-latin-{w}-normal.ttf", s)
lato = lambda s, w=400: ImageFont.truetype(F + f"lato-latin-{w}-normal.ttf", s)

im = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(im)

def spaced(text, y, font, fill, sp, cx=W / 2):
    widths = [d.textlength(ch, font=font) for ch in text]
    total = sum(widths) + sp * (len(text) - 1)
    x = cx - total / 2
    for ch, w in zip(text, widths):
        d.text((x, y), ch, font=font, fill=fill)
        x += w + sp
    return total

# script logo (white)
logo = Image.open("script_logo.png").convert("RGBA")
lw = 560; logo = logo.resize((lw, int(logo.height * lw / logo.width)), Image.LANCZOS)
im.paste(logo, ((W - lw) // 2, 330), logo)

# name + role
nm = NAME.upper(); fs = 96 if len(nm) <= 13 else 84
spaced(nm, 700 + (96-fs)//2, corm(fs, 500), WHITE, 14 if len(nm) <= 13 else 11)
spaced(ROLE.upper(), 830, lato(30 if len(ROLE) <= 26 else 26, 400), MUTED, 9 if len(ROLE) <= 26 else 7)
spaced("Bodega Dos Búhos  ·  San Miguel de Allende, México", 892, corm(40, 400), DIM, 1)

# QR with monogram in the centre
qr = qrcode.QRCode(error_correction=ERROR_CORRECT_H, box_size=20, border=0)
qr.add_data(URL); qr.make(fit=True)
q = qr.make_image(fill_color=(10, 10, 10), back_color=(255, 255, 255)).convert("RGB")
side = 660; q = q.resize((side, side), Image.NEAREST)
card_side = 780; r = 36
panel = Image.new("RGB", (card_side, card_side), (255, 255, 255))
mask = Image.new("L", (card_side, card_side), 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, card_side - 1, card_side - 1), r, fill=255)
panel.paste(q, ((card_side - side) // 2, (card_side - side) // 2))
# monogram knockout in the middle
mono = Image.open("monogram.png").convert("RGBA")
mh = 150; mono = mono.resize((int(mono.width * mh / mono.height), mh), Image.LANCZOS)
pad = 26
bx = (card_side - mono.width) // 2 - pad; by = (card_side - mh) // 2 - pad
ImageDraw.Draw(panel).rectangle((bx, by, bx + mono.width + 2 * pad, by + mh + 2 * pad), fill=(255, 255, 255))
panel.paste(mono, ((card_side - mono.width) // 2, (card_side - mh) // 2), mono)
qy = 1090
im.paste(panel, ((W - card_side) // 2, qy), mask)

# caption under QR
spaced("SCAN FOR WINES, VISITS & CONTACT", qy + card_side + 70, lato(26, 400), MUTED, 7)
spaced(URL.replace("https://", ""), qy + card_side + 130, lato(24, 300), DIM, 2)

# footer
spaced("DOSBUHOS.COM", H - 230, lato(26, 400), WHITE, 9)
spaced("Mejores vinos para un mejor mundo", H - 170, corm(34, 400), DIM, 1)

im.save(OUT)
print("saved", URL)
