import sys

# Test autocad-mcp-pro
try:
    import autocad_mcp_pro
    print("autocad_mcp_pro: OK")
except Exception as e:
    print(f"autocad_mcp_pro: FAIL - {e}")

# Test rhino_mcp
try:
    import rhino_mcp
    print("rhino_mcp: OK")
except Exception as e:
    print(f"rhino_mcp: FAIL - {e}")

# Test ezdxf
try:
    import ezdxf
    print(f"ezdxf: OK (v{ezdxf.__version__})")
except Exception as e:
    print(f"ezdxf: FAIL - {e}")

# Test rhino3dm
try:
    import rhino3dm
    print(f"rhino3dm: OK")
except Exception as e:
    print(f"rhino3dm: FAIL - {e}")

# Test fastmcp
try:
    from fastmcp import FastMCP
    print("fastmcp: OK")
except Exception as e:
    print(f"fastmcp: FAIL - {e}")
