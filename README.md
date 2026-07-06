# Qwen3-VL 動画アノテーション

撮影済みの動画(一人称視点など)を渡すと、Qwen3-VL-4B(llama.cpp)が「何をしているか」をセグメントごとに一言で説明し、再生時刻に合わせて動画の下に表示するローカルWebアプリ。

## 必要なもの

- llama.cpp
  - macOS: `brew install llama.cpp`
  - Windows: `winget install llama.cpp`(または [GitHub Releases](https://github.com/ggml-org/llama.cpp/releases) のビルド済みバイナリを展開して PATH を通す)
- Python 3(フロントエンド配信用。macOS は標準搭載、Windows は [python.org](https://www.python.org/downloads/) か `winget install Python.Python.3.12`)

## 使い方(macOS)

### 1. モデルサーバーを起動

```sh
./run-server.sh
```

初回はモデル(約2.4GB)+ mmproj が Hugging Face から自動ダウンロードされる。
`server is listening on http://127.0.0.1:8080` と出たら準備完了。

### 2. フロントエンドを配信

別のターミナルで:

```sh
python3 -m http.server 8000
```

ブラウザで http://localhost:8000 を開く。

## 使い方(Windows)

### 1. モデルサーバーを起動

コマンドプロンプト(または PowerShell)でこのフォルダに移動し:

```bat
run-server.bat
```

初回はモデル(約2.4GB)+ mmproj が自動ダウンロードされる。
`server is listening on http://127.0.0.1:8080` と出たら準備完了。

> **GPU について**: NVIDIA GPU で使う場合は GitHub Releases の CUDA 版バイナリ
> (`llama-*-bin-win-cuda-*.zip`)を、それ以外の GPU は Vulkan 版を使うと高速。
> CPU 版でも動作するが処理時間は長くなる(`-ngl 99` は CPU 版では無視されるだけで無害)。

### 2. フロントエンドを配信

別のコマンドプロンプトでこのフォルダに移動し:

```bat
py -m http.server 8000
```

(`py` が無い場合は `python -m http.server 8000`)

ブラウザで http://localhost:8000 を開く。

### 3. 動画を処理

1. 動画ファイルを選択
2. 必要ならセグメント間隔(既定 3 秒)を調整
3. 「処理開始」→ 進捗バーが完了するまで待つ
4. 再生すると、動画下のアノテーション欄に現在の行動説明が表示される
5. タイムラインの行をクリックするとその時刻へジャンプ
6. 「JSONダウンロード」で `{start, end, text}` の配列を保存できる

## 仕組み

- 動画を N 秒のセグメントに分割し、各セグメントから 3 フレームを `<canvas>` で抽出(長辺 512px に縮小)
- フレームを llama-server の OpenAI 互換 API(`/v1/chat/completions`)へ送信し、一言説明を取得
- 再生中は `timeupdate` イベントで現在時刻に該当するセグメントの説明を表示

## 処理時間の目安

M系チップで 1 セグメントあたり数秒。1 分の動画(3 秒間隔 = 20 セグメント)で 1〜2 分程度。
セグメント間隔を広げると高速化できる。
