"""Make the sample pieces the runner's other kinds need, from nothing but code (no source material).

python3 code/runner/samples_src/make_samples.py   -> samples/page_a.png, page_b.png, clip_8s.mp4, game_dots.html
Fonts used to draw the pictures: Lato (SIL Open Font License), from the system's font folder. Everything else is drawn here.
"""
import os, subprocess
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, "..", "..", "..", "samples"))
LATO = "/usr/share/fonts/truetype/lato/"
PAPER, INK, SOFT, ACC = (250, 248, 243), (29, 29, 27), (90, 88, 84), (0, 117, 159)


def font(name, size):
    return ImageFont.truetype(LATO + name, size)


def wrap(draw, text, f, width):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=f) <= width:
            cur = t
        else:
            lines.append(cur); cur = w
    if cur:
        lines.append(cur)
    return lines


def page(path, dense):
    W, H = 900, 1400
    im = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(im)
    # a fictional product: a tide clock for a kitchen wall
    d.text((60, 50), "TIDEWATER", font=font("Lato-Black.ttf", 30), fill=INK)
    d.line((60, 100, W - 60, 100), fill=SOFT, width=2)
    if dense:
        d.text((60, 140), "Introducing the Tidewater Tide Clock, the smart", font=font("Lato-Bold.ttf", 38), fill=INK)
        d.text((60, 190), "kitchen companion for coastal living", font=font("Lato-Bold.ttf", 38), fill=INK)
        y = 270
        body = ("Tidewater combines precision lunar timekeeping with a beautifully crafted oak face so you always know where the "
                "water is. Our patented movement tracks the 12 hour 25 minute tidal cycle, while an optional companion app syncs "
                "with over 3,000 harbour stations worldwide. Available in three finishes, two sizes and a limited edition brass "
                "bezel. Free shipping on orders over $80. Thirty day returns. Battery included.")
        for line in wrap(d, body, font("Lato-Regular.ttf", 30), W - 120):
            d.text((60, y), line, font=font("Lato-Regular.ttf", 30), fill=SOFT); y += 44
        y += 30
        for i, label in enumerate(["Shop now", "Learn more", "Compare models"]):
            x = 60 + i * 265
            d.rectangle((x, y, x + 245, y + 74), outline=INK, width=3, fill=PAPER if i else INK)
            d.text((x + 24, y + 20), label, font=font("Lato-Bold.ttf", 28), fill=PAPER if i == 0 else INK)
        cy = y + 160
    else:
        y = 170
        for line in ["Know when the", "tide turns."]:
            d.text((60, y), line, font=font("Lato-Black.ttf", 92), fill=INK); y += 110
        y += 30
        for line in wrap(d, "An oak clock with one hand: it points to high water and low.", font("Lato-Regular.ttf", 38), W - 120):
            d.text((60, y), line, font=font("Lato-Regular.ttf", 38), fill=INK); y += 54
        y += 40
        d.rectangle((60, y, 420, y + 90), fill=INK)
        d.text((92, y + 24), "Buy it: $64", font=font("Lato-Bold.ttf", 38), fill=PAPER)
        cy = y + 170
    # the clock itself, drawn
    cx, r = W // 2, 300
    d.ellipse((cx - r, cy, cx + r, cy + 2 * r), outline=INK, width=6, fill=(244, 238, 226))
    for i in range(12):
        import math
        a = math.pi * 2 * i / 12
        x1, y1 = cx + math.sin(a) * (r - 20), cy + r - math.cos(a) * (r - 20)
        x2, y2 = cx + math.sin(a) * (r - 50), cy + r - math.cos(a) * (r - 50)
        d.line((x1, y1, x2, y2), fill=INK, width=4)
    d.text((cx - 50, cy + 40), "HIGH", font=font("Lato-Bold.ttf", 34), fill=INK)
    d.text((cx - 42, cy + 2 * r - 80), "LOW", font=font("Lato-Bold.ttf", 34), fill=INK)
    d.line((cx, cy + r, cx + 170, cy + r - 150), fill=ACC, width=10)
    d.ellipse((cx - 14, cy + r - 14, cx + 14, cy + r + 14), fill=INK)
    im.save(path, optimize=True)


def clip(path):
    # eight seconds: a sun sets behind a line while one tone falls; drawn by ffmpeg's own filters, nothing sampled
    vf = ("color=c=0xfaf8f3:s=720x1280:d=8:r=24,format=yuv420p,"
          "drawbox=x=0:y=820:w=720:h=460:color=0x1d1d1b@1:t=fill,"
          "drawtext=fontfile=" + LATO + "Lato-Black.ttf:text='A lamp that dims':fontcolor=0x1d1d1b:fontsize=64:x=60:y=120,"
          "drawtext=fontfile=" + LATO + "Lato-Black.ttf:text='with the sunset.':fontcolor=0x1d1d1b:fontsize=64:x=60:y=200,"
          "drawtext=fontfile=" + LATO + "Lato-Regular.ttf:text='%{eif\\:19+t*0.25\\:d}\\:%{eif\\:mod(t*15\\,60)\\:d\\:2}':fontcolor=0xfaf8f3:fontsize=48:x=60:y=900")
    # the sun: a disc that sinks behind the horizon at y=820; chroma planes are half size, so their X and Y are doubled
    inl = "lte(hypot(X-360\\,Y-(560+T*45))\\,120)*lt(Y\\,820)"
    inc = "lte(hypot(2*X-360\\,2*Y-(560+T*45))\\,120)*lt(2*Y\\,820)"
    sun = f"geq=lum='if({inl}\\,178\\,lum(X\\,Y))':cb='if({inc}\\,72\\,cb(X\\,Y))':cr='if({inc}\\,186\\,cr(X\\,Y))'"
    cmd = ["nice", "-n", "15", "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-threads", "2",
           "-f", "lavfi", "-i", vf + "," + sun,
           "-f", "lavfi", "-i", "sine=frequency=330:duration=8,volume=0.25,afade=t=out:st=6:d=2",
           "-c:v", "libx264", "-profile:v", "baseline", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "28",
           "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", "-shortest", path]
    subprocess.run(cmd, check=True)


GAME = r"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dots</title>
<style>
html,body{margin:0;height:100%;background:#faf8f3;color:#1d1d1b;font:600 18px/1.3 -apple-system,"Helvetica Neue",Arial,sans-serif;overflow:hidden;touch-action:manipulation}
#top{position:fixed;left:0;right:0;top:0;display:flex;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #8a8a8a;background:#faf8f3;z-index:2}
#field{position:fixed;inset:48px 0 0 0}
.dot{position:absolute;width:64px;height:64px;margin:-32px 0 0 -32px;border-radius:50%;background:#1d1d1b;border:0;padding:0}
.dot.gold{background:#ffc328}
#msg{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;text-align:center;padding:24px;z-index:3;background:#faf8f3}
#msg button{font:inherit;font-size:22px;padding:14px 28px;border:2px solid #1d1d1b;background:#1d1d1b;color:#faf8f3}
</style></head><body>
<div id="top"><span>Score <b id="score">0</b></span><span><b id="left">30</b> s</span></div>
<div id="field" aria-label="The playing field"></div>
<div id="msg"><h1 style="margin:0;font-size:34px">Dots</h1><p style="margin:0;max-width:22em">Tap each dot before it fades. Gold dots are worth three. Thirty seconds.</p><button id="go" type="button">Start</button></div>
<script>
(function(){var f=document.getElementById("field"),sc=document.getElementById("score"),lf=document.getElementById("left"),msg=document.getElementById("msg");
var score=0,misses=0,t0=0,timer=null,spawn=null,live=[];
function rnd(a,b){return a+Math.random()*(b-a)}
function addDot(){var gold=Math.random()<.18,d=document.createElement("button");d.className="dot"+(gold?" gold":"");d.setAttribute("aria-label",gold?"gold dot":"dot");
var r=f.getBoundingClientRect();d.style.left=rnd(40,r.width-40)+"px";d.style.top=rnd(40,r.height-40)+"px";
var life=Math.max(650,1600-score*12),born=performance.now();d.style.transition="opacity "+life+"ms linear";f.appendChild(d);requestAnimationFrame(function(){d.style.opacity="0.1"});
var k=setTimeout(function(){if(d.parentNode){d.remove();misses++}},life);
d.addEventListener("pointerdown",function(e){e.preventDefault();clearTimeout(k);d.remove();score+=gold?3:1;sc.textContent=score});}
function end(){clearInterval(timer);clearInterval(spawn);f.innerHTML="";msg.style.display="flex";msg.innerHTML='<h1 style="margin:0;font-size:34px">'+score+' points</h1><p style="margin:0">Missed '+misses+'. Now go back and answer.</p>';}
document.getElementById("go").addEventListener("click",function(){msg.style.display="none";score=0;misses=0;sc.textContent="0";t0=performance.now();
timer=setInterval(function(){var left=Math.max(0,30-Math.floor((performance.now()-t0)/1000));lf.textContent=left;if(!left)end()},250);
spawn=setInterval(addDot,Math.max(380,700));addDot();});})();
</script></body></html>
"""

if __name__ == "__main__":
    page(os.path.join(OUT, "page_a.png"), dense=True)
    page(os.path.join(OUT, "page_b.png"), dense=False)
    clip(os.path.join(OUT, "clip_8s.mp4"))
    open(os.path.join(OUT, "game_dots.html"), "w").write(GAME)
    for f in ("page_a.png", "page_b.png", "clip_8s.mp4", "game_dots.html"):
        print(f, os.path.getsize(os.path.join(OUT, f)))
