import subprocess
import json
import sys

server_exe = r"C:\Users\elhussieny.mohamed\AppData\Local\Bimwright\rvt-mcp\server\current\rvt-mcp.exe"

# Test 1: Check server starts and responds to initialize
init_request = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
        "protocolVersion": "2025-06-12",
        "capabilities": {},
        "clientInfo": {"name": "test", "version": "1.0"}
    }
}

try:
    proc = subprocess.run(
        [server_exe],
        input=json.dumps(init_request) + "\n",
        capture_output=True,
        text=True,
        timeout=10
    )
    print("=== rvt-mcp initialize ===")
    print(f"Return code: {proc.returncode}")
    print(f"Stdout: {proc.stdout[:500]}")
    if proc.stderr:
        print(f"Stderr: {proc.stderr[:500]}")
except Exception as e:
    print(f"ERROR: {e}")
