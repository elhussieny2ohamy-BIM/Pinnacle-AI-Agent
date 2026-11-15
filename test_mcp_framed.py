import subprocess
import json
import sys
import os

def mcp_message(obj):
    """Format an MCP message with Content-Length header."""
    payload = json.dumps(obj).encode("utf-8")
    header = f"Content-Length: {len(payload)}\r\n\r\n".encode("utf-8")
    return header + payload

def test_server(name, cmd, cwd, env_vars=None):
    messages = [
        {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-12", "capabilities": {}, "clientInfo": {"name": "test", "version": "1.0"}}},
        {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
    ]
    input_bytes = b"".join(mcp_message(m) for m in messages)

    env = os.environ.copy()
    if env_vars:
        env.update(env_vars)

    print(f"\n{'='*60}")
    print(f"Testing: {name}")
    print(f"{'='*60}")

    try:
        proc = subprocess.Popen(
            cmd,
            cwd=cwd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env
        )
        stdout, stderr = proc.communicate(input=input_bytes, timeout=15)

        print(f"Return code: {proc.returncode}")
        print(f"Stdout bytes: {len(stdout)}")

        # Parse Content-Length framed responses
        pos = 0
        msg_count = 0
        while pos < len(stdout):
            # Find Content-Length header
            header_end = stdout.find(b"\r\n\r\n", pos)
            if header_end == -1:
                break
            header = stdout[pos:header_end].decode("utf-8", errors="replace")
            cl = None
            for line in header.split("\r\n"):
                if line.lower().startswith("content-length:"):
                    cl = int(line.split(":", 1)[1].strip())
                    break
            if cl is None:
                break
            body_start = header_end + 4
            body = stdout[body_start:body_start + cl]
            try:
                msg = json.loads(body.decode("utf-8"))
                msg_id = msg.get("id")
                if msg_id == 1:
                    si = msg.get("result", {}).get("serverInfo", {})
                    print(f"  Initialize OK: {si.get('name')} v{si.get('version')}")
                elif msg_id == 2:
                    tools = msg.get("result", {}).get("tools", [])
                    print(f"  tools/list: {len(tools)} tools")
                    for t in tools[:5]:
                        print(f"    - {t.get('name')}: {t.get('description', '')[:70]}")
                    if len(tools) > 5:
                        print(f"    ... and {len(tools) - 5} more")
                msg_count += 1
            except json.JSONDecodeError:
                print(f"  Non-JSON body: {body[:100]}")
            pos = body_start + cl

        print(f"  Messages parsed: {msg_count}")

        if stderr.strip():
            print(f"  Stderr (last 200): {stderr.decode('utf-8', errors='replace').strip()[-200:]}")

    except Exception as e:
        print(f"  ERROR: {e}")

# Test rvt-mcp
test_server(
    "rvt-mcp",
    [r"C:\Users\elhussieny.mohamed\AppData\Local\Bimwright\rvt-mcp\server\current\rvt-mcp.exe"],
    cwd=r"C:\Users\elhussieny.mohamed\AppData\Local\Bimwright\rvt-mcp\server\current"
)

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
