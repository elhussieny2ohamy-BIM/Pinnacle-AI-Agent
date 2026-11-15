import subprocess
import json
import sys
import os

def test_server(name, cmd, cwd, env_vars=None, num_messages=2):
    """Test an MCP server by sending initialize + tools/list and reading responses."""
    messages = [
        {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-12", "capabilities": {}, "clientInfo": {"name": "test", "version": "1.0"}}},
        {"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}},
    ]
    input_text = "\n".join(json.dumps(m) for m in messages) + "\n"

    env = os.environ.copy()
    if env_vars:
        env.update(env_vars)

    print(f"\n{'='*60}")
    print(f"Testing: {name}")
    print(f"Command: {' '.join(cmd)}")
    print(f"CWD: {cwd}")
    print(f"{'='*60}")

    try:
        proc = subprocess.Popen(
            cmd,
            cwd=cwd,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=env
        )
        stdout, stderr = proc.communicate(input=input_text, timeout=15)

        print(f"Return code: {proc.returncode}")
        lines = stdout.strip().split("\n") if stdout.strip() else []
        json_lines = [l for l in lines if l.strip().startswith("{")]
        print(f"JSON lines received: {len(json_lines)}")

        for line in json_lines:
            try:
                msg = json.loads(line)
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
            except json.JSONDecodeError:
                print(f"  Non-JSON: {line[:100]}")

        if stderr.strip():
            print(f"  Stderr (last 200): {stderr.strip()[-200:]}")

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
