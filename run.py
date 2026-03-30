"""OpenEffect — starts the server and opens the browser."""

import os
import signal
import socket
import subprocess
import sys
import time
import webbrowser
from pathlib import Path
from urllib.request import urlopen
from urllib.error import URLError

VERSION = "0.1.0"
DEFAULT_PORT = 3131
HEALTH_TIMEOUT = 30


def bold(s: str) -> str:
    return f"\033[1m{s}\033[0m"


def green(s: str) -> str:
    return f"\033[32m{s}\033[0m"


def red(s: str) -> str:
    return f"\033[31m{s}\033[0m"


def dim(s: str) -> str:
    return f"\033[2m{s}\033[0m"


def find_port(start: int = DEFAULT_PORT) -> int:
    port = start
    while port < start + 100:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                port += 1
    raise RuntimeError("No available port found")


def wait_for_health(host: str, port: int, timeout: int = HEALTH_TIMEOUT) -> bool:
    start = time.time()
    while time.time() - start < timeout:
        try:
            resp = urlopen(f"http://127.0.0.1:{port}/api/health", timeout=2)
            if resp.status == 200:
                return True
        except (URLError, OSError):
            pass
        time.sleep(0.5)
    return False


def main() -> None:
    print()
    print(bold(f"  ✦ OpenEffect v{VERSION}"))
    print(dim("  Open magic for your media"))
    print()

    # Config from environment
    host = os.environ.get("OPENEFFECT_HOST", "127.0.0.1")
    port = int(os.environ.get("OPENEFFECT_PORT", "0")) or find_port()
    no_browser = os.environ.get("OPENEFFECT_NO_BROWSER", "").lower() in ("true", "1", "yes")

    # Resolve paths relative to this file
    root_dir = Path(__file__).parent
    server_dir = root_dir / "server"
    effects_dir = root_dir / "effects"

    if not server_dir.exists():
        print(red("  ✗ server/ directory not found"))
        sys.exit(1)

    env = {
        **os.environ,
        "OPENEFFECT_HOST": host,
        "OPENEFFECT_PORT": str(port),
        "OPENEFFECT_EFFECTS_DIR": str(effects_dir),
    }

    print(dim("  Starting server..."))

    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "main:app",
         "--host", host, "--port", str(port)],
        cwd=str(server_dir),
        env=env,
        stdout=None,
        stderr=None,
    )

    # Graceful shutdown
    def shutdown(signum: int, frame: object) -> None:
        print()
        print(dim("  Shutting down..."))
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    if not wait_for_health(host, port):
        print(red("  ✗ Server failed to start within 30 seconds"))
        proc.terminate()
        sys.exit(1)

    url = f"http://{'localhost' if host == '0.0.0.0' else host}:{port}"

    print()
    print(green(f"  ✓ OpenEffect is running at {url}"))
    print()

    if not no_browser:
        webbrowser.open(url)

    # Wait for server process
    try:
        proc.wait()
    except KeyboardInterrupt:
        shutdown(signal.SIGINT, None)


if __name__ == "__main__":
    main()
