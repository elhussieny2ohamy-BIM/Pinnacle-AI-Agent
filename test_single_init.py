import subprocess
import json
import sys
import os
import time

def test_server_init(name, cmd, cwd, env_vars=None, use_http=False, port=9999):
    env = os.environ.copy()
    if env_vars:
        env.update(env_vars)

    if use_http:
        cmd = cmd + ["--http", str(port)]
        print(f"\n{'='*60}")
        print(f"Testing: {name} (HTTP SSE on port {port})")
        print(f"{'='*60}")
        proc = subprocess.Popen(cmd, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        time.sleep(3)
        # Try to connect via HTTP
        import urllib.request
        try:
            req = urllib.request.Request(f"http://127.0.0.1:{port}/mcp", data=json.dumps({
                "jsonrpc": "2.0", "id": 1, "method": "initialize",
                "params": {"protocolVersion": "2025-06-12", "capabilities": {}, "clientInfo": {"name": "test", "version": "1.0"}}
            }).encode(), headers={"Content-Type": "application/json", "Accept": "application/json, text/event-stream"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                body = resp.read().decode("utf-8")
                print(f"HTTP status: {resp.status}")
                print(f"Response: {body[:1000]}")
        except Exception as e:
            print(f"HTTP ERROR: {e}")
        proc.terminate()
        proc.wait(timeout=5)
        stdout, stderr = proc.communicate()
        if stderr:
            print(f"Stderr: {stderr[-500:]}")
        return

    print(f"\n{'='*60}")
    print(f"Testing: {name} (stdio)")
    print(f"{'='*60}")

    init_msg = {
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {"protocolVersion": "2025-06-12", "capabilities": {}, "clientInfo": {"name": "test", "version": "1.0"}}
    }
    payload = json.dumps(init_msg).encode("utf-8")
    header = f"Content-Length: {len(payload)}\r\n\r\n".encode("utf-8")
    input_bytes = header + payload

    try:
        proc = subprocess.Popen(cmd, cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
        stdout, stderr = proc.communicate(input=input_bytes, timeout=10)

        print(f"Return code: {proc.returncode}")
        print(f"Stdout bytes: {len(stdout)}")
        if stdout:
            print(f"Stdout raw: {stdout[:500]}")
        if stderr:
            print(f"Stderr (last 300): {stderr.decode('utf-8', errors='replace')[-300:]}")
    except Exception as e:
        print(f"ERROR: {e}")

# Test autocad-mcp init only
test_server_init(
    "autocad-mcp (ezdxf)",
    [sys.executable, "server.py"],
    cwd=r"D:\OPENCODE\MCPs\Autocad-MCP-main",
    env_vars={"AUTOCAD_MCP_BACKEND": "ezdxf"}
)

# Test rhino-mcp init only
test_server_init(
    "rhino-mcp (standalone)",
    [sys.executable, "src/rhino_mcp/server.py"],
    cwd=r"D:\OPENCODE\MCPs\rhino-mcp-main",
    env_vars={"PYTHONPATH": r"D:\OPENCODE\MCPs\rhino-mcp-main\src"}
)
