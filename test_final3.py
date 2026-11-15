import subprocess
import json
import sys
import os
import time
import urllib.request

# ============================================================
# autocad-mcp: Popen with longer wait for tools/list
# ============================================================
print("\n" + "="*60)
print("autocad-mcp: tools/list via Popen")
print("="*60)

server_dir = r"D:\OPENCODE\MCPs\Autocad-MCP-main"
env = os.environ.copy()
env["AUTOCAD_MCP_BACKEND"] = "ezdxf"

init_msg = json.dumps({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}) + "\r\n"
list_msg = json.dumps({"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}) + "\r\n"

proc = subprocess.Popen(
    [sys.executable, "server.py"],
    cwd=server_dir,
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    env=env
)

proc.stdin.write(init_msg.encode("utf-8"))
proc.stdin.flush()
time.sleep(1)

proc.stdin.write(list_msg.encode("utf-8"))
proc.stdin.flush()
proc.stdin.close()

time.sleep(3)
stdout, stderr = proc.communicate(timeout=10)

stdout_text = stdout.decode("utf-8", errors="replace").strip()
print(f"Return code: {proc.returncode}")
print(f"Stdout bytes: {len(stdout)}")

json_count = 0
for line in stdout_text.split("\r\n"):
    line = line.strip()
    if line:
        try:
            msg = json.loads(line)
            json_count += 1
            if msg.get("id") == 1:
                si = msg.get("result", {}).get("serverInfo", {})
                print(f"  Initialize OK: {si.get('name')} v{si.get('version')}")
            elif msg.get("id") == 2:
                tools = msg.get("result", {}).get("tools", [])
                print(f"  tools/list: {len(tools)} tools")
                for t in tools[:10]:
                    print(f"    - {t.get('name')}: {t.get('description', '')[:60]}")
                if len(tools) > 10:
                    print(f"    ... and {len(tools) - 10} more")
        except json.JSONDecodeError:
            pass

print(f"  JSON messages: {json_count}")

if stderr:
    stderr_text = stderr.decode("utf-8", errors="replace").strip()
    if stderr_text:
        print(f"  Stderr (last 200): {stderr_text[-200:]}")

# ============================================================
# rvt-mcp: tools/list via HTTP SSE
# ============================================================
print("\n" + "="*60)
print("rtv-mcp: tools/list via HTTP SSE")
print("="*60)

rvt_exe = r"C:\Users\elhussieny.mohamed\AppData\Local\Bimwright\rvt-mcp\server\current\rvt-mcp.exe"
proc = subprocess.Popen([rvt_exe, "--http", "9998"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
time.sleep(4)

try:
    # Send initialize via POST
    init_data = json.dumps({
        "jsonrpc":"2.0","id":1,"method":"initialize",
        "params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}
    }).encode()
    req = urllib.request.Request("http://127.0.0.1:9998/", data=init_data,
        headers={"Content-Type":"application/json","Accept":"text/event-stream"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        body = resp.read().decode("utf-8")
        print(f"  Initialize HTTP {resp.status}")
        # Parse SSE data
        for line in body.split("\n"):
            if line.startswith("data: "):
                try:
                    msg = json.loads(line[6:])
                    if msg.get("id") == 1:
                        si = msg.get("result", {}).get("serverInfo", {})
                        print(f"  Initialize OK: {si.get('name')} v{si.get('version')}")
                except:
                    pass
except Exception as e:
    print(f"  Initialize ERROR: {e}")

# Send tools/list
try:
    list_data = json.dumps({"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}).encode()
    req = urllib.request.Request("http://127.0.0.1:9998/", data=list_data,
        headers={"Content-Type":"application/json","Accept":"text/event-stream"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        body = resp.read().decode("utf-8")
        print(f"  tools/list HTTP {resp.status}")
        tool_count = 0
        for line in body.split("\n"):
            if line.startswith("data: "):
                try:
                    msg = json.loads(line[6:])
                    if msg.get("id") == 2:
                        tools = msg.get("result", {}).get("tools", [])
                        tool_count = len(tools)
                        print(f"  tools/list: {tool_count} tools")
                        for t in tools[:10]:
                            print(f"    - {t.get('name')}: {t.get('description', '')[:60]}")
                        if tool_count > 10:
                            print(f"    ... and {tool_count - 10} more")
                except:
                    pass
except Exception as e:
    print(f"  tools/list ERROR: {e}")

proc.terminate()
try:
    proc.wait(timeout=5)
except:
    proc.kill()
