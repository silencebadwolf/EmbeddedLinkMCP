# LinkTerm Web deployment

LinkTerm Web is a single-user Node service. It serves the browser app and the MCP endpoint from one process and one runtime; Electron and Vite are not needed in production. Shell, SSH, serial, J-Link and files belong to the **server machine**. A browser on another computer does not give the server access to that computer's USB devices or filesystem.

## Local development

Use Node 22.13+ and pnpm 9.15.0:

```text
pnpm install --frozen-lockfile
pnpm dev:web
```

Open `http://localhost:5174`. Vite proxies the API to the Node service on `127.0.0.1:8711`. The service's login token is stored in its data directory (`~/.linkterm-server/access-token` by default); `pnpm dev:web` prints the data directory and token-file path. `pnpm dev:server` starts the backend alone. Set `LINKTERM_SERVER_DATA_DIR` to an isolated absolute directory when testing.

## Production on one machine

Build a portable service directory with `pnpm pack:server`, then copy that entire generated `release/linkterm-server-<platform>-<arch>-<timestamp>/` directory to the target machine. From that directory run `node dist/index.js` with a compatible Node installation. On first start it creates private `access-token` and `credential-key` files in the configured data directory. The default listener is `127.0.0.1:8711`; open `http://127.0.0.1:8711` on the same machine and enter the token from `access-token`. The browser does not require Electron to be running.

The release directory includes `public/`, physical production dependencies, a CycloneDX SBOM, license attribution and `SHA256SUMS.txt`. The release smoke test copies it to another path and checks startup, page delivery, authentication and Node PTY loading. Do not copy only `dist/` or `public/` by themselves.

The service supports these environment variables:

| Variable | Purpose |
| --- | --- |
| `LINKTERM_SERVER_DATA_DIR` | Absolute data directory; default `~/.linkterm-server` |
| `LINKTERM_SERVER_HOST` / `LINKTERM_SERVER_PORT` | Listen address and port; default `127.0.0.1:8711` |
| `LINKTERM_PUBLIC_ORIGIN` | Exact public HTTPS origin for remote access, such as `https://linkterm.example.com` |
| `LINKTERM_WORKSPACE_ROOTS` | JSON array of 1–16 existing absolute directories browsable by the Web picker; default `<dataDir>/workspaces` |
| `LINKTERM_SERVER_TOKEN` | Optional externally managed 32-byte base64 login/MCP token; omit to use the private token file |
| `LINKTERM_WEB_DIR` | Optional absolute path to a different built Web static directory |

Give the service a dedicated ordinary OS account with access only to the devices and directories it needs. The workspace picker is confined to its configured roots, but the authenticated local-shell feature runs with the service account's full OS permissions. Run separate desktop and server data directories; the runtime rejects concurrent owners of one directory.

For remote access, terminate TLS at a reverse proxy and forward the original `Host` header, HTTP requests and WebSocket upgrades to the loopback service. Set `LINKTERM_PUBLIC_ORIGIN` to the exact public `https://` origin and keep the Node listener on `127.0.0.1`. A non-loopback Node bind requires an explicit HTTPS public origin. Browser cookies are HttpOnly, SameSite Strict and Secure for HTTPS deployments; mutating API calls require Origin and CSRF checks. Do not put the token in a URL, static file or browser localStorage.

The MCP endpoint is `<origin>/mcp` using `Authorization: Bearer <access-token>`. It exposes the same 63 tools and runtime as the Web UI. Configure an MCP client on the machine where that client runs; do not assume the browser can install local Agent configuration on its own computer. Browser UI patch operations go to the selected authenticated tab; screenshots are unavailable in Web mode.

The Agent integration screen can install a Codex HTTP MCP entry for the **server account** at `~/.codex/config.toml`. It points to `<origin>/mcp` and names `LINKTERM_MCP_TOKEN` as the bearer-token environment variable; it never writes the token into Codex's config file. Set that variable in the Codex process environment on the server host. For remote hosting, the configured public HTTPS origin must be reachable from that host too.

## Existing desktop data and recovery

Keep a backup of the old desktop data directory and the new server data directory, including `credential-key`. With the server stopped, preview connection metadata import:

```text
node apps/server/dist/migrate-connections.js --from <desktop-data-dir> --to <server-data-dir>
```

Add `--apply` to import into a server directory without an existing `connections.json`. The importer leaves the desktop file unchanged and strips desktop safeStorage ciphertext. Reenter saved SSH credentials through the Web UI. Control profiles stored in individual workspaces stay in those directories; configure their parent paths in `LINKTERM_WORKSPACE_ROOTS`.

If a process crashes, `.runtime-owner.json` may remain. Verify the recorded PID is no longer running **and** no other process owns the data directory before removing that file; the service never silently steals a lock. If the credential key is lost, existing encrypted credentials cannot be recovered from the profiles alone. Restore the matching data-directory backup or reenter the credentials.

Hardware, SSH endpoints and firmware writes must be validated on the actual deployment machine before relying on them. The automated smoke checks use local PTY and synthetic fixtures only.
