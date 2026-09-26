# Qwen3-VL Video Annotation

English | [日本語](README_JP.md)

A local web app that takes a recorded video (e.g., first-person footage), has Qwen3-VL-4B (via llama.cpp) describe "what is happening" in one short phrase per segment, and shows that description under the video in sync with playback.

[![Demo video](https://img.youtube.com/vi/NyjEXgAM1rk/maxresdefault.jpg)](https://www.youtube.com/watch?v=NyjEXgAM1rk)

[▶ Demo video (YouTube)](https://www.youtube.com/watch?v=NyjEXgAM1rk)

## Requirements

- llama.cpp
  - macOS: `brew install llama.cpp`
  - Windows: `winget install llama.cpp` (or extract a prebuilt binary from [GitHub Releases](https://github.com/ggml-org/llama.cpp/releases) and add it to your PATH)
- Python 3 (to serve the frontend; preinstalled on macOS, on Windows get it from [python.org](https://www.python.org/downloads/) or `winget install Python.Python.3.12`)

## Usage (macOS)

### 1. Start the model server

```sh
./run-server.sh
```

On the first run, the model (about 2.5 GB) and the mmproj file are downloaded automatically from Hugging Face.
The server is ready when you see `server is listening on http://127.0.0.1:8080`.

### 2. Serve the frontend

In another terminal:

```sh
python3 -m http.server 8000
```

Open http://localhost:8000 in your browser.

## Usage (Windows)

### 1. Start the model server

In Command Prompt (or PowerShell), move to this folder and run:

```bat
run-server.bat
```

On the first run, the model (about 2.5 GB) and the mmproj file are downloaded automatically.
The server is ready when you see `server is listening on http://127.0.0.1:8080`.

> **About GPUs**: For NVIDIA GPUs, use the CUDA build from GitHub Releases
> (`llama-*-bin-win-cuda-*.zip`); for other GPUs, the Vulkan build is faster.
> The CPU build also works but is slower (`-ngl 99` is simply ignored by the CPU build and is harmless).

To run llama-server directly with model files you already have locally (for example, ones downloaded by LM Studio), use a command like this:

```bat
cd C:\llama-cpp

llama-server.exe ^
  -m "C:\Users\<UserName>\.lmstudio\models\unsloth\Qwen3-VL-4B-Instruct-GGUF\Qwen3-VL-4B-Instruct-Q4_K_M.gguf" ^
  --mmproj "C:\Users\<UserName>\.lmstudio\models\unsloth\Qwen3-VL-4B-Instruct-GGUF\mmproj-F32.gguf" ^
  --host 0.0.0.0 ^
  --port 8080 ^
  --ui-mcp-proxy ^
  --reasoning off
```

### 2. Serve the frontend

In another Command Prompt, move to this folder and run:

```bat
py -m http.server 8000
```

(If `py` is not available, use `python -m http.server 8000`.)

Open http://localhost:8000 in your browser.

### 3. Process a video

1. Select a video file
2. Adjust the segment interval if needed (default: 3 seconds)
3. If needed, edit the system/user prompts under "Show prompt settings".
   Segments whose output matches one of the "Ignore words" (comma-separated)
   are excluded from both the timeline and the JSON (exact match after stripping trailing punctuation)
4. Click "Start" and wait for the progress bar to finish
5. During playback, the current action description is shown in the annotation area under the video
6. Click a row in the timeline to jump to that time
7. Click "Download JSON" to save an array of `{start, end, text}`

> The UI supports Japanese and English. Use the "日本語 / English" switch in the top right
> (the initial language follows your browser setting, and your choice is remembered).
> The default prompts also change with the language, so the model answers in the selected language.
> Prompts you have edited are kept when you switch languages.

## How it works

- The video is split into N-second segments, and 3 frames are extracted from each segment with `<canvas>` (downscaled so the long side is 512 px)
- The frames are sent to llama-server's OpenAI-compatible API (`/v1/chat/completions`) to get a one-phrase description
- During playback, the `timeupdate` event is used to show the description of the segment at the current time

## Example prompts (classification task)

An example for classifying each segment into fixed labels instead of free-form descriptions:
classifying VR fire-extinguishing training footage into five labels —
"Checking the surroundings", "Checking the extinguisher", "Extinguishing", "Extinguishing complete", and "Other".

**System prompt:**

```
You are an assistant that watches VR fire-extinguishing training footage and classifies the action happening at that moment.
Look at the given frames, choose the single best-matching label from the five below,
and output only that label string. When the check-mark UI appears, extinguishing is complete.

- Checking the surroundings
- Checking the extinguisher
- Extinguishing
- Extinguishing complete
- Other

Output rules:
- The output must exactly match one of the five strings above (no punctuation, politeness, explanations, or reasons)
- If none of the above applies, or the action cannot be determined from the footage, always output "Other"
- Output only one label; never list multiple labels
```

**User prompt:**

```
Answer with exactly one of the five labels specified in the system prompt for the action happening in these frames.
Do not output anything other than the label.
When the check-mark UI appears, extinguishing is complete.
```

**Tips:**

- Write the label list in both the system prompt and the user prompt (the model strongly prioritizes
  the instructions in the latest user message, so repeating it in both improves compliance, even if redundant)
- "Output an empty string if nothing applies" is unreliable with small models (they rarely generate an empty
  string and tend to write something). It is more stable to have them output a concrete string like "Other"
  and treat it as "nothing notable" on the consumer side
- Outputs outside the label set can still occur, because 4B-class models are weak at following
  "never output anything outside this set" constraints. If you need strict compliance, you can use
  llama-server's GBNF grammar feature to attach a grammar constraint to the request and force the output to be one of the five labels
- If you set `Other` in "Ignore words" under the prompt settings, segments classified as "Other"
  are not shown on the timeline (nothing is displayed while those sections are playing)

## Processing time

On Apple Silicon (M-series) Macs, each segment takes a few seconds. A 1-minute video (3-second interval = 20 segments) takes about 1–2 minutes.
Increasing the segment interval makes processing faster.

## Using other models

The app only talks to llama-server's OpenAI-compatible API, so any model with image input support works as-is —
other Qwen models or models from other vendors such as Gemma — just by changing the model in the server launch command.
Note that Gemma handles the system prompt differently from Qwen, so prompts may behave differently.
Adjust the prompts as needed.

## License

[MIT](LICENSE)
