import os
from PIL import Image

def generate():
    os.makedirs('src-tauri/icons', exist_ok=True)
    os.makedirs('assets', exist_ok=True)

    src_path = 'client/public/favicon.png'
    if not os.path.exists(src_path):
        print(f"Source icon not found at {src_path}")
        return

    src = Image.open(src_path).convert('RGBA')

    # Crop to non-transparent bounding box
    bbox = src.getbbox()
    if bbox:
        src = src.crop(bbox)

    w, h = src.size
    max_dim = max(w, h)

    # Master 1024x1024
    master_size = 1024
    master = Image.new('RGBA', (master_size, master_size), (0, 0, 0, 0))
    scale = master_size / max_dim
    nw, nh = int(round(w * scale)), int(round(h * scale))
    resized = src.resize((nw, nh), Image.Resampling.LANCZOS)
    ox = (master_size - nw) // 2
    oy = (master_size - nh) // 2
    master.paste(resized, (ox, oy), resized)
    master.save('assets/icon.png')
    master.save('src-tauri/icons/icon.png')

    # Standard PNG icons
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

    # Tray icon (prefer dedicated assets/tray-icon.png if present)
    tray_src_path = 'assets/tray-icon.png'
    if os.path.exists(tray_src_path):
        tray_src = Image.open(tray_src_path).convert('RGBA')
        tray_scaled = tray_src.resize((44, 44), Image.Resampling.LANCZOS)
        tray_scaled.save('src-tauri/icons/tray-icon.png')
    else:
        scaled = master.resize((44, 44), Image.Resampling.LANCZOS)
        scaled.save('src-tauri/icons/tray-icon.png')

    # Windows ICO
    ico_sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]
    master.save('src-tauri/icons/icon.ico', format='ICO', sizes=ico_sizes)
    master.save('assets/icon.ico', format='ICO', sizes=ico_sizes)

    # If iconutil (macOS) is available, generate .icns, else create placeholder/copy
    # On non-macOS, pillow can save icns or we can copy/keep a valid icns
    try:
        master.save('src-tauri/icons/icon.icns', format='ICNS')
    except Exception as e:
        print(f"ICNS direct generation notice: {e}")

    print("Icons generated successfully!")

if __name__ == '__main__':
    generate()
