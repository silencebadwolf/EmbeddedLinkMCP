## Why

The control profile UI can browse WSL firmware files, but the workspace directory picker does not surface WSL paths in the same way. This makes a WSL-first embedded project awkward to configure: users can select the firmware image but cannot conveniently select the workspace root that owns `.linkterm/control-profile.json`.

## What Changes

- Make the workspace directory picker WSL-aware on Windows.
- Prefer an available WSL home/root as the native directory dialog starting point so users can browse `\\wsl.localhost\<distro>\...` workspaces.
- Keep the existing native directory picker behavior when WSL is unavailable or cannot be enumerated.
- Add regression coverage for the dialog options so the workspace picker does not fall behind the firmware picker again.

## Impact

- Affected code areas:
  - `src/main/ipc/control-profile-ipc.ts`
  - `tests/unit/main/ipc/control-profile-ipc.test.ts`
  - `openspec/specs/workspace-control-profile/spec.md`
- Behavior impact:
  - Additive Windows behavior for WSL users.
  - Existing Windows local folders and non-Windows directory picking remain unchanged.
