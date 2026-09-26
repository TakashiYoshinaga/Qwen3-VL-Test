#!/bin/sh
# Qwen3-VL-4B を llama-server で起動する。
# 初回実行時は Hugging Face からモデル(約2.5GB)と mmproj を自動ダウンロードする。
exec llama-server \
  -hf unsloth/Qwen3-VL-4B-Instruct-GGUF:Q4_K_M \
  --host 0.0.0.0 \
  --port 8080 \
  -c 8192 \
  -ngl 99
