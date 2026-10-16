# Boundaries and invariants

- `browser/pi-web-plugin.js`: global Models page. Uses host `callOperation`, `ui.renderList` and `ui.confirm`; no private PI WEB routes or browser credential reads. A failed read disables model actions rather than treating a stale list as current.
- `server-plugin.js`: bounded machine operations, initial adoption, job settlement and plugin lifecycle. It does not claim a workspace provider.
- `server/device.js`: adb argv and shell boundary. All data interpolated into shell commands is validated and shell-quoted.
- `server/catalog.js`: observed device files plus plugin metadata. Missing adb is an error, not an empty list. Models outside the managed roots are refused.
- `server/gateway.js`: localhost OpenAI proxy, one serialized residency lane held until each request's stream finishes. Switching model/engine waits behind active requests. Unknown/hidden models return 404 rather than answering with another model. It stops both engine processes before a new residency to recover safely from untracked old processes.
- `server/store.js`: serialized plugin metadata changes, not engine truth.
- `server/provider.js`: atomic, mode-0600 writes to exactly `providers.litert`, with a backup and invalid-JSON refusal. Other provider credentials never cross the browser boundary.
- `server/jobs.js` / `termux/job.mjs`: one detached long job at a time. Completion is stored explicitly; registration failures remain visible. Benchmark/conversion jobs block inference.
- `device/`: small launcher/stop scripts run as adb shell. Engines bind only to loopback and use already-provisioned runtimes/weights.

## Scope

Everything is about the selected PI WEB machine, not its current project or session. The browser page's cached state carries that machine identity. Files are device paths, not paths supplied by the browser. Names are validated at both browser-operation and worker boundaries.

## Known limits

- Prepared Snapdragon/Termux layout, not a generic Android model installer. No root, no credentials, no hidden system-security changes.
- HTTP inference gateway has no authentication because it binds to loopback; other local processes can use it. It is not suitable for exposing to a network.
- Generation is serialized on purpose; parallel chat users queue. This reduces memory pressure and prevents model-switch races.
- Backend generation errors are not swallowed or turned into synthetic successful finish events.
- A compatible shape/quantization does not guarantee NPU correctness. Test long prompts, tool calls and model identity, not only benchmark throughput.
- Smaller context and lower-precision weights trade capability for memory. “Abliterated” is not a quality benchmark or a promise of zero refusals.
- Loading large models can still trigger Android's memory killer. The plugin cannot prevent Termux itself being killed; recover Termux/PI WEB first.
