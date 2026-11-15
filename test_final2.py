import subprocess
import json
import sys
import os
import time

def test_server_full(name, cmd, cwd, env_vars=None, protocol="2025-11-25"):
    env = os.environ.copy()
    if env_vars:
        env.update(env_vars)

    print(f"\n{'='*60}")
    print(f"Testing: {name}")
    print(f"{'='*60}")

    init_msg = json.dumps({
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {"protocolVersion": protocol, "capabilities": {}, "clientInfo": {"name": "test", "version": "1.0"}}
    }) + "\r\n"

    list_msg = json.dumps({
        "jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}
    }) + "\r\n"

    try:
        proc = subprocess.Popen(cmd, cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)

        # Send initialize
        proc.stdin.write(init_msg.encode("utf-8"))
        proc.stdin.flush()
        time.sleep(1)

        # Read initialize response (non-blocking, short)
        import select
        init_resp = b""
        deadline = time.time() + 5
        while time.time() < deadline:
            if proc.stdout and proc.stdout.readable():
                try:
                    chunk = proc.stdout.read1(4096)
                    if chunk:
                        init_resp += chunk
                        if b"\r\n" in init_resp:
                            break
                except Exception:
                    break
            if proc.poll() is not None:
                break

        # Parse init response
        init_text = init_resp.decode("utf-8", errors="replace").strip()
        for line in init_text.split("\r\n"):
            line = line.strip()
            if line:
                try:
                    msg = json.loads(line)
                    if msg.get("id") == 1:
                        si = msg.get("result", {}).get("serverInfo", {})
                        print(f"  Initialize OK: {si.get('name')} v{si.get('version')}")
                except:
                    pass

        # Send tools/list
        proc.stdin.write(list_msg.encode("utf-8"))
        proc.stdin.flush()
        proc.stdin.close()

        # Read tools/list response
        time.sleep(2)
        list_resp = b""
        deadline = time.time() + 8
        while time.time() < deadline:
            if proc.stdout and proc.stdout.readable():
                try:
                    chunk = proc.stdout.read1(4096)
                    if chunk:
                        list_resp += chunk
                except Exception:
                    break
            if proc.poll() is not None:
                # Process ended, read remaining
                remaining = proc.stdout.read()
                if remaining:
                    list_resp += remaining
                break

        list_text = list_resp.decode("utf-8", errors="replace").strip()
        tool_count = 0
        for line in list_text.split("\r\n"):
            line = line.strip()
            if line:
                try:
                    msg = json.loads(line)
                    if msg.get("id") == 2:
                        tools = msg.get("result", {}).get("tools", [])
                        tool_count = len(tools)
                        print(f"  tools/list: {tool_count} tools")
                        for t in tools[:8]:
                            print(f"    - {t.get('name')}: {t.get('description', '')[:60]}")
                        if tool_count > 8:
                            print(f"    ... and {tool_count - 8} more")
                except:
                    pass

        if tool_count == 0 and list_text:
            print(f"  Raw stdout (first 300): {list_text[:300]}")

        proc.wait(timeout=5)
        print(f"  Return code: {proc.returncode}")

        stderr = proc.stderr.read()
        if stderr.strip():
            print(f"  Stderr (last 150): {stderr.decode('utf-8', errors='replace').strip()[-150:]}")

    except Exception as e:
        print(f"  ERROR: {e}")

# Test autocad-mcp (ezdxf)
test_server_full(
    "autocad-mcp (ezdxf)",
    [sys.executable, "server.py"],
    cwd=r"D:\OPENCODE\MCPs\Autocad-MCP-main",
    env_vars={"AUTOCAD_MCP_BACKEND": "ezdxf"}
)

# Test rhino-mcp (standalone)
test_server_full(
    "rhino-mcp (standalone)",
    [sys.executable, "src/rhino_mcp/server.py"],
    cwd=r"D:\OPENCODE\MCPs\rhino-mcp-main",
    env_vars={"PYTHONPATH": r"D:\OPENCODE\MCPs\rhino-mcp-main\src"}
)
