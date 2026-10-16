# Snapdragon NPU framework research

Research and measurements from a Snapdragon 8 Elite / SM8750 / Hexagon V79 Android 16 phone. Reduced-refusal (`abliterated`, `uncensored`) is a property of model weights, **not** the inference engine. None of these labels guarantees that every prompt is answered or that answers are correct.

## Best fit: llama.cpp Hexagon

Upstream's Snapdragon build includes an actual Hexagon backend and a separate Adreno OpenCL backend. The device flag **HTP0** selects Hexagon. It runs supported GGUF architectures without QNN graph export per checkpoint, which makes community reduced-refusal models much easier to use than LiteRT bundles.

Using the official Android Snapdragon **b11681** build, Q4_0 weights, `--device HTP0 -ngl 99 -t 6 -fa 1`:

| Model | pp128 tok/s | pp512 tok/s | tg64 tok/s |
| --- | ---: | ---: | ---: |
| mlabonne Gemma-3-4B IT abliterated | 972 | 974 | 16.1 |
| Huihui Qwen3-4B Instruct 2507 abliterated | 670 | 805 | 16.4 |

Qwen was requantized from Q8_0 to Q4_0 on the phone in about 14 seconds. Requantization is lossy; quantizing from original weights is preferable where available. A 572-token question-last probe answered correctly, and a real Pi request with default tools completed in about six seconds. These short checks are not a full model-quality, thermal, battery or long-running stability evaluation.

`llama-server` supplies an OpenAI-compatible API, streaming and Jinja tool templates. **The tested Android build cannot use router mode** (`subprocess is not enabled on this build`), despite advertising router flags. This plugin therefore provides its own serialized model-routing gateway.

Sources:
- [Upstream Snapdragon usage/build documentation](https://github.com/ggml-org/llama.cpp/blob/master/docs/backend/snapdragon/README.md)
- [Hexagon architecture](https://github.com/ggml-org/llama.cpp/blob/master/docs/backend/snapdragon/developer.md)
- [Android builds](https://github.com/ggml-org/llama.cpp/releases)
- [Qwen reduced-refusal GGUF](https://huggingface.co/mradermacher/Huihui-Qwen3-4B-Instruct-2507-abliterated-GGUF)
- [Gemma reduced-refusal GGUF](https://huggingface.co/bartowski/mlabonne_gemma-3-4b-it-abliterated-GGUF)

## LiteRT-LM: keep official Gemma 4, qualify custom exports

The official SM8750 Gemma-4-E2B bundle measured about **3644 tok/s prefill and 38 tok/s decode**; a 549-token question-last probe and Pi tool invocation worked. It is the original instruction-tuned model, not an abliterated variant.

Custom Gemma-3 and Qwen3 exports can run fast for short prompts but failed multi-chunk prompts on this device. Do not equate a successful synthetic benchmark with usable Pi context. The reduced-refusal Gemma-4 GPU conversion measured about **5–7 tok/s**, with variable quality under Pi's longer prompt.

Two repaired export/runtime mismatches were separately observed: unused final-layer prefill KV inputs left FLOAT32 while decode uses INT16, and a Qwen chat template discarding typed-part user content. Fixing those made short conversation work but did not fix the multi-chunk defect. These findings do **not** prove that all frameworks, all Qwen models or all NPU paths are broken.

Sources:
- [LiteRT-LM multi-chunk issue #3508](https://github.com/google-ai-edge/LiteRT-LM/issues/3508)
- [Final-layer KV dtype issue #3846](https://github.com/google-ai-edge/LiteRT-LM/issues/3846)
- [Official Gemma 4 bundles](https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm)

## Other candidates (researched, not tested here)

| Framework | Custom reduced-refusal weights | Tradeoff |
| --- | --- | --- |
| Qualcomm AI Hub / Genie / GenieX QAIRT | Possible through custom checkpoint quantization/export | Official recipes exist, but custom AIMET quantization requires CUDA and substantial VRAM; a 24 GB GPU is below the recipe's recommended range. Export/cloud services may require an AI Hub account. |
| MNN QNN | Supports conversion/offline compilation for some LLMs | More graph/export setup than GGUF; operator/device compatibility must be verified per model. |
| ExecuTorch QNN | Can export supported HF checkpoints | Viable research path, but still a model-specific export/quantization pipeline, not arbitrary GGUF loading. |
| Nexa SDK | NPU support exists, but custom-weight availability varies | Documentation includes gated NPU artifacts/access-token workflows. Do not assume an arbitrary abliterated checkpoint works. |

Qualcomm's repository reports Qwen3-4B Genie on Galaxy S25 at roughly **554 prefill / 26 decode tok/s**. This is a vendor result under different settings, **not a measurement of the plugin or proof it is faster for a custom checkpoint**. GenieX QAIRT and llama.cpp rows have different configurations and are not interchangeable.

Sources:
- [Qwen3-4B AI Hub recipe (GPU requirements and custom checkpoints)](https://github.com/qualcomm/ai-hub-models/blob/main/src/qai_hub_models/models/qwen3_4b/README.md)
- [Vendor benchmark configurations](https://github.com/qualcomm/ai-hub-models/blob/main/src/qai_hub_models/models/qwen3_4b/perf.yaml)
- [MNN NPU documentation](https://mnn-docs.readthedocs.io/en/stable/inference/npu.html)
- [ExecuTorch Qualcomm backend](https://docs.pytorch.org/executorch/stable/backends-qualcomm.html)
- [Nexa Android NPU reference](https://docs.nexa.ai/en/nexa-sdk-android/APIReference_NPU)

Recommendation: use **llama.cpp Hexagon + a suitable reduced-refusal GGUF** for this phone's open-model path; keep the official LiteRT Gemma 4 bundle as the fast aligned alternative. Battery/energy efficiency and sustained throughput remain unmeasured.
