import os
import io
import base64
import subprocess
import shutil
from PIL import Image

def generate():
    os.makedirs('src-tauri/icons', exist_ok=True)
    os.makedirs('assets', exist_ok=True)
    os.makedirs('client/public', exist_ok=True)

    src_candidates = [
        'assets/icon-source.png',
        '.raft/attachments/att-1790719645455-bc126cc8_image__10_.png',
        'client/public/favicon.png',
    ]

    src_path = None
    for cand in src_candidates:
        if os.path.exists(cand):
            src_path = cand
            break

    if not src_path:
        print(f"Source icon not found in candidates: {src_candidates}")
        return

    print(f"Using source icon: {src_path}")
    src = Image.open(src_path).convert('RGBA')

    # Crop to non-transparent bounding box
    bbox = src.getbbox()
    if bbox:
        src = src.crop(bbox)

    w, h = src.size
    max_dim = max(w, h)

    # Master 1024x1024 with 5% breathing room
    master_size = 1024
    target_dim = int(master_size * 0.90) # 921px
    scale = target_dim / max_dim
    nw, nh = int(round(w * scale)), int(round(h * scale))
    resized = src.resize((nw, nh), Image.Resampling.LANCZOS)

    master = Image.new('RGBA', (master_size, master_size), (0, 0, 0, 0))
    ox = (master_size - nw) // 2
    oy = (master_size - nh) // 2
    master.paste(resized, (ox, oy), resized)

    # Save master icons
    master.save('assets/icon.png')
    master.save('src-tauri/icons/icon.png')

    # Client web assets
    logo_512 = master.resize((512, 512), Image.Resampling.LANCZOS)
    logo_512.save('client/public/logo.png')

    fav_128 = master.resize((128, 128), Image.Resampling.LANCZOS)
    fav_128.save('client/public/favicon.png')

    # client/public/favicon.ico
    fav_ico_sizes = [(64, 64), (48, 48), (32, 32), (16, 16)]
    master.save('client/public/favicon.ico', format='ICO', sizes=fav_ico_sizes)

    # client/public/favicon.svg (embedded 128x128 PNG)
    buffer = io.BytesIO()
    fav_128.save(buffer, format='PNG')
    b64_png = base64.b64encode(buffer.getvalue()).decode('ascii')
    svg_content = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <image width="128" height="128" href="data:image/png;base64,{b64_png}" />
</svg>
'''
    with open('client/public/favicon.svg', 'w', encoding='utf-8') as f:
        f.write(svg_content)

    # Standard PNG icons for Tauri
    png_sizes = [
        (32, 32, 'src-tauri/icons/32x32.png'),
        (64, 64, 'src-tauri/icons/64x64.png'),
        (128, 128, 'src-tauri/icons/128x128.png'),
        (256, 256, 'src-tauri/icons/128x128@2x.png'),
        (30, 30, 'src-tauri/icons/Square30x30Logo.png'),
        (44, 44, 'src-tauri/icons/Square44x44Logo.png'),
        (71, 71, 'src-tauri/icons/Square71x71Logo.png'),
        (89, 89, 'src-tauri/icons/Square89x89Logo.png'),
        (107, 107, 'src-tauri/icons/Square107x107Logo.png'),
        (142, 142, 'src-tauri/icons/Square142x142Logo.png'),
        (150, 150, 'src-tauri/icons/Square150x150Logo.png'),
        (284, 284, 'src-tauri/icons/Square284x284Logo.png'),
        (310, 310, 'src-tauri/icons/Square310x310Logo.png'),
        (50, 50, 'src-tauri/icons/StoreLogo.png'),
    ]

    for tw, th, out in png_sizes:
        scaled = master.resize((tw, th), Image.Resampling.LANCZOS)
        scaled.save(out)

    # Tray icon (44x44 for retina status bar)
    tray_source = 'assets/tray-icon-source.png'
    if os.path.exists(tray_source):
        tray_src = Image.open(tray_source).convert('RGBA')
        r, g, b, a = tray_src.split()
        a = a.point(lambda p: 0 if p <= 5 else p)
        white = Image.new('L', tray_src.size, 255)
        cleaned = Image.merge('RGBA', (white, white, white, a))
        bbox = cleaned.getbbox()
        if bbox:
            cropped = cleaned.crop(bbox)
            h = 34
            w = int(round(h * cropped.width / cropped.height))
            resized = cropped.resize((w, h), Image.Resampling.LANCZOS)
            tray_44 = Image.new('RGBA', (44, 44), (0, 0, 0, 0))
            ox = (44 - w) // 2
            oy = (44 - h) // 2
            tray_44.paste(resized, (ox, oy), resized)
        else:
            tray_44 = Image.new('RGBA', (44, 44), (0, 0, 0, 0))
    else:
        tray_44 = master.resize((44, 44), Image.Resampling.LANCZOS)
    tray_44.save('src-tauri/icons/tray-icon.png')
    tray_44.save('assets/tray-icon.png')

    # Windows ICO
    ico_sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]
    master.save('src-tauri/icons/icon.ico', format='ICO', sizes=ico_sizes)
    master.save('assets/icon.ico', format='ICO', sizes=ico_sizes)

    # macOS .icns via iconutil
    iconset_dir = 'src-tauri/icons/icon.iconset'
    os.makedirs(iconset_dir, exist_ok=True)
    icns_sizes = [
        (16, 1, 'icon_16x16.png'),
        (16, 2, 'icon_16x16@2x.png'),
        (32, 1, 'icon_32x32.png'),
        (32, 2, 'icon_32x32@2x.png'),
        (128, 1, 'icon_128x128.png'),
        (128, 2, 'icon_128x128@2x.png'),
        (256, 1, 'icon_256x256.png'),
        (256, 2, 'icon_256x256@2x.png'),
        (512, 1, 'icon_512x512.png'),
        (512, 2, 'icon_512x512@2x.png'),
    ]

    # macOS icon: Apple icon grid -- 824px white rounded tile centered on a transparent
    # 1024 canvas (macOS does not mask .icns files itself), artwork inset inside the tile.
    from PIL import ImageDraw
    tile = 824
    ss = 4  # supersample for smooth tile edges
    mask = Image.new('L', (tile * ss, tile * ss), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, tile * ss - 1, tile * ss - 1), radius=int(tile * 0.2237) * ss, fill=255)
    mask = mask.resize((tile, tile), Image.Resampling.LANCZOS)
    tile_img = Image.new('RGBA', (tile, tile), (255, 255, 255, 255))
    mac_src = src.crop(src.getchannel('A').point(lambda p: 255 if p > 32 else 0).getbbox())
    art_dim = int(tile * 0.72)
    mac_scale = art_dim / max(mac_src.size)
    mw, mh = int(round(mac_src.width * mac_scale)), int(round(mac_src.height * mac_scale))
    mac_art = mac_src.resize((mw, mh), Image.Resampling.LANCZOS)
    tile_img.paste(mac_art, ((tile - mw) // 2, (tile - mh) // 2), mac_art)
    tile_img.putalpha(mask)
    mac_master = Image.new('RGBA', (master_size, master_size), (0, 0, 0, 0))
    mac_master.paste(tile_img, ((master_size - tile) // 2, (master_size - tile) // 2), tile_img)

    for size, factor, filename in icns_sizes:
        dim = size * factor
        s = mac_master.resize((dim, dim), Image.Resampling.LANCZOS)
        s.save(os.path.join(iconset_dir, filename))

    iconutil_path = shutil.which('iconutil')
    if iconutil_path:
        try:
            subprocess.run(['iconutil', '-c', 'icns', iconset_dir, '-o', 'src-tauri/icons/icon.icns'], check=True)
            print("Generated src-tauri/icons/icon.icns using iconutil")
        except Exception as e:
            print(f"iconutil failed: {e}, falling back to PIL")
            mac_master.save('src-tauri/icons/icon.icns', format='ICNS')
    else:
        try:
            mac_master.save('src-tauri/icons/icon.icns', format='ICNS')
        except Exception as e:
            print(f"PIL ICNS notice: {e}")

    # Clean up temporary iconset
    shutil.rmtree(iconset_dir, ignore_errors=True)

    print("All icons successfully generated for web, app, tray, and desktop!")

if __name__ == '__main__':
    generate()
