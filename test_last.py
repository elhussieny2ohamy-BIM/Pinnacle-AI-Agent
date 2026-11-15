import subprocess
import json
import sys
import os
import time

# ============================================================
# autocad-mcp: print raw stdout
# ============================================================
print("\n" + "="*60)
print("autocad-mcp: raw stdout")
print("="*60)

server_dir = r"D:\OPENCODE\MCPs\Autocad-MCP-main"
env = os.environ.copy()
env["AUTOCAD_MCP_BACKEND"] = "ezdxf"

init_msg = json.dumps({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}) + "\r\n"
list_msg = json.dumps({"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}) + "\r\n"

proc = subprocess.run(
    [sys.executable, "server.py"],
    cwd=server_dir,
    input=(init_msg + list_msg).encode("utf-8"),
    capture_output=True,
    timeout=15,
    env=env
)
stdout_text = proc.stdout.decode("utf-8", errors="replace").strip()
print(f"Stdout length: {len(stdout_text)}")
print(f"Stdout repr (first 500): {repr(stdout_text[:500])}")

# ============================================================
# rvt-mcp: try HTTP with different endpoints
# ============================================================
print("\n" + "="*60)
print("rtv-mcp: HTTP endpoint discovery")
print("="*60)

rvt_exe = r"C:\Users\elhussieny.mohamed\AppData\Local\Bimwright\rvt-mcp\server\current\rvt-mcp.exe"
proc = subprocess.Popen([rvt_exe, "--http", "9997"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
time.sleep(4)

import urllib.request
import urllib.error

endpoints = [
    "http://127.0.0.1:9997/",
    "http://127.0.0.1:9997/mcp",
    "http://127.0.0.1:9997/sse",
    "http://127.0.0.1:9997/mcp/sse",
]

for ep in endpoints:
    try:
        req = urllib.request.Request(ep, data=json.dumps({
            "jsonrpc":"2.0","id":1,"method":"initialize",
            "params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}
        }).encode(), headers={"Content-Type":"application/json","Accept":"application/json, text/event-stream"})
        with urllib.request.urlopen(req, timeout=8) as resp:
            body = resp.read().decode("utf-8")
            print(f"  {ep} -> HTTP {resp.status}: {body[:200]}")
            break
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:200]
        print(f"  {ep} -> HTTP {e.code}: {body[:100]}")
    except Exception as e:
        print(f"  {ep} -> ERROR: {e}")

proc.terminate()
try:
    proc.wait(timeout=5)
except:
    proc.kill()

stderr = proc.stderr.read()
if stderr:
    print(f"\nStderr (last 300): {stderr[-300:]}")
