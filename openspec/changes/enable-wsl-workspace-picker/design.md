## Root Cause

`chooseFirmwareFile()` opens a native file picker. On Windows, that picker can navigate into WSL locations in the user's reported environment.

`chooseWorkspaceRoot()` opens a native directory picker with no `defaultPath` or WSL discovery. The Windows directory picker can start from a local shell namespace where WSL shares are not obvious or not visible. As a result, LinkTerm exposes WSL firmware selection but not WSL workspace selection.

## Approach

- Add a small main-process helper that resolves a workspace dialog `defaultPath`.
- On Windows, discover WSL candidates through `wsl.exe --list --quiet` and each distro's `$HOME`.
- Convert the discovered Linux home to a `\\wsl.localhost\<distro>\...` UNC path.
- If command discovery fails, fall back to enumerating `\\wsl.localhost\` and `\\wsl$\`.
- Pass the discovered path as `dialog.showOpenDialog({ defaultPath, properties: ['openDirectory'] })`.
- If no WSL path is available, omit `defaultPath` and keep the current behavior.

## Non-Goals

- Do not add a custom filesystem browser.
- Do not change the saved control profile schema.
- Do not force workspace roots to be WSL paths.
- Do not remove native Windows folder selection.
