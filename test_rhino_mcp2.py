import subprocess
import json
import sys
import os

server_dir = r"D:\OPENCODE\MCPs\rhino-mcp-main"

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
        [sys.executable, "src/rhino_mcp/server.py"],
        cwd=server_dir,
        input=json.dumps(init_request) + "\n",
        capture_output=True,
        text=True,
        timeout=15
    )
    print("=== rhino-mcp initialize ===")
    print(f"Return code: {proc.returncode}")
    print(f"Stdout: {proc.stdout[:1000]}")
    if proc.stderr:
        print(f"Stderr (first 500): {proc.stderr[:500]}")
except Exception as e:
    print(f"ERROR: {e}")
