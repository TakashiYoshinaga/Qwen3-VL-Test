#!/bin/sh
# Qwen3-VL-4B を llama-server で起動する。
# 初回実行時は Hugging Face からモデル(約3GB)と mmproj を自動ダウンロードする。
exec llama-server \
  -hf unsloth/Qwen3-VL-4B-Instruct-GGUF:Q4_K_M \
  --port 8080 \
  -c 8192 \
  -ngl 99
