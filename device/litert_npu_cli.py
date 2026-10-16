"""litert-lm CLI entry for the adb shell user, with the Qualcomm NPU dispatch dir injected.

The stock CLI builds Backend.NPU() without a dispatch dir, which only supports
Intel OpenVINO on Windows; LITERT_NPU_LIB points at the QNN + LiteRT dispatch
libraries pushed to /data/local/tmp/llm.
"""
import os
import sys

from litert_lm import interfaces
from litert_lm_cli import model as cli_model
from litert_lm_cli.main import main

LIB_DIR = os.environ.get("LITERT_NPU_LIB", "/data/local/tmp/llm")
_orig = cli_model._create_backend_obj


def _create_backend_obj(backend_name, *args, **kwargs):
    if backend_name == "npu":
        return interfaces.NPU(litert_dispatch_lib_dir=LIB_DIR)
    return _orig(backend_name, *args, **kwargs)


cli_model._create_backend_obj = _create_backend_obj

if __name__ == "__main__":
    sys.argv[0] = "litert-lm"
    sys.exit(main())
