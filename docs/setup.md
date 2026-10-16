# Setup and recovery

## Prerequisites

The plugin runs in the phone's Termux PI WEB session daemon, not on a desktop controlling a phone. It assumes:

- Node 22+ and `adb`, `curl` are available in Termux's PATH.
- Termux's adb key is paired and authorized for this device. The default endpoint is `127.0.0.1:5555`.
- llama.cpp's Android **Snapdragon** build is extracted under `/data/local/tmp/llama/llama-bNNNNN/{bin,lib}`. Plain Android CPU builds do not provide the required Hexagon runtime.
- GGUF files live directly under `/data/local/tmp/llama/gguf/`.
- LiteRT models live directly under `/data/local/tmp/llm/`, with imports under `/data/local/tmp/llm/home/.litert-lm/models/<name>/model.litertlm`.
- The existing shell-readable Python installation is under `/data/local/tmp/py/`, including `lib/python3.13` and `site-packages` for LiteRT-LM. The plugin installs its launchers, not this Python distribution or vendor runtime.
- Qualcomm QNN and LiteRT dispatch libraries for the device are already under `/data/local/tmp/llm/`. LiteRT benchmarking additionally requires the existing `lbench` runner in that directory.

Do not distribute vendor binaries, Python environments, model weights, device adb keys or Pi credentials inside the plugin repository.

## Installation on an existing prepared phone

Install this git package in **Settings → Pi packages**, or put its files under `~/.pi-web/plugins/edge-model`. For a newly added server plugin, restart both the session daemon and web/API process, then refresh the browser. A session-daemon restart interrupts active agent work: wait for it to finish first.

On the prepared phone in this project, `~/.local/bin/pi-web-up` starts the two tmux services; stop their old tmux sessions before using it to load a changed server plugin. This is a device-local operational convention, not part of the package API.

Open **Go to → Models**, select **Install launchers**, wait for completion, then **Sync Pi models**. The plugin writes a single `litert` provider to `~/.pi/agent/models.json`, pointing at `http://127.0.0.1:9390/v1`. Existing provider entries remain unchanged and a mode-0600 backup is retained at `models.json.bak-edge-models`. Model IDs include `llamacpp--` or `litert--` so names cannot collide across engines.

Initial import preserves models already offered by the old `litert` provider. Custom LiteRT Qwen3/Gemma-3 experimental bundles known to fail longer prompts stay hidden. New downloads stay hidden until explicitly offered. Increasing a compiled LiteRT context is refused; increasing GGUF context consumes more RAM and must be tested.

Retire any external watchdog that independently restarts engines. Otherwise it can reload an engine behind the gateway's back and defeat memory/residency ownership. This plugin recovers the resident engine after an adb restart and starts stopped engines on demand.

## Download and benchmark behavior

Only public HuggingFace `owner/repo` plus a single exact filename is accepted. Nested paths, arbitrary URLs, private model tokens and overwriting existing weight files are refused. Downloads verify expected length and magic bytes, and SHA-256 when advertised by HuggingFace. Intermediate device files use `.part` names and are not offered for inference.

One job runs at a time. A benchmark or download with conversion pauses inference to avoid loading two full models into memory. Workers are detached Node processes with durable JSON status and bounded diagnostic logs in the plugin's storage directory. Killing Termux or rebooting can terminate workers; the page reports an interrupted worker as failed rather than completed. Download cancellation is available during fetching only. Failed/cancelled partial files may remain for inspection and use storage.

The **Benchmark** operation uses one repeat of 128 input / 64 output tokens for llama.cpp, or 256 / 128 for LiteRT. It reports real measured values only; a missing result is a failure, never 0 tok/s success.

## Security / recovery

ADB TCP mode is separate from the inference gateway. `adb tcpip 5555` may listen on more than loopback interfaces: use only trusted networks and revoke unneeded debugging keys. This plugin does not enable debugging, change USB-lock policy or disable Android process restrictions. After a reboot, adb TCP mode may require manually re-enabling through wireless debugging or a USB connection.

Samsung can restart adbd on lock/unlock. Its cgroup children die with it, so the next request may pay both a restart and model-load delay. An interrupted stream is reported as failed; the plugin does not pretend its partial output completed.

If PI WEB is blocked by `NET::ERR_CERT_AUTHORITY_INVALID`, the web server may be healthy: fix trust of its local HTTPS certificate separately. Do not disable global browser TLS verification.

If the plugin itself fails to load, disable `edge-model` in PI WEB's plugin settings, or remove/disable the local plugin and restart sessiond. Existing backend binaries/models are untouched by uninstalling the package. Restore the saved `models.json` backup only if you intend to revert **all** changes since that backup; a selective edit to `providers.litert` is safer when other providers have changed.
