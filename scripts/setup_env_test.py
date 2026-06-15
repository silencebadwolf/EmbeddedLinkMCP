#!/usr/bin/env python3
"""Unit tests for setup_env.py."""

from __future__ import annotations

import io
import unittest
from unittest.mock import call, patch

import setup_env


class SetupEnvTests(unittest.TestCase):
    """Tests for Windows command resolution helpers."""

    def test_resolve_command_uses_path_match_for_cmd_shims(self) -> None:
        """Resolve command names to .cmd shim paths before subprocess execution."""
        with patch.object(setup_env.shutil, "which", return_value=r"C:\Program Files\nodejs\corepack.cmd"):
            resolved = setup_env.resolve_command(["corepack", "enable"])

        self.assertEqual(resolved, [r"C:\Program Files\nodejs\corepack.cmd", "enable"])

    def test_start_flag_builds_when_outputs_are_missing_before_starting_electron(self) -> None:
        """Start mode installs dependencies, builds missing outputs, then launches the app."""
        calls: list[str] = []

        with (
            patch.object(setup_env, "ensure_windows", side_effect=lambda: calls.append("windows")),
            patch.object(setup_env, "package_manager_version", return_value="9.15.0"),
            patch.object(setup_env, "ensure_node", side_effect=lambda *_args, **_kwargs: calls.append("node")),
            patch.object(setup_env, "ensure_pnpm", side_effect=lambda *_args, **_kwargs: calls.append("pnpm")),
            patch.object(setup_env, "install_dependencies", side_effect=lambda *_args: calls.append("install")),
            patch.object(setup_env, "build_needed", return_value=True),
            patch.object(setup_env, "build_project", side_effect=lambda *_args: calls.append("build")),
            patch.object(setup_env, "start_project", side_effect=lambda *_args: calls.append("start")),
        ):
            setup_env.validate(setup_env.repo_root(), install=True, skip_install_deps=False, build=False, start=True)

        self.assertEqual(calls, ["windows", "node", "pnpm", "install", "build", "start"])

    def test_start_flag_skips_build_when_outputs_are_current(self) -> None:
        """Start mode should skip pnpm run build when existing dist outputs are up to date."""
        calls: list[str] = []

        with (
            patch.object(setup_env, "ensure_windows", side_effect=lambda: calls.append("windows")),
            patch.object(setup_env, "package_manager_version", return_value="9.15.0"),
            patch.object(setup_env, "ensure_node", side_effect=lambda *_args, **_kwargs: calls.append("node")),
            patch.object(setup_env, "ensure_pnpm", side_effect=lambda *_args, **_kwargs: calls.append("pnpm")),
            patch.object(setup_env, "install_dependencies", side_effect=lambda *_args: calls.append("install")),
            patch.object(setup_env, "build_needed", return_value=False),
            patch.object(setup_env, "build_project", side_effect=lambda *_args: calls.append("build")),
            patch.object(setup_env, "start_project", side_effect=lambda *_args: calls.append("start")),
        ):
            setup_env.validate(setup_env.repo_root(), install=True, skip_install_deps=False, build=False, start=True)

        self.assertEqual(calls, ["windows", "node", "pnpm", "install", "start"])

    def test_build_flag_always_builds_even_when_outputs_are_current(self) -> None:
        """Explicit build mode should always run pnpm run build."""
        calls: list[str] = []

        with (
            patch.object(setup_env, "ensure_windows", side_effect=lambda: calls.append("windows")),
            patch.object(setup_env, "package_manager_version", return_value="9.15.0"),
            patch.object(setup_env, "ensure_node", side_effect=lambda *_args, **_kwargs: calls.append("node")),
            patch.object(setup_env, "ensure_pnpm", side_effect=lambda *_args, **_kwargs: calls.append("pnpm")),
            patch.object(setup_env, "install_dependencies", side_effect=lambda *_args: calls.append("install")),
            patch.object(setup_env, "build_needed", return_value=False),
            patch.object(setup_env, "build_project", side_effect=lambda *_args: calls.append("build")),
            patch.object(setup_env, "start_project", side_effect=lambda *_args: calls.append("start")),
        ):
            setup_env.validate(setup_env.repo_root(), install=True, skip_install_deps=False, build=True, start=False)

        self.assertEqual(calls, ["windows", "node", "pnpm", "install", "build"])

    def test_start_project_forces_dist_renderer(self) -> None:
        """Start command forces Electron to load the built renderer files."""
        root = setup_env.repo_root()

        with (
            patch.object(setup_env, "ensure_electron_binary_installed") as ensure_electron_mock,
            patch.object(setup_env, "run") as run_mock,
        ):
            setup_env.start_project(root)

        ensure_electron_mock.assert_called_once_with(root)
        _command, kwargs = run_mock.call_args
        self.assertEqual(kwargs["env"]["LINKTERM_FORCE_DIST"], "1")

    def test_ensure_pnpm_installs_with_npm_prefix_before_corepack(self) -> None:
        """pnpm setup should avoid Corepack writes to the Program Files Node directory."""
        versions = [None, "9.15.0"]

        def fake_capture(command: list[str]) -> str | None:
            if command == ["pnpm", "--version"]:
                return versions.pop(0)
            return None

        with (
            patch.object(setup_env, "capture", side_effect=fake_capture),
            patch.object(setup_env, "run") as run_mock,
        ):
            setup_env.ensure_pnpm("9.15.0", install=True)

        run_mock.assert_called_once_with(["npm", "install", "-g", "pnpm@9.15.0"])

    def test_ensure_electron_binary_installed_downloads_before_start(self) -> None:
        """Electron should be downloaded explicitly before pnpm start launches the app."""
        root = setup_env.repo_root()

        with (
            patch.object(setup_env, "electron_binary_installed", return_value=False),
            patch.object(setup_env, "run") as run_mock,
        ):
            setup_env.ensure_electron_binary_installed(root)

        self.assertEqual(run_mock.call_args_list, [call(["pnpm", "exec", "install-electron", "--no"], cwd=root)])

    def test_ensure_electron_binary_installed_retries_with_mirror(self) -> None:
        """Electron download should retry with a mirror when the default source fails."""
        root = setup_env.repo_root()

        with (
            patch.object(setup_env, "electron_binary_installed", return_value=False),
            patch.object(setup_env, "run", side_effect=[setup_env.SetupError("fetch failed"), None]) as run_mock,
        ):
            setup_env.ensure_electron_binary_installed(root)

        self.assertEqual(len(run_mock.call_args_list), 2)
        self.assertEqual(run_mock.call_args_list[0], call(["pnpm", "exec", "install-electron", "--no"], cwd=root))
        retry_env = run_mock.call_args_list[1].kwargs["env"]
        self.assertEqual(retry_env["ELECTRON_MIRROR"], setup_env.DEFAULT_ELECTRON_MIRROR)
        self.assertEqual(retry_env["TEMP"], retry_env["TMP"])
        self.assertEqual(retry_env["TEMP"], retry_env["TMPDIR"])
        self.assertIn("linkterm-electron-download-", retry_env["TEMP"])

    def test_ensure_electron_binary_installed_does_not_retry_after_interrupt(self) -> None:
        """User interrupts should stop immediately instead of retrying another download source."""
        root = setup_env.repo_root()

        with (
            patch.object(setup_env, "electron_binary_installed", return_value=False),
            patch.object(setup_env, "run", side_effect=setup_env.CommandInterruptedError("命令被中断")) as run_mock,
            self.assertRaises(setup_env.CommandInterruptedError),
        ):
            setup_env.ensure_electron_binary_installed(root)

        run_mock.assert_called_once_with(["pnpm", "exec", "install-electron", "--no"], cwd=root)

    def test_run_reports_keyboard_interrupt_without_traceback(self) -> None:
        """Interrupted child commands should surface as SetupError instead of a Python traceback."""
        with (
            patch.object(setup_env.subprocess, "run", side_effect=KeyboardInterrupt),
            patch("sys.stderr", new_callable=io.StringIO) as stderr,
        ):
            try:
                exit_code = setup_env.main()
            except KeyboardInterrupt:
                self.fail("main() should convert KeyboardInterrupt to a clean SetupError")

        self.assertEqual(exit_code, 1)
        self.assertIn("命令被中断", stderr.getvalue())
        self.assertNotIn("Traceback", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
