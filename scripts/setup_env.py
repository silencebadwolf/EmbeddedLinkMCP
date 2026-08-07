#!/usr/bin/env python3
"""Prepare the Windows development environment for LinkTerm v2."""

from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

NODE_WINGET_ID = "OpenJS.NodeJS.LTS"
DEFAULT_NODE_MAJOR = 22
DEFAULT_PNPM_VERSION = "9.15.0"
DEFAULT_ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
BUILD_INPUT_FILES = [
    "package.json",
    "pnpm-lock.yaml",
    "tsconfig.json",
    "tsconfig.main.json",
    "tsconfig.renderer.json",
    "vite.config.ts",
    "postcss.config.js",
]
BUILD_INPUT_DIRS = ["src"]
BUILD_OUTPUT_FILES = [
    "dist/main/main/index.js",
    "dist/renderer/index.html",
]
BUILD_STAMP_FILE = "dist/.linkterm-build-stamp"


class SetupError(RuntimeError):
    """Raised when environment setup cannot continue."""


class CommandInterruptedError(SetupError):
    """Raised when a child command is interrupted by the user."""


def resolve_command(command: list[str]) -> list[str]:
    """Resolve a command name to the executable path used by the current shell.

    Args:
        command: Command and arguments to execute.

    Returns:
        A command list with the first item replaced by the resolved executable path when found.
    """
    if not command:
        return command
    executable = shutil.which(command[0])
    if executable is None:
        return command
    return [executable, *command[1:]]


def run(
    command: list[str],
    *,
    cwd: Path | None = None,
    check: bool = True,
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    """Run a command and stream its output.

    Args:
        command: Command and arguments to execute.
        cwd: Optional working directory.
        check: Whether to raise when the command exits with a non-zero code.
        env: Optional environment variables for the child process.

    Returns:
        The completed process result.
    """
    resolved_command = resolve_command(command)
    print(f"\n$ {' '.join(command)}")
    try:
        completed = subprocess.run(resolved_command, cwd=cwd, text=True, env=env)
    except KeyboardInterrupt as exc:
        raise CommandInterruptedError(f"命令被中断: {' '.join(command)}") from exc
    if check and completed.returncode != 0:
        raise SetupError(f"命令执行失败，退出码 {completed.returncode}: {' '.join(command)}")
    return completed


def start_detached(command: list[str], *, cwd: Path, env: dict[str, str]) -> subprocess.Popen[bytes]:
    """Start a long-running GUI command detached from this terminal.

    Args:
        command: Command and arguments to execute.
        cwd: Working directory for the child process.
        env: Environment variables for the child process.

    Returns:
        The detached child process handle.
    """
    resolved_command = resolve_command(command)
    print(f"\n$ {' '.join(command)}")
    creationflags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) | getattr(subprocess, "DETACHED_PROCESS", 0)
    try:
        return subprocess.Popen(
            resolved_command,
            cwd=cwd,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=creationflags,
        )
    except KeyboardInterrupt as exc:
        raise CommandInterruptedError(f"命令被中断: {' '.join(command)}") from exc
    except OSError as exc:
        raise SetupError(f"命令启动失败: {' '.join(command)}: {exc}") from exc


def capture(command: list[str]) -> str | None:
    """Run a command and return stdout, or None if it fails.

    Args:
        command: Command and arguments to execute.

    Returns:
        Trimmed stdout on success; otherwise None.
    """
    try:
        completed = subprocess.run(resolve_command(command), capture_output=True, text=True, check=True)
    except (OSError, subprocess.CalledProcessError):
        return None
    except KeyboardInterrupt as exc:
        raise CommandInterruptedError(f"命令被中断: {' '.join(command)}") from exc
    return completed.stdout.strip()


def command_exists(name: str) -> bool:
    """Check whether a command is available on PATH.

    Args:
        name: Executable name to locate.

    Returns:
        True when the executable can be found.
    """
    return shutil.which(name) is not None


def parse_major(version_output: str | None) -> int | None:
    """Parse a semantic version string and return the major version.

    Args:
        version_output: Version text such as "v20.11.1".

    Returns:
        The major version, or None when parsing fails.
    """
    if not version_output:
        return None
    token = version_output.strip().split()[0].lstrip("v")
    major = token.split(".", maxsplit=1)[0]
    return int(major) if major.isdigit() else None


def repo_root() -> Path:
    """Return the repository root inferred from this script location.

    Returns:
        The absolute repository root path.
    """
    return Path(__file__).resolve().parents[1]


def package_manager_version(root: Path) -> str:
    """Read the pnpm version requested by package.json.

    Args:
        root: Repository root containing package.json.

    Returns:
        The configured pnpm version, or the project default.
    """
    package_json = root / "package.json"
    try:
        data = json.loads(package_json.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return DEFAULT_PNPM_VERSION

    package_manager = str(data.get("packageManager", ""))
    prefix = "pnpm@"
    if package_manager.startswith(prefix):
        return package_manager[len(prefix) :]
    return DEFAULT_PNPM_VERSION


def ensure_windows() -> None:
    """Fail early on unsupported operating systems."""
    if platform.system() != "Windows":
        raise SetupError("此脚本当前只支持 Windows。")


def ensure_node(min_major: int, *, install: bool) -> None:
    """Ensure Node.js is available and new enough.

    Args:
        min_major: Minimum accepted Node.js major version.
        install: Whether to install Node.js with winget when missing or outdated.
    """
    node_version = capture(["node", "--version"])
    node_major = parse_major(node_version)
    if node_major is not None and (node_major == min_major or node_major >= 24):
        print(f"Node.js 已就绪: {node_version}")
        return

    if not install:
        raise SetupError(f"需要 Node.js {min_major}.x 或 >= 24，当前检测到: {node_version or '未安装'}")

    if not command_exists("winget"):
        raise SetupError("未找到 winget，无法自动安装 Node.js。请先安装 Node.js LTS 后重试。")

    print(f"准备通过 winget 安装/升级 Node.js LTS（需要时可能弹出 UAC）...")
    run(["winget", "install", "--id", NODE_WINGET_ID, "-e", "--accept-source-agreements", "--accept-package-agreements"], check=False)

    node_version = capture(["node", "--version"])
    node_major = parse_major(node_version)
    if node_major is None or (node_major != min_major and node_major < 24):
        raise SetupError("Node.js 安装后仍不可用。请重开 VS Code/终端后再次运行此脚本。")
    print(f"Node.js 已就绪: {node_version}")


def ensure_pnpm(version: str, *, install: bool) -> None:
    """Ensure the project-requested pnpm version is available on PATH.

    Args:
        version: pnpm version to install when needed.
        install: Whether to install pnpm with the user npm prefix when missing or mismatched.
    """
    pnpm_version = capture(["pnpm", "--version"])
    if pnpm_version == version:
        print(f"pnpm 已就绪: {pnpm_version}")
        return

    if not install:
        raise SetupError(f"需要 pnpm {version}，当前检测到: {pnpm_version or '未安装'}")

    if not command_exists("npm"):
        raise SetupError("未找到 npm。请确认 Node.js LTS 已正确安装，然后重开终端。")

    run(["npm", "install", "-g", f"pnpm@{version}"])

    pnpm_version = capture(["pnpm", "--version"])
    if pnpm_version != version:
        raise SetupError("pnpm 安装完成但当前终端仍找不到指定版本。请重开 VS Code/终端后再次运行此脚本。")
    print(f"pnpm 已就绪: {pnpm_version}")


def install_dependencies(root: Path) -> None:
    """Install project dependencies with pnpm.

    Args:
        root: Repository root.
    """
    run(["pnpm", "install"], cwd=root)


def mark_build_success(root: Path) -> None:
    """Record that the full build completed successfully.

    Args:
        root: Repository root.
    """
    stamp = root / BUILD_STAMP_FILE
    stamp.parent.mkdir(parents=True, exist_ok=True)
    stamp.write_text("ok\n", encoding="utf-8")


def build_project(root: Path) -> None:
    """Build the project with pnpm.

    Args:
        root: Repository root.
    """
    run(["pnpm", "run", "build"], cwd=root)
    mark_build_success(root)


def newest_mtime(paths: list[Path]) -> float:
    """Return the newest modification timestamp among files under the provided paths.

    Args:
        paths: Files or directories to scan.

    Returns:
        The newest modification timestamp, or 0 when no path exists.
    """
    newest = 0.0
    for path in paths:
        if not path.exists():
            continue
        if path.is_file():
            newest = max(newest, path.stat().st_mtime)
            continue
        for child in path.rglob("*"):
            if child.is_file():
                newest = max(newest, child.stat().st_mtime)
    return newest


def build_needed(root: Path) -> bool:
    """Check whether production build outputs are missing or older than source inputs.

    Args:
        root: Repository root.

    Returns:
        True when start mode should run a build before launching Electron.
    """
    output_paths = [root / relative for relative in BUILD_OUTPUT_FILES]
    if any(not path.exists() for path in output_paths):
        return True

    stamp = root / BUILD_STAMP_FILE
    if not stamp.exists():
        return True

    input_paths = [root / relative for relative in [*BUILD_INPUT_FILES, *BUILD_INPUT_DIRS]]
    return newest_mtime(input_paths) > stamp.stat().st_mtime


def build_if_needed(root: Path) -> None:
    """Build the project only when start mode needs refreshed dist outputs.

    Args:
        root: Repository root.
    """
    if build_needed(root):
        build_project(root)
        return
    print("构建产物已是最新，跳过 pnpm run build。")


def electron_package_dir(root: Path) -> Path:
    """Return the installed electron package directory for this workspace.

    Args:
        root: Repository root.

    Returns:
        The package directory that contains electron's install.js and dist files.
    """
    package_dir = root / "node_modules" / "electron"
    if not package_dir.exists():
        raise SetupError("未找到 node_modules/electron。请先运行 pnpm install。")
    return package_dir.resolve()


def electron_executable_path(root: Path) -> Path | None:
    """Return Electron executable path when the binary metadata is available.

    Args:
        root: Repository root.

    Returns:
        The Electron executable path, or None when path.txt is missing or empty.
    """
    package_dir = electron_package_dir(root)
    path_file = package_dir / "path.txt"
    try:
        executable_name = path_file.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    if not executable_name:
        return None
    return package_dir / "dist" / executable_name


def electron_binary_installed(root: Path) -> bool:
    """Check whether the Electron executable binary has already been downloaded.

    Args:
        root: Repository root.

    Returns:
        True when electron's path.txt and executable both exist.
    """
    executable = electron_executable_path(root)
    return executable is not None and executable.exists()


def ensure_electron_binary_installed(root: Path) -> None:
    """Download Electron's executable before launching the app when it is missing.

    Args:
        root: Repository root.
    """
    if electron_binary_installed(root):
        return
    print("Electron 二进制未就绪，正在预下载。若网络较慢，请等待完成，不要中断任务。")
    try:
        run(["pnpm", "exec", "install-electron", "--no"], cwd=root)
    except CommandInterruptedError:
        raise
    except SetupError as exc:
        print(f"Electron 默认下载源失败：{exc}")
        print(f"改用镜像源重试：{DEFAULT_ELECTRON_MIRROR}")
        retry_temp_dir = Path(tempfile.mkdtemp(prefix="linkterm-electron-download-"))
        env = {
            **os.environ,
            "ELECTRON_MIRROR": DEFAULT_ELECTRON_MIRROR,
            "TEMP": str(retry_temp_dir),
            "TMP": str(retry_temp_dir),
            "TMPDIR": str(retry_temp_dir),
        }
        run(["pnpm", "exec", "install-electron", "--no"], cwd=root, env=env)


def stop_existing_linkterm_instances(root: Path) -> None:
    """Close existing LinkTerm Electron processes for this workspace.

    Args:
        root: Repository root.
    """
    executable = electron_executable_path(root)
    if executable is None or not executable.exists():
        return

    script = r"""
param([string] $ElectronPath, [string] $RootPath)
$matches = Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" |
  Where-Object {
    $_.ExecutablePath -and
    [string]::Equals($_.ExecutablePath, $ElectronPath, [System.StringComparison]::OrdinalIgnoreCase) -and
    $_.CommandLine -and
    ($_.CommandLine.IndexOf($RootPath, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) -and
    ($_.CommandLine.IndexOf('--type=', [System.StringComparison]::OrdinalIgnoreCase) -lt 0)
  }
$matches | ForEach-Object {
  Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
}
"""
    escaped_script = script.strip()
    powershell = (
        Path(os.environ.get("SystemRoot", r"C:\Windows"))
        / "System32"
        / "WindowsPowerShell"
        / "v1.0"
        / "powershell.exe"
    )
    powershell_command = str(powershell) if powershell.exists() else "powershell.exe"
    script_fd, script_name = tempfile.mkstemp(prefix="linkterm-stop-", suffix=".ps1")
    script_path = Path(script_name)
    try:
        with os.fdopen(script_fd, "w", encoding="utf-8") as script_file:
            script_file.write(escaped_script)
        completed = subprocess.run(
            [
                powershell_command,
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(script_path),
                "-ElectronPath",
                str(executable.resolve()),
                "-RootPath",
                str(root.resolve()),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
    finally:
        try:
            script_path.unlink(missing_ok=True)
        except OSError:
            pass
    if completed.returncode != 0:
        raise SetupError((completed.stderr or completed.stdout or "无法关闭旧 LinkTerm 实例").strip())


def start_project(root: Path) -> None:
    """Start the built Electron app with pnpm.

    Args:
        root: Repository root.
    """
    ensure_electron_binary_installed(root)
    stop_existing_linkterm_instances(root)
    env = {**os.environ, "LINKTERM_FORCE_DIST": "1"}
    process = start_detached(["pnpm", "start"], cwd=root, env=env)
    print(f"LinkTerm 已在后台启动，PID: {process.pid}")


def validate(root: Path, *, install: bool, skip_install_deps: bool, build: bool, start: bool) -> None:
    """Prepare and optionally build or start the LinkTerm workspace.

    Args:
        root: Repository root.
        install: Whether missing tools may be installed.
        skip_install_deps: Whether to skip pnpm install.
        build: Whether to run the project build after setup.
        start: Whether to launch the Electron app after setup.
    """
    ensure_windows()
    pnpm_version = package_manager_version(root)
    ensure_node(DEFAULT_NODE_MAJOR, install=install)
    ensure_pnpm(pnpm_version, install=install)

    if not skip_install_deps:
        install_dependencies(root)

    if build:
        build_project(root)
    elif start:
        build_if_needed(root)

    if start:
        start_project(root)

    print("\n环境已准备完成。")


def main() -> int:
    """Parse CLI arguments and run environment setup.

    Returns:
        Process exit code.
    """
    parser = argparse.ArgumentParser(description="准备 LinkTerm v2 的 Windows 开发环境。")
    parser.add_argument("--install", action="store_true", help="允许用 winget/corepack 安装缺失工具。")
    parser.add_argument("--skip-install-deps", action="store_true", help="跳过 pnpm install。")
    parser.add_argument("--build", action="store_true", help="环境准备后运行 pnpm run build。")
    parser.add_argument("--start", action="store_true", help="环境准备和构建后运行 pnpm start。")
    args = parser.parse_args()

    try:
        validate(repo_root(), install=args.install, skip_install_deps=args.skip_install_deps, build=args.build, start=args.start)
    except SetupError as exc:
        print(f"\n环境准备失败：{exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
