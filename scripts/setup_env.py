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
from pathlib import Path

NODE_WINGET_ID = "OpenJS.NodeJS.LTS"
DEFAULT_NODE_MAJOR = 20
DEFAULT_PNPM_VERSION = "9.15.0"


class SetupError(RuntimeError):
    """Raised when environment setup cannot continue."""


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
    completed = subprocess.run(resolved_command, cwd=cwd, text=True, env=env)
    if check and completed.returncode != 0:
        raise SetupError(f"命令执行失败，退出码 {completed.returncode}: {' '.join(command)}")
    return completed


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
    if node_major is not None and node_major >= min_major:
        print(f"Node.js 已就绪: {node_version}")
        return

    if not install:
        raise SetupError(f"需要 Node.js >= {min_major}，当前检测到: {node_version or '未安装'}")

    if not command_exists("winget"):
        raise SetupError("未找到 winget，无法自动安装 Node.js。请先安装 Node.js LTS 后重试。")

    print(f"准备通过 winget 安装/升级 Node.js LTS（需要时可能弹出 UAC）...")
    run(["winget", "install", "--id", NODE_WINGET_ID, "-e", "--accept-source-agreements", "--accept-package-agreements"], check=False)

    node_version = capture(["node", "--version"])
    node_major = parse_major(node_version)
    if node_major is None or node_major < min_major:
        raise SetupError("Node.js 安装后仍不可用。请重开 VS Code/终端后再次运行此脚本。")
    print(f"Node.js 已就绪: {node_version}")


def ensure_pnpm(version: str, *, install: bool) -> None:
    """Ensure pnpm is available through Corepack.

    Args:
        version: pnpm version to prepare.
        install: Whether to enable Corepack and prepare pnpm when missing.
    """
    pnpm_version = capture(["pnpm", "--version"])
    if pnpm_version == version:
        print(f"pnpm 已就绪: {pnpm_version}")
        return

    if not install:
        raise SetupError(f"需要 pnpm {version}，当前检测到: {pnpm_version or '未安装'}")

    if not command_exists("corepack"):
        raise SetupError("未找到 corepack。请确认 Node.js LTS 已正确安装，然后重开终端。")

    run(["corepack", "enable"])
    run(["corepack", "prepare", f"pnpm@{version}", "--activate"])

    pnpm_version = capture(["pnpm", "--version"])
    if pnpm_version != version:
        raise SetupError("pnpm 准备完成但当前终端仍找不到 pnpm。请重开 VS Code/终端后再次运行此脚本。")
    print(f"pnpm 已就绪: {pnpm_version}")


def install_dependencies(root: Path) -> None:
    """Install project dependencies with pnpm.

    Args:
        root: Repository root.
    """
    run(["pnpm", "install"], cwd=root)


def build_project(root: Path) -> None:
    """Build the project with pnpm.

    Args:
        root: Repository root.
    """
    run(["pnpm", "run", "build"], cwd=root)


def start_project(root: Path) -> None:
    """Start the built Electron app with pnpm.

    Args:
        root: Repository root.
    """
    env = {**os.environ, "LINKTERM_FORCE_DIST": "1"}
    run(["pnpm", "start"], cwd=root, env=env)


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

    if build or start:
        build_project(root)

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
