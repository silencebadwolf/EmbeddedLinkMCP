# Design: preserve terminal prompt fidelity

`RenderState` will contain only state required for generic terminal behavior:
line/origin bookkeeping, streaming UTF-8 decoders, and outgoing echo matching.
The RT-Thread-specific prompt scanner and its idle flush timer will be removed.

Device-origin events continue through UTF-8 streaming decode and the existing
ANSI containment step, then flow to xterm without prompt-token substitution.
This keeps event ordering deterministic and avoids hiding, collapsing, delaying,
or relocating device text.

This decision intentionally means malformed or newline-free firmware output is
shown as emitted. A future friendly-display feature must be explicit and
workspace-configured; it must not become a hidden default transformation.
