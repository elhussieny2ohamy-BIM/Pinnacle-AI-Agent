import subprocess
import json
import sys
import os
import time

def read_mcp_responses(proc, timeout=10):
    """Read stdout from an MCP server process, splitting by \r\n."""
    import select
    responses = []
    deadline = time.time() + timeout
    buf = b""
    while time.time() < deadline:
        # Non-blocking read
        import msvcrt
        if msvcrt.kbhit():
            break
        # Check if process has output
        if proc.stdout:
            try:
                chunk = proc.stdout.read1(4096)
                if chunk:
                    buf += chunk
                    # Split by \r\n
                    while b"\r\n" in buf:
                        line, buf = buf.split(b"\r\n", 1)
                        line = line.strip()
                        if line:
                            try:
                                responses.append(json.loads(line.decode("utf-8")))
                            except json.JSONDecodeError:
                                pass
                elif proc.poll() is not None:
                    break
            except Exception:
                break
        else:
            break
    return responses

def test_server(name, cmd, cwd, env_vars=None, protocol="2025-11-25"):
    env = os.environ.copy()
    if env_vars:
        env.update(env_vars)

    print(f"\n{'='*60}")
    print(f"Testing: {name}")
    print(f"{'='*60}")

    init_msg = {
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {"protocolVersion": protocol, "capabilities": {}, "clientInfo": {"name": "test", "version": "1.0"}}
    }
    list_msg = {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}}

    # Send messages separated by \r\n
    input_text = (json.dumps(init_msg) + "\r\n" + json.dumps(list_msg) + "\r\n").encode("utf-8")

    try:
        proc = subprocess.Popen(cmd, cwd=cwd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
        proc.stdin.write(input_text)
        proc.stdin.flush()
        proc.stdin.close()

        responses = read_mcp_responses(proc, timeout=10)
        proc.wait(timeout=5)

        print(f"Return code: {proc.returncode}")
        print(f"Responses: {len(responses)}")

        for r in responses:
            msg_id = r.get("id")
            if msg_id == 1:
                si = r.get("result", {}).get("serverInfo", {})
                print(f"  Initialize OK: {si.get('name')} v{si.get('version')}")
                proto = r.get("result", {}).get("protocolVersion", "?")
                print(f"  Protocol: {proto}")
                caps = r.get("result", {}).get("capabilities", {})
                print(f"  Capabilities: tools={bool(caps.get('tools',{}).get('listChanged'))}")
            elif msg_id == 2:
                tools = r.get("result", {}).get("tools", [])
                print(f"  tools/list: {len(tools)} tools")
                for t in tools[:8]:
                    print(f"    - {t.get('name')}: {t.get('description', '')[:60]}")
                if len(tools) > 8:
                    print(f"    ... and {len(tools) - 8} more")
            elif "method" in r and r["method"] == "notifications/message":
                pass  # skip notifications
            else:
                print(f"  Other: {r}")

        if proc.stderr:
            stderr = proc.stderr.read()
            if stderr.strip():
                print(f"  Stderr (last 200): {stderr.decode('utf-8', errors='replace').strip()[-200:]}")

    except Exception as e:
        print(f"  ERROR: {e}")

# Test autocad-mcp (ezdxf)
test_server(
    "autocad-mcp (ezdxf)",
    [sys.executable, "server.py"],
    cwd=r"D:\OPENCODE\MCPs\Autocad-MCP-main",
    env_vars={"AUTOCAD_MCP_BACKEND": "ezdxf"}
)

# Test rhino-mcp (standalone)
test_server(
    "rhino-mcp (standalone)",
    [sys.executable, "src/rhino_mcp/server.py"],
    cwd=r"D:\OPENCODE\MCPs\rhino-mcp-main",
    env_vars={"PYTHONPATH": r"D:\OPENCODE\MCPs\rhino-mcp-main\src"}
)

# Test rvt-mcp via HTTP
print(f"\n{'='*60}")
print(f"Testing: rvt-mcp (HTTP SSE)")
print(f"{'='*60}")
rvt_exe = r"C:\Users\elhussieny.mohamed\AppData\Local\Bimwright\rvt-mcp\server\current\rvt-mcp.exe"
proc = subprocess.Popen([rvt_exe, "--http", "9998"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
time.sleep(4)
try:
    import urllib.request
    init_data = json.dumps({
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {"protocolVersion": "2025-11-25", "capabilities": {}, "clientInfo": {"name": "test", "version": "1.0"}}
    }).encode()
    req = urllib.request.Request("http://127.0.0.1:9998/mcp", data=init_data,
        headers={"Content-Type": "application/json", "Accept": "application/json, text/event-stream"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        body = resp.read().decode("utf-8")
        print(f"HTTP status: {resp.status}")
        print(f"Response: {body[:800]}")
except Exception as e:
    print(f"HTTP ERROR: {e}")
proc.terminate()
proc.wait(timeout=5)
stderr = proc.stderr.read()
if stderr:
    print(f"Stderr (last 200): {stderr[-200:]}")
