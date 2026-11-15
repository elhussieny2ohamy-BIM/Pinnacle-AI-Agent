import subprocess
import json
import os
import time

server_exe = os.path.join(os.environ.get("LOCALAPPDATA", ""), r"NavisHelper\McpServer\NavisHelper.McpServer.exe")

def mcp_message(obj):
    payload = json.dumps(obj).encode("utf-8")
    header = f"Content-Length: {len(payload)}\r\n\r\n".encode("utf-8")
    return header + payload

init_msg = {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-12","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}
list_msg = {"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}

input_bytes = b"".join(mcp_message(m) for m in [init_msg, list_msg])

print(f"Server exe: {server_exe}")
print(f"Exists: {os.path.exists(server_exe)}")

try:
    proc = subprocess.Popen(
        [server_exe],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE
    )
    proc.stdin.write(input_bytes)
    proc.stdin.flush()
    proc.stdin.close()
    time.sleep(3)
    stdout, stderr = proc.communicate(timeout=10)
    
    stdout_text = stdout.decode("utf-8", errors="replace").strip()
    print(f"Return code: {proc.returncode}")
    print(f"Stdout bytes: {len(stdout)}")
    if stdout_text:
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
                except json.JSONDecodeError:
                    pass
    else:
        print("  No stdout")
    
    if stderr:
        stderr_text = stderr.decode("utf-8", errors="replace").strip()
        if stderr_text:
            print(f"  Stderr (last 300): {stderr_text[-300:]}")
except Exception as e:
    print(f"ERROR: {e}")
