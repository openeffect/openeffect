"""OpenEffect - starts the server and opens the browser."""

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
VITE_PORT = 5173
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
            # Matches the option uvicorn itself sets on its listening socket,
            # so a quick restart right after Ctrl-C can reclaim the preferred
            # port instead of bumping off it - TIME_WAIT lingers ~60s on
            # macOS after the previous process initiated the close, and a
            # probe without SO_REUSEADDR would falsely see that as "taken."
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
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


def wait_for_port(port: int, timeout: int = HEALTH_TIMEOUT) -> bool:
    """Wait until a TCP port starts accepting connections (for Vite).

    Resolves localhost via getaddrinfo and tries every result (IPv4 + IPv6);
    Node's http server binds only one family by default and macOS resolves
    localhost to both ::1 and 127.0.0.1, so hardcoding 127.0.0.1 would miss
    Vite when it listens on ::1.
    """
    start = time.time()
    while time.time() - start < timeout:
        try:
            infos = socket.getaddrinfo("localhost", port, type=socket.SOCK_STREAM)
        except socket.gaierror:
            infos = []
        for family, socktype, proto, _, addr in infos:
            with socket.socket(family, socktype, proto) as s:
                s.settimeout(1)
                try:
                    s.connect(addr)
                    return True
                except OSError:
                    continue
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

    # Bundled wheels ship `client/dist/index.html`. If it's present, serve
    # it straight from uvicorn (production-like) and skip the Vite dev
    # server. Source checkouts without a `pnpm build` have no dist, so we
    # fall through to dev mode (uvicorn --reload + spawn `pnpm dev`).
    # Devs who already built the frontend and want hot-reload again can
    # delete `client/dist/` or run `pnpm dev` manually.
    # Detection by file presence (not by path) survives the wheel-install
    # case where Python resolves the LOCAL `run.py` over the installed
    # one because the source dir was the cwd.
    is_dev = not (root_dir / "client" / "dist" / "index.html").exists()
    cmd = [sys.executable, "-m", "uvicorn", "main:app",
           "--host", host, "--port", str(port)]
    if is_dev:
        cmd.append("--reload")

    proc = subprocess.Popen(
        cmd,
        cwd=str(server_dir),
        env=env,
        stdout=None,
        stderr=None,
        # New session so shutdown can kill the whole process group (uvicorn
        # --reload spawns a child worker that .terminate() alone won't reach).
        start_new_session=True,
    )

    # Kill the whole process group for a child so uvicorn's --reload worker
    # and pnpm's Vite grandchild both get the signal (plain .terminate() /
    # .kill() only hits the immediate pid).
    def _terminate_group(p: subprocess.Popen[bytes], sig: int) -> None:
        if p.poll() is not None:
            return
        try:
            os.killpg(os.getpgid(p.pid), sig)
        except (ProcessLookupError, OSError):
            pass

    # In dev, also spawn Vite so one command starts both halves. Vite proxies
    # /api/* back to this uvicorn (see client/vite.config.ts).
    vite_proc: subprocess.Popen[bytes] | None = None
    if is_dev:
        client_dir = root_dir / "client"
        if not (client_dir / "node_modules").exists():
            print(red("  ✗ client/node_modules missing - run `cd client && pnpm install`"))
            _terminate_group(proc, signal.SIGTERM)
            sys.exit(1)
        try:
            vite_proc = subprocess.Popen(
                # --clearScreen false so Vite doesn't wipe uvicorn's startup
                # output from the shared terminal when it comes up.
                # --strictPort so a stale Vite on 5173 fails loudly instead
                # of silently shifting to 5174 (which our wait_for_port and
                # browser URL both assume is 5173).
                ["pnpm", "dev", "--clearScreen", "false",
                 "--port", str(VITE_PORT), "--strictPort"],
                cwd=str(client_dir),
                stdout=None,
                stderr=None,
                # New session so Ctrl-C can reach the real Vite under pnpm
                start_new_session=True,
            )
        except FileNotFoundError:
            print(red("  ✗ pnpm not found in PATH - install pnpm to run dev mode"))
            _terminate_group(proc, signal.SIGTERM)
            sys.exit(1)

    def shutdown(signum: int, frame: object) -> None:
        print()
        print(dim("  Shutting down..."))
        for p in (proc, vite_proc):
            if p is None:
                continue
            _terminate_group(p, signal.SIGTERM)
            try:
                p.wait(timeout=5)
            except subprocess.TimeoutExpired:
                _terminate_group(p, signal.SIGKILL)
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    if not wait_for_health(host, port):
        print(red("  ✗ Server failed to start within 30 seconds"))
        shutdown(0, None)

    if vite_proc and not wait_for_port(VITE_PORT):
        print(red(f"  ✗ Vite failed to start on :{VITE_PORT} within 30 seconds"))
        shutdown(0, None)

    if vite_proc:
        url = f"http://localhost:{VITE_PORT}"
    else:
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
