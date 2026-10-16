# PI WEB Edge Model

A machine-scoped **Models** page for managing Android-local inference from PI WEB. It manages **llama.cpp Hexagon** GGUF models and **LiteRT-LM** bundles, behind the existing Pi provider **`litert`**.

- Inspect models, storage, memory and engine availability.
- Load/unload models, recover after adb restarts, and control context size.
- Download public HuggingFace files, optionally requantize GGUF to Q4_0, benchmark and delete with confirmation.
- Sync only `providers.litert` in Pi's model configuration; other providers stay untouched.

## Install

Requires a recent PI WEB with global plugin pages, operations and durable plugin storage, running **inside Termux on the phone**. Engines, paired local adb, and the shell-readable Python/QNN runtime must already be provisioned. This is a manager, not a one-click NPU installer.

In PI WEB **Settings → Pi packages**, install:

```text
https://github.com/VincentHanxiaoDu/pi-web-edge-model
```

Or place a checkout under `~/.pi-web/plugins/edge-model`. Restart the phone's session daemon to load the server entry (this can interrupt active sessions), then reload the page. Open **Go to → Models**, install the launchers, and select **Sync Pi models**.

Downloads are initially **hidden from Pi**. Load and test them before choosing **Offer to Pi**.

## Security and operation

This is trusted code with the same permissions as PI WEB and the paired adb shell. The gateway listens only on `127.0.0.1:9390`. It loads the requested model rather than silently substituting another and keeps at most one engine resident.

Do not expose adb or the inference ports to untrusted networks. Public downloads require no tokens; this package accepts and stores **no HuggingFace credentials**. Pi's existing config and its backup may contain credentials: keep both private and outside this repository.

- [Setup and recovery](docs/setup.md)
- [Design and limitations](docs/design.md)
- [Framework research and phone measurements](docs/research.md)

Local check: `npm run check`. The phone and browser are the integration verification environment; a syntax check is not an NPU test.
