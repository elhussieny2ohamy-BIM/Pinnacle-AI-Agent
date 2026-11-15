import subprocess
import json

server_exe = r"C:\Users\elhussieny.mohamed\AppData\Local\Bimwright\rvt-mcp\server\current\rvt-mcp.exe"

# Send initialize, then tools/list
messages = [
    {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-12", "capabilities": {}, "clientInfo": {"name": "test", "version": "1.0"}}},
    {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
]

input_text = "\n".join(json.dumps(m) for m in messages) + "\n"

try:
    proc = subprocess.run(
        [server_exe],
        input=input_text,
        capture_output=True,
        text=True,
        timeout=15
    )
    print("=== rvt-mcp tools/list ===")
    print(f"Return code: {proc.returncode}")
    lines = proc.stdout.strip().split("\n")
    for line in lines:
        if line.strip():
            try:
                msg = json.loads(line)
                if msg.get("id") == 2:
                    tools = msg.get("result", {}).get("tools", [])
                    print(f"Tools count: {len(tools)}")
                    for t in tools[:10]:
                        print(f"  - {t.get('name')}: {t.get('description', '')[:80]}")
                    if len(tools) > 10:
                        print(f"  ... and {len(tools) - 10} more")
                else:
                    print(f"Response id={msg.get('id')}: {msg.get('result', {}).get('serverInfo', {})}")
            except json.JSONDecodeError:
                print(f"Non-JSON line: {line[:100]}")
    if proc.stderr:
        print(f"\nStderr (last 300): {proc.stderr[-300:]}")
except Exception as e:
    print(f"ERROR: {e}")
