// Qwen3-VL 動画アノテーション
// 動画をセグメントに分割し、各セグメントのフレームを llama-server に送って
// 「何をしているか」の一言説明を取得し、再生時刻に合わせて表示する。

// UI 未入力時に使う既定のシステムプロンプト(汎用。一人称視点に限らない)
const DEFAULT_SYSTEM_PROMPT =
  "これは動画から連続して切り出した複数のフレームです。" +
  "映っている人が何をしているか(何が行われているか)を日本語で一言(短い文)で答えてください。" +
  "例:「猫を撫でる」「ドアを開ける」「コップに水を注ぐ」。" +
  "説明文のみを出力し、前置きや補足は書かないでください。";

// UI 未入力時に使う既定のユーザープロンプト(各セグメントの画像に添える質問)
const DEFAULT_USER_PROMPT = "何が行われていますか?一言で。";

const FRAMES_PER_SEGMENT = 3; // セグメントの始・中・終から1枚ずつ
const FRAME_MAX_SIZE = 512;   // 長辺の縮小サイズ(px)

// ---- DOM ----
const $ = (id) => document.getElementById(id);
const serverUrlInput = $("server-url");
const intervalInput = $("segment-interval");
const fileInput = $("video-file");
const processBtn = $("process-btn");
const cancelBtn = $("cancel-btn");
const exportBtn = $("export-btn");
const progressArea = $("progress-area");
const progressBar = $("progress-bar");
const progressText = $("progress-text");
const statusMessage = $("status-message");
const playerPanel = $("player-panel");
const player = $("player");
const currentAnnotationText = $("current-annotation-text");
const timelinePanel = $("timeline-panel");
const timelineList = $("timeline-list");
const extractVideo = $("extract-video");
const togglePromptBtn = $("toggle-prompt-btn");
const promptArea = $("prompt-area");
const systemPromptInput = $("system-prompt");
const userPromptInput = $("user-prompt");
const resetPromptBtn = $("reset-prompt-btn");

// ---- 状態 ----
let videoURL = null;
let annotations = []; // { start, end, text }
let processing = false;
let cancelRequested = false;
let abortController = null;
let activeIndex = -1;

// ---- ユーティリティ ----
function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function showStatus(text, kind) {
  statusMessage.textContent = text;
  statusMessage.className = kind;
  statusMessage.hidden = false;
}

function clearStatus() {
  statusMessage.hidden = true;
  statusMessage.textContent = "";
}

// ---- 動画ファイル選択 ----
fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (!file) return;

  if (videoURL) URL.revokeObjectURL(videoURL);
  videoURL = URL.createObjectURL(file);

  player.src = videoURL;
  extractVideo.src = videoURL;

  annotations = [];
  timelineList.innerHTML = "";
  currentAnnotationText.innerHTML = "&nbsp;";
  activeIndex = -1;

  playerPanel.hidden = false;
  timelinePanel.hidden = true;
  exportBtn.hidden = true;
  processBtn.disabled = false;
  clearStatus();
});

// ---- フレーム抽出 ----
function waitForEvent(target, event, errorEvent) {
  return new Promise((resolve, reject) => {
    const onOk = () => { cleanup(); resolve(); };
    const onErr = () => { cleanup(); reject(new Error(`video ${errorEvent}`)); };
    const cleanup = () => {
      target.removeEventListener(event, onOk);
      if (errorEvent) target.removeEventListener(errorEvent, onErr);
    };
    target.addEventListener(event, onOk, { once: true });
    if (errorEvent) target.addEventListener(errorEvent, onErr, { once: true });
  });
}

async function ensureMetadata() {
  if (extractVideo.readyState < 1) {
    await waitForEvent(extractVideo, "loadedmetadata", "error");
  }
  // MediaRecorder 製の webm などは duration が Infinity になることがある。
  // 末尾へシークすると実際の長さが確定する。
  if (!isFinite(extractVideo.duration)) {
    const seeked = waitForEvent(extractVideo, "seeked", "error");
    extractVideo.currentTime = 1e7;
    await seeked;
    extractVideo.currentTime = 0;
  }
  if (!isFinite(extractVideo.duration) || extractVideo.duration <= 0) {
    throw new Error("動画の長さを取得できませんでした");
  }
}

const captureCanvas = document.createElement("canvas");

async function captureFrame(time) {
  const seeked = waitForEvent(extractVideo, "seeked", "error");
  extractVideo.currentTime = time;
  await seeked;

  const w = extractVideo.videoWidth;
  const h = extractVideo.videoHeight;
  const scale = Math.min(1, FRAME_MAX_SIZE / Math.max(w, h));
  captureCanvas.width = Math.round(w * scale);
  captureCanvas.height = Math.round(h * scale);
  const ctx = captureCanvas.getContext("2d");
  ctx.drawImage(extractVideo, 0, 0, captureCanvas.width, captureCanvas.height);
  return captureCanvas.toDataURL("image/jpeg", 0.8);
}

// ---- 推論リクエスト ----
async function describeSegment(serverUrl, systemPrompt, userPrompt, frames) {
  const content = frames.map((dataUrl) => ({
    type: "image_url",
    image_url: { url: dataUrl },
  }));
  content.push({ type: "text", text: userPrompt });

  abortController = new AbortController();
  const res = await fetch(`${serverUrl}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: abortController.signal,
    body: JSON.stringify({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content },
      ],
      temperature: 0,
      max_tokens: 50,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`サーバーエラー (HTTP ${res.status}): ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  return (json.choices?.[0]?.message?.content ?? "").trim();
}

// ---- タイムライン描画 ----
function addTimelineItem(annotation, index) {
  const li = document.createElement("li");
  li.dataset.index = index;

  const time = document.createElement("span");
  time.className = "time";
  time.textContent = `${formatTime(annotation.start)} - ${formatTime(annotation.end)}`;

  const text = document.createElement("span");
  text.className = "text";
  text.textContent = annotation.text;

  li.append(time, text);
  li.addEventListener("click", () => {
    player.currentTime = annotation.start;
  });
  timelineList.appendChild(li);
  timelinePanel.hidden = false;
}

// ページ全体ではなく timelineList の内側だけをスクロールする。
// アクティブ項目を枠の下端に寄せることで、過去の項目が上へ流れていく表示になる。
function scrollListItemIntoView(li) {
  const target = li.offsetTop + li.offsetHeight - timelineList.clientHeight;
  timelineList.scrollTop = Math.max(0, target);
}

// ---- 処理本体 ----
processBtn.addEventListener("click", async () => {
  if (processing || !videoURL) return;

  const serverUrl = serverUrlInput.value.trim().replace(/\/+$/, "");
  const interval = Math.max(1, Number(intervalInput.value) || 3);
  const systemPrompt = systemPromptInput.value.trim() || DEFAULT_SYSTEM_PROMPT;
  const userPrompt = userPromptInput.value.trim() || DEFAULT_USER_PROMPT;

  processing = true;
  cancelRequested = false;
  processBtn.disabled = true;
  cancelBtn.hidden = false;
  exportBtn.hidden = true;
  annotations = [];
  timelineList.innerHTML = "";
  activeIndex = -1;
  clearStatus();

  try {
    await ensureMetadata();
    const duration = extractVideo.duration;

    // セグメント一覧を作成(末尾の短い端数は前のセグメントへ統合)
    const segments = [];
    for (let start = 0; start < duration; start += interval) {
      segments.push({ start, end: Math.min(start + interval, duration) });
    }
    if (segments.length >= 2) {
      const last = segments[segments.length - 1];
      if (last.end - last.start < interval * 0.5) {
        segments[segments.length - 2].end = last.end;
        segments.pop();
      }
    }

    progressArea.hidden = false;
    progressBar.value = 0;
    progressBar.max = segments.length;
    progressText.textContent = `0 / ${segments.length}`;

    for (let i = 0; i < segments.length; i++) {
      if (cancelRequested) break;
      const { start, end } = segments[i];

      // 始・中・終のフレームを抽出(末尾ぴったりは避ける)
      const span = end - start;
      const times = [];
      for (let f = 0; f < FRAMES_PER_SEGMENT; f++) {
        const t = start + (span * (f + 0.5)) / FRAMES_PER_SEGMENT;
        times.push(Math.min(t, duration - 0.05));
      }
      const frames = [];
      for (const t of times) {
        frames.push(await captureFrame(Math.max(0, t)));
      }

      if (cancelRequested) break;
      const text = await describeSegment(serverUrl, systemPrompt, userPrompt, frames);

      const annotation = { start, end, text };
      annotations.push(annotation);
      addTimelineItem(annotation, annotations.length - 1);

      progressBar.value = i + 1;
      progressText.textContent = `${i + 1} / ${segments.length}`;
    }

    if (cancelRequested) {
      showStatus("処理をキャンセルしました。途中までのアノテーションは利用できます。", "info");
    } else {
      showStatus(`処理が完了しました(${annotations.length} セグメント)。再生するとアノテーションが表示されます。`, "info");
    }
    if (annotations.length > 0) exportBtn.hidden = false;
  } catch (err) {
    if (err.name === "AbortError") {
      showStatus("処理をキャンセルしました。", "info");
      if (annotations.length > 0) exportBtn.hidden = false;
    } else if (err instanceof TypeError) {
      // fetch の接続失敗
      showStatus(
        "llama-server に接続できません。別のターミナルで以下を実行してください:\n" +
          "  ./run-server.sh(macOS)/ run-server.bat(Windows)\n" +
          `(接続先: ${serverUrl})`,
        "error"
      );
    } else {
      showStatus(`エラー: ${err.message}`, "error");
    }
  } finally {
    processing = false;
    processBtn.disabled = false;
    cancelBtn.hidden = true;
    abortController = null;
  }
});

cancelBtn.addEventListener("click", () => {
  cancelRequested = true;
  if (abortController) abortController.abort();
});

// ---- 再生連動 ----
player.addEventListener("timeupdate", () => {
  if (annotations.length === 0) return;
  const t = player.currentTime;
  const index = annotations.findIndex((a) => t >= a.start && t < a.end);
  if (index === activeIndex) return;

  activeIndex = index;
  const items = timelineList.children;
  for (const li of items) li.classList.remove("active");

  if (index >= 0) {
    currentAnnotationText.textContent = annotations[index].text;
    const li = items[index];
    if (li) {
      li.classList.add("active");
      scrollListItemIntoView(li);
    }
  } else {
    currentAnnotationText.innerHTML = "&nbsp;";
  }
});

// ---- JSON エクスポート ----
exportBtn.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(annotations, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "annotations.json";
  a.click();
  URL.revokeObjectURL(a.href);
});

// ---- プロンプト設定 ----
systemPromptInput.value = DEFAULT_SYSTEM_PROMPT;
userPromptInput.value = DEFAULT_USER_PROMPT;

togglePromptBtn.addEventListener("click", () => {
  const willShow = promptArea.hidden;
  promptArea.hidden = !willShow;
  togglePromptBtn.textContent = willShow
    ? "プロンプト設定を隠す"
    : "プロンプト設定を表示";
});

resetPromptBtn.addEventListener("click", () => {
  systemPromptInput.value = DEFAULT_SYSTEM_PROMPT;
  userPromptInput.value = DEFAULT_USER_PROMPT;
});
