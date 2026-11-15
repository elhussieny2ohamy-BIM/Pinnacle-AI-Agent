import subprocess
import json
import sys
import os
import time

server_exe = r"$env:LOCALAPPDATA\NavisHelper\McpServer\NavisHelper.McpServer.exe".replace("$env:LOCALAPPDATA", os.environ.get("LOCALAPPDATA", ""))

print(f"Server exe: {server_exe}")
print(f"Exists: {os.path.exists(server_exe)}")

init_msg = json.dumps({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-12","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}) + "\r\n"
list_msg = json.dumps({"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}) + "\r\n"

try:
    proc = subprocess.run(
        [server_exe],
        input=(init_msg + list_msg).encode("utf-8"),
        capture_output=True,
        timeout=15
    )
    stdout_text = proc.stdout.decode("utf-8", errors="replace").strip()
    print(f"Return code: {proc.returncode}")
    print(f"Stdout bytes: {len(proc.stdout)}")
    for line in stdout_text.split("\r\n"):
        line = line.strip()
        if line:
            try:
                msg = json.loads(line)
                if msg.get("id") == 1:
                    si = msg.get("result", {}).get("serverInfo", {})
                    print(f"  Initialize OK: {si.get('name')} v{si.get('version')}")
                elif msg.get("id") == 2:
                    tools = msg.get("result", {}).get("tools", [])
                    print(f"  tools/list: {len(tools)} tools")
                    for t in tools[:8]:
                        print(f"    - {t.get('name')}: {t.get('description', '')[:60]}")
                    if len(tools) > 8:
                        print(f"    ... and {len(tools) - 8} more")
            except json.JSONDecodeError:
                if line.startswith("{"):
                    print(f"  Non-JSON: {line[:100]}")
    if proc.stderr:
        stderr = proc.stderr.decode("utf-8", errors="replace").strip()
        if stderr:
            print(f"  Stderr (last 300): {stderr[-300:]}")
except Exception as e:
    print(f"ERROR: {e}")
