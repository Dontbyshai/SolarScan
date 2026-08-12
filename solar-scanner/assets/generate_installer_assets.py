import os
from PIL import Image

def generate_assets():
    logo_path = 'logo.png'
    if not os.path.exists(logo_path):
        print("Logo not found!")
        return

    # Open logo
    logo = Image.open(logo_path).convert("RGBA")

    # 1. Generate DMG Background (Mac)
    # Standard DMG background is usually 540x380
    dmg_bg = Image.new("RGBA", (540, 380), (255, 255, 255, 255))
    
    # Resize logo to fit nicely on the left (e.g., 200x200)
    # The default layout puts the App icon at x=130, and the Applications folder at x=410
    # Let's put a subtle watermark in the background instead so it doesn't clash with the icons
    dmg_logo = logo.copy()
    dmg_logo.thumbnail((250, 250), Image.Resampling.LANCZOS)
    
    # Make it semi-transparent
    alpha = dmg_logo.split()[3]
    alpha = alpha.point(lambda p: p * 0.1) # 10% opacity
    dmg_logo.putalpha(alpha)
    
    # Paste in center
    x = (540 - dmg_logo.width) // 2
    y = (380 - dmg_logo.height) // 2
    dmg_bg.paste(dmg_logo, (x, y), dmg_logo)
    
    dmg_bg.save("dmg-background.png")
    print("Created dmg-background.png")

    # 2. Generate NSIS Installer Sidebar (Windows) - must be exactly 164x314 BMP
    sidebar = Image.new("RGB", (164, 314), (255, 255, 255))
    
    # Resize logo to fit the sidebar width with some padding
    sidebar_logo = logo.copy()
    sidebar_logo.thumbnail((140, 140), Image.Resampling.LANCZOS)
    
    # Paste near the top or center
    x = (164 - sidebar_logo.width) // 2
    y = 20 # 20px from top
    
    # Paste using the logo's alpha channel as a mask, onto the white background
    sidebar.paste(sidebar_logo, (x, y), sidebar_logo)
    
    sidebar.save("installer-sidebar.bmp", format="BMP")
    print("Created installer-sidebar.bmp")

if __name__ == "__main__":
    generate_assets()
