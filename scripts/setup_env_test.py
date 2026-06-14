#!/usr/bin/env python3
"""Unit tests for setup_env.py."""

from __future__ import annotations

import unittest
from unittest.mock import patch

import setup_env


class SetupEnvTests(unittest.TestCase):
    """Tests for Windows command resolution helpers."""

    def test_resolve_command_uses_path_match_for_cmd_shims(self) -> None:
        """Resolve command names to .cmd shim paths before subprocess execution."""
        with patch.object(setup_env.shutil, "which", return_value=r"C:\Program Files\nodejs\corepack.cmd"):
            resolved = setup_env.resolve_command(["corepack", "enable"])

        self.assertEqual(resolved, [r"C:\Program Files\nodejs\corepack.cmd", "enable"])

    def test_start_flag_builds_before_starting_electron(self) -> None:
        """Start mode installs dependencies, builds, then launches the app."""
        calls: list[str] = []

        with (
            patch.object(setup_env, "ensure_windows", side_effect=lambda: calls.append("windows")),
            patch.object(setup_env, "package_manager_version", return_value="9.15.0"),
            patch.object(setup_env, "ensure_node", side_effect=lambda *_args, **_kwargs: calls.append("node")),
            patch.object(setup_env, "ensure_pnpm", side_effect=lambda *_args, **_kwargs: calls.append("pnpm")),
            patch.object(setup_env, "install_dependencies", side_effect=lambda *_args: calls.append("install")),
            patch.object(setup_env, "build_project", side_effect=lambda *_args: calls.append("build")),
            patch.object(setup_env, "start_project", side_effect=lambda *_args: calls.append("start")),
        ):
            setup_env.validate(setup_env.repo_root(), install=True, skip_install_deps=False, build=False, start=True)

        self.assertEqual(calls, ["windows", "node", "pnpm", "install", "build", "start"])
    def test_start_project_forces_dist_renderer(self) -> None:
        """Start command forces Electron to load the built renderer files."""
        with patch.object(setup_env, "run") as run_mock:
            setup_env.start_project(setup_env.repo_root())

        _command, kwargs = run_mock.call_args
        self.assertEqual(kwargs["env"]["LINKTERM_FORCE_DIST"], "1")


if __name__ == "__main__":
    unittest.main()
