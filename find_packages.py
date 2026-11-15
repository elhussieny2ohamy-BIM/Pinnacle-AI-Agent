import os
site = r"C:\Users\elhussieny.mohamed\AppData\Local\Programs\Python\Python313\Lib\site-packages"

print("=== Directories matching autocad/rhino ===")
for name in os.listdir(site):
    lower = name.lower()
    if "autocad" in lower or "rhino" in lower:
        print(f"  {name}")

print("\n=== dist-info matching autocad/rhino ===")
for name in os.listdir(site):
    lower = name.lower()
    if "autocad" in lower or "rhino" in lower:
        if name.endswith(".dist-info") or name.endswith(".egg-info"):
            print(f"  {name}")

print("\n=== Checking for autocad_mcp_pro module ===")
mod_path = os.path.join(site, "autocad_mcp_pro")
print(f"  autocad_mcp_pro exists: {os.path.isdir(mod_path)}")

print("\n=== Checking for rhino_mcp module ===")
mod_path = os.path.join(site, "rhino_mcp")
print(f"  rhino_mcp exists: {os.path.isdir(mod_path)}")

print("\n=== Checking entry points ===")
import importlib.metadata as metadata
for ep in metadata.entry_points(group="console_scripts"):
    if "autocad" in ep.name.lower() or "rhino" in ep.name.lower():
        print(f"  {ep.name} = {ep.value}")
