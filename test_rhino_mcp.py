import subprocess
import json
import os
import sys

server_dir = r"D:\OPENCODE\MCPs\rhino-mcp-main"

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

env = os.environ.copy()

try:
    proc = subprocess.run(
        [sys.executable, "-m", "rhino_mcp.server"],
        cwd=server_dir,
        input=json.dumps(init_request) + "\n",
        capture_output=True,
        text=True,
        timeout=15,
        env=env
    )
    print("=== rhino-mcp initialize ===")
    print(f"Return code: {proc.returncode}")
    print(f"Stdout: {proc.stdout[:1000]}")
    if proc.stderr:
        print(f"Stderr (first 500): {proc.stderr[:500]}")
except Exception as e:
    print(f"ERROR: {e}")
