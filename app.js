(() => {
  "use strict";

  const config = window.COMFY_CONFIG || {};
  const canonicalAuthRedirectUrl = "https://yinstagram.github.io/comfy-yinops/";
  const state = {
    client: null,
    session: null,
    authGeneration: 0,
    sessionEpoch: 0,
    readinessAuthorized: false,
    readinessPresetCount: null,
    pendingRecoveryBlocked: false,
    refreshDraft: null,
    enabledPresets: [],
    jobs: [],
  };

  const isValidHttpsUrl = (value) => {
    if (typeof value !== "string") return false;
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      return false;
    }
    return parsed.protocol === "https:"
      && parsed.username === ""
      && parsed.password === ""
      && parsed.search === ""
      && parsed.hash === "";
  };

  const isValidSupabaseUrl = (value) => {
    if (!isValidHttpsUrl(value)) return false;
    return new URL(value).pathname === "/";
  };

  const decodeJwtPart = (part) => {
    const normalized = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
    return JSON.parse(window.atob(padded));
  };

  const isPublishableKey = (value) => {
    if (typeof value !== "string" || value.startsWith("__") || value.startsWith("sb_secret_")) return false;
    if (value.startsWith("sb_publishable_")) return value.length > "sb_publishable_".length;
    const parts = value.split(".");
    if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return false;
    try {
      const publishable = decodeJwtPart(parts[1]);
      if (!publishable || typeof publishable !== "object" || publishable.role !== "anon") return false;
      return true;
    } catch {
      return false;
    }
  };

  const byId = (id) => document.getElementById(id);
  const connection = byId("connection");
  const headlineNote = byId("headline-note");
  const authCard = byId("auth-card");
  const composeCard = byId("compose-card");
  const authForm = byId("auth-form");
  const authSubmit = byId("auth-submit");
  const authNote = byId("auth-note");
  const jobForm = byId("job-form");
  const formNote = byId("form-note");
  const jobsBody = byId("jobs");
  const queuedCount = byId("queued-count");
  const runningCount = byId("running-count");
  const presetSelect = byId("preset");
  const promptInput = byId("prompt");
  const widthInput = byId("width");
  const heightInput = byId("height");
  const seedInput = byId("seed");
  const submitButton = byId("submit-job");
  const newJobButton = byId("new-job");
  const signOutButton = byId("sign-out");
  const refreshButton = byId("refresh-jobs");
  const readinessNote = byId("readiness-note");
  const releasedPresetCount = byId("released-preset-count");
  const activeJobCount = byId("active-job-count");
  const latestResult = byId("latest-result");
  const presetFacts = byId("preset-facts");
  const pendingStoragePrefix = "comfy:pending-enqueue:v1";

  const clearNode = (node) => {
    while (node.firstChild) node.removeChild(node.firstChild);
  };

  const sessionOwner = (session = state.session) => {
    const value = session && session.user && session.user.id;
    return typeof value === "string" && value.length > 0 ? value : null;
  };

  const sessionContext = () => ({
    epoch: state.sessionEpoch,
    ownerId: sessionOwner(),
    authGeneration: state.authGeneration,
  });

  const isCurrentSession = (context) => Boolean(
    context
      && context.epoch === state.sessionEpoch
      && context.ownerId
      && context.ownerId === sessionOwner()
  );

  const isCurrentReadiness = (context) => Boolean(
    isCurrentSession(context)
    && context.authGeneration === state.authGeneration
  );

  const pendingStorageKey = (ownerId) => pendingStoragePrefix + ":" + encodeURIComponent(ownerId);

  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  };

  const setStatus = (text, className) => {
    connection.textContent = text;
    connection.className = "status-pill " + (className || "neutral");
  };

  const setNote = (node, text, failed) => {
    node.textContent = text;
    node.classList.toggle("failed-note", Boolean(failed));
  };

  const safeError = (scope, error) => {
    console.error("Yinops Render " + scope, error);
    if (scope === "auth") return "登入未完成，請稍後再試。";
    if (scope === "readiness") return "暫時確認唔到帳戶授權；私人介面保持鎖住。";
    if (scope === "presets") return "暫時讀唔到已放行 preset；生成已鎖住。";
    if (scope === "enqueue") return "未能確認落單結果；原本 request key 已保留，可用同一設定安全重試。";
    if (scope === "cancel") return "未能確認取消結果，請先重新整理狀態。";
    return "暫時讀唔到資料，請稍後再試。";
  };

  const shortId = (value) => String(value || "").slice(0, 8);
  const timeLabel = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("zh-HK", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  };

  const tableCell = (label, value, className) => {
    const cell = element("td", className || "", value);
    cell.dataset.label = label;
    return cell;
  };

  const statusLabel = (status) => {
    const labels = {
      queued: "排隊中",
      running: "生成中",
      cancel_requested: "取消中",
      reconciling: "對賬中",
      verifying: "驗證中",
      blocked: "未放行",
      succeeded: "完成",
      failed: "失敗",
      canceled: "已取消",
    };
    return labels[status] || "未知";
  };

  const statusClass = (status) => {
    if (status === "succeeded") return "status succeeded";
    if (status === "failed" || status === "blocked") return "status failed";
    if (status === "canceled" || status === "cancel_requested") return "status muted-status";
    return "status";
  };

  const jobMessage = (row) => {
    if (row.status === "blocked") return "Preset 或 provenance 未通過。";
    if (row.status === "failed") return "生成未完成；內部錯誤已收起。";
    if (row.status === "cancel_requested") return "正等 worker 確認取消。";
    if (row.status === "reconciling") return "正核對 provider 結果，唔會重複送出。";
    if (row.status === "verifying") return "正核對檔案 hash 同媒體規格。";
    return "";
  };

  const verifiedArtifact = (row) => {
    const artifacts = Array.isArray(row.comfy_artifacts) ? row.comfy_artifacts : [];
    return artifacts.find((artifact) => artifact.verification_state === "verified") || null;
  };

  const appendResult = async (cell, row, artifact, context) => {
    if (!artifact || !state.client) {
      cell.append(element("span", "muted", row.status === "succeeded" ? "驗證結果未就緒" : "—"));
      return;
    }
    const result = await state.client.storage.from("comfy-outputs").createSignedUrl(artifact.storage_path, 600);
    if (!isCurrentReadiness(context)) return;
    if (result.error || !result.data || !result.data.signedUrl) {
      safeError("jobs", result.error || new Error("missing signed result URL"));
      cell.append(element("span", "muted", "結果連結未就緒"));
      return;
    }
    const isVideo = String(artifact.mime_type || "").startsWith("video/");
    const media = document.createElement(isVideo ? "video" : "img");
    media.className = "result-media";
    media.src = result.data.signedUrl;
    if (isVideo) {
      media.controls = true;
      media.preload = "metadata";
    } else {
      media.alt = "Job " + shortId(row.id) + " verified result";
      media.loading = "lazy";
    }
    cell.append(media);
  };

  const cancelJob = async (jobId) => {
    if (!state.client || !state.session || !state.readinessAuthorized) return;
    const context = sessionContext();
    const result = await state.client.rpc("comfy_cancel_job", { p_job_id: jobId });
    if (!isCurrentReadiness(context)) return;
    if (result.error) {
      setNote(formNote, safeError("cancel", result.error), true);
      return;
    }
    setNote(formNote, "取消要求已記錄；畫面會重新讀取實際狀態。", false);
    await loadJobs(context);
  };

  const renderJobs = async (rows, context) => {
    const fragment = document.createDocumentFragment();
    const queued = rows.filter((row) => row.status === "queued").length;
    const active = rows.filter((row) => ["running", "cancel_requested", "reconciling", "verifying"].includes(row.status)).length;
    const verifiedCount = rows.filter((row) => Boolean(verifiedArtifact(row))).length;

    if (!rows.length) {
      const tr = element("tr");
      const td = tableCell("Queue", "", "empty-cell");
      td.colSpan = 6;
      td.append(element("div", "empty", "未有 job。只有已放行 preset 先可以落單。"));
      tr.append(td);
      fragment.append(tr);
    }

    for (const row of rows.slice(0, 20)) {
      const tr = element("tr");
      tr.append(tableCell("Job", shortId(row.id), "id"));

      const mediaCell = tableCell("Preset", "");
      mediaCell.append(element("strong", "row-title", row.kind === "video" ? "影片" : "圖片"));
      mediaCell.append(element("span", "row-subline", String(row.preset_id || row.model || "—")));
      tr.append(mediaCell);

      const stateCell = tableCell("狀態", "");
      stateCell.append(element("span", statusClass(row.status), statusLabel(row.status)));
      const detail = jobMessage(row);
      if (detail) stateCell.append(element("span", "row-subline", detail));
      tr.append(stateCell);

      tr.append(tableCell("建立時間", timeLabel(row.created_at), "time"));

      const resultCell = tableCell("結果", "");
      await appendResult(resultCell, row, verifiedArtifact(row), context);
      if (!isCurrentReadiness(context)) return false;
      tr.append(resultCell);

      const actionCell = tableCell("操作", "", "row-action");
      if (["queued", "running", "reconciling", "verifying"].includes(row.status)) {
        const button = element("button", "link-button", "取消");
        button.type = "button";
        button.addEventListener("click", () => {
          button.disabled = true;
          cancelJob(row.id);
        });
        actionCell.append(button);
      } else {
        actionCell.append(element("span", "muted", "—"));
      }
      tr.append(actionCell);
      fragment.append(tr);
    }
    if (!isCurrentReadiness(context)) return false;
    clearNode(jobsBody);
    jobsBody.append(fragment);
    queuedCount.textContent = String(queued);
    runningCount.textContent = String(active);
    activeJobCount.textContent = String(queued + active);
    latestResult.textContent = verifiedCount ? String(verifiedCount) + " 可開啟" : "未有";
    return true;
  };

  const loadJobs = async (context = sessionContext()) => {
    if (!state.client || !state.session || !state.readinessAuthorized) return false;
    const result = await state.client
      .from("comfy_jobs")
      .select("id,kind,status,model,preset_id,preset_version,created_at,comfy_artifacts(id,storage_path,mime_type,verification_state,width,height,duration_seconds)")
      .order("created_at", { ascending: false })
      .limit(50);
    if (!isCurrentReadiness(context)) return false;
    if (result.error) {
      captureRefreshDraft();
      lockPrivateShell(safeError("jobs", result.error));
      return false;
    }
    const rows = result.data || [];
    if (!await renderJobs(rows, context)) return false;
    state.jobs = rows;
    return true;
  };

  const schemaValue = (rule, key, fallback) => {
    if (!rule || rule[key] === undefined || rule[key] === null) return fallback;
    return rule[key];
  };

  const configureNumber = (input, rule) => {
    const source = rule || {};
    const schemaMaximum = Number(schemaValue(source, "maximum", Number.MAX_SAFE_INTEGER));
    input.disabled = false;
    input.min = String(schemaValue(source, "minimum", 0));
    input.max = String(Math.min(schemaMaximum, Number.MAX_SAFE_INTEGER));
    input.step = String(schemaValue(source, "multiple_of", 1));
    input.value = String(schemaValue(source, "default", ""));
    if (Array.isArray(source.enum) && source.enum.length === 1) input.disabled = true;
  };

  const renderPresetFacts = (preset) => {
    clearNode(presetFacts);
    if (!preset) {
      presetFacts.append(element("span", "muted", "未有已放行 preset。"));
      return;
    }
    const schema = preset.params_schema || {};
    const facts = [
      preset.media_kind === "video" ? "影片" : "圖片",
      "版本 " + preset.version,
      "授權類別 " + preset.license_class,
    ];
    if (schema.output_frames && schema.fps) {
      facts.push(String(schema.output_frames.default) + " frames / " + String(schema.fps.default) + "fps");
    }
    for (const fact of facts) presetFacts.append(element("span", "fact", fact));
  };

  const syncPresetControls = () => {
    const preset = state.enabledPresets.find((item) => item.preset_id === presetSelect.value) || null;
    if (!preset) {
      submitButton.disabled = true;
      promptInput.disabled = true;
      widthInput.disabled = true;
      heightInput.disabled = true;
      seedInput.disabled = true;
      renderPresetFacts(null);
      return;
    }
    const schema = preset.params_schema || {};
    promptInput.disabled = false;
    promptInput.maxLength = Number(schemaValue(schema.prompt, "max_length", 4000));
    configureNumber(widthInput, schema.width);
    configureNumber(heightInput, schema.height);
    configureNumber(seedInput, schema.seed);
    submitButton.disabled = state.pendingRecoveryBlocked;
    renderPresetFacts(preset);
  };

  const renderPresetOptions = () => {
    clearNode(presetSelect);
    if (state.enabledPresets.length === 0) {
      const option = element("option", "", "未有已放行 preset");
      option.value = "";
      presetSelect.append(option);
      presetSelect.disabled = true;
      submitButton.disabled = true;
      newJobButton.disabled = true;
      readinessNote.textContent = "A100 smoke test 未完成；生成入口已鎖住，唔會送出未驗證 workflow。";
      releasedPresetCount.textContent = "0";
      syncPresetControls();
      return;
    }
    presetSelect.disabled = false;
    newJobButton.disabled = false;
    for (const preset of state.enabledPresets) {
      const option = element("option", "", preset.preset_id + " · " + preset.version);
      option.value = preset.preset_id;
      presetSelect.append(option);
    }
    readinessNote.textContent = "只會提交資料庫已放行、帶完整 provenance 嘅 preset。";
    releasedPresetCount.textContent = String(state.enabledPresets.length);
    syncPresetControls();
  };

  const showReadinessChecking = () => {
    authCard.hidden = true;
    composeCard.hidden = true;
    signOutButton.hidden = false;
    newJobButton.disabled = true;
    setStatus("檢查授權", "neutral");
    headlineNote.textContent = "先確認帳戶授權，再讀取私人 preset 同 queue。";
    readinessNote.textContent = "正核對帳戶授權；未通過前私人介面保持鎖住。";
    releasedPresetCount.textContent = "—";
    activeJobCount.textContent = "—";
    latestResult.textContent = "—";
  };

  const lockPrivateShell = (message) => {
    state.readinessAuthorized = false;
    state.readinessPresetCount = null;
    state.enabledPresets = [];
    state.jobs = [];
    clearJobView();
    clearNode(presetSelect);
    clearNode(presetFacts);
    presetSelect.disabled = true;
    submitButton.disabled = true;
    newJobButton.disabled = true;
    authCard.hidden = true;
    composeCard.hidden = true;
    signOutButton.hidden = false;
    setStatus("已登入 · 鎖住", "failed");
    headlineNote.textContent = message;
    readinessNote.textContent = message;
    releasedPresetCount.textContent = "—";
    activeJobCount.textContent = "—";
    latestResult.textContent = "—";
  };

  const loadReadiness = async (context = sessionContext()) => {
    if (!state.client || !state.session) return false;
    const result = await state.client.rpc("comfy_self_readiness");
    if (!isCurrentReadiness(context)) return false;
    if (result.error) {
      lockPrivateShell(safeError("readiness", result.error));
      return false;
    }
    const rows = Array.isArray(result.data) ? result.data : null;
    if (!rows || rows.length !== 1) {
      lockPrivateShell("授權回覆格式不正確；私人介面保持鎖住。");
      return false;
    }
    const readiness = rows[0];
    if (
      !readiness
      || typeof readiness !== "object"
      || readiness.user_id !== context.ownerId
      || readiness.authorized !== true
      || !Number.isInteger(readiness.enabled_preset_count)
      || readiness.enabled_preset_count < 0
    ) {
      lockPrivateShell("帳號未授權或授權回覆未通過檢查；私人介面保持鎖住。");
      return false;
    }
    state.readinessAuthorized = true;
    state.readinessPresetCount = readiness.enabled_preset_count;
    return true;
  };

  const loadEnabledPresets = async (context = sessionContext()) => {
    if (!state.client || !state.session || !state.readinessAuthorized) return false;
    const result = await state.client
      .from("comfy_preset_versions")
      .select("preset_id,version,media_kind,license_class,params_schema,max_input_assets")
      .eq("enabled", true)
      .order("preset_id", { ascending: true });
    if (!isCurrentReadiness(context)) return;
    if (result.error) {
      state.enabledPresets = [];
      renderPresetOptions();
      setNote(formNote, safeError("presets", result.error), true);
      return false;
    }
    state.enabledPresets = result.data || [];
    renderPresetOptions();
    return true;
  };

  const requestSignature = (request) => JSON.stringify([
    request.p_preset_id,
    request.p_preset_version,
    request.p_params,
    request.p_input_asset_ids,
  ]);

  const readPendingRequestState = (ownerId) => {
    try {
      if (!ownerId) return { kind: "invalid", raw: null };
      const raw = window.localStorage.getItem(pendingStorageKey(ownerId));
      if (raw === null) return { kind: "absent", raw: null };
      const parsed = JSON.parse(raw);
      const request = parsed && parsed.request;
      const recordKeys = parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? Object.keys(parsed).sort()
        : [];
      const requestKeys = request && typeof request === "object" && !Array.isArray(request)
        ? Object.keys(request).sort()
        : [];
      if (
        !parsed
        || recordKeys.join(",") !== "idempotencyKey,ownerId,request,requestSignature"
        || parsed.ownerId !== ownerId
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed.idempotencyKey)
        || typeof parsed.requestSignature !== "string"
        || requestKeys.join(",") !== "p_input_asset_ids,p_params,p_preset_id,p_preset_version"
        || typeof request.p_preset_id !== "string"
        || typeof request.p_preset_version !== "string"
        || !request.p_params
        || typeof request.p_params !== "object"
        || Array.isArray(request.p_params)
        || !Array.isArray(request.p_input_asset_ids)
        || requestSignature(request) !== parsed.requestSignature
      ) return { kind: "invalid", raw };
      return { kind: "valid", raw, record: parsed };
    } catch (error) {
      safeError("pending request", error);
      return { kind: "invalid", raw: null };
    }
  };

  const writePendingRequest = (ownerId, record) => {
    const serialized = JSON.stringify({ ...record, ownerId });
    try {
      window.localStorage.setItem(pendingStorageKey(ownerId), serialized);
      return window.localStorage.getItem(pendingStorageKey(ownerId)) === serialized;
    } catch (error) {
      safeError("pending request write", error);
      return false;
    }
  };

  const clearPendingRequest = (ownerId, expectedIdempotencyKey) => {
    const pending = readPendingRequestState(ownerId);
    if (pending.kind !== "valid") return pending.kind;
    if (pending.record.idempotencyKey !== expectedIdempotencyKey) return "preserved";
    try {
      window.localStorage.removeItem(pendingStorageKey(ownerId));
      return window.localStorage.getItem(pendingStorageKey(ownerId)) === null
        ? "cleared"
        : "invalid";
    } catch (error) {
      safeError("pending request clear", error);
      return "invalid";
    }
  };

  const blockPendingRecovery = (message) => {
    state.pendingRecoveryBlocked = true;
    submitButton.disabled = true;
    setNote(formNote, message, true);
  };

  const currentRequest = () => {
    const preset = state.enabledPresets.find((item) => item.preset_id === presetSelect.value);
    if (!preset) return null;
    const params = {
      prompt: promptInput.value.trim(),
      width: Number(widthInput.value),
      height: Number(heightInput.value),
      seed: Number(seedInput.value),
    };
    return {
      p_preset_id: preset.preset_id,
      p_preset_version: preset.version,
      p_params: params,
      p_input_asset_ids: [],
    };
  };

  const restorePendingForm = (context) => {
    if (!isCurrentReadiness(context)) return;
    const pendingState = readPendingRequestState(context.ownerId);
    if (pendingState.kind === "absent") return;
    if (pendingState.kind !== "valid") {
      blockPendingRecovery("上次 request 復原資料損壞或讀唔到；已保留原紀錄並停止新提交，請先核對 queue。");
      return;
    }
    const pending = pendingState.record;
    const request = pending.request;
    if (!state.enabledPresets.some((preset) => preset.preset_id === request.p_preset_id && preset.version === request.p_preset_version)) {
      blockPendingRecovery("上次 request 對應嘅 preset 已唔可用；原紀錄已保留，新提交保持鎖住。");
      return;
    }
    presetSelect.value = request.p_preset_id;
    syncPresetControls();
    promptInput.value = String(request.p_params.prompt ?? "");
    widthInput.value = String(request.p_params.width ?? widthInput.value);
    heightInput.value = String(request.p_params.height ?? heightInput.value);
    seedInput.value = String(request.p_params.seed ?? seedInput.value);
    setNote(formNote, "搵到上次未確認嘅 request；相同設定會沿用同一 idempotency key。", false);
  };

  const restoreRefreshDraft = (context) => {
    const draft = state.refreshDraft;
    if (!draft || !isCurrentReadiness(context)) return;
    if (readPendingRequestState(context.ownerId).kind !== "absent") return;
    if (!state.enabledPresets.some((preset) => preset.preset_id === draft.presetId)) return;
    presetSelect.value = draft.presetId;
    syncPresetControls();
    promptInput.value = draft.prompt;
    widthInput.value = draft.width;
    heightInput.value = draft.height;
    seedInput.value = draft.seed;
  };

  const captureRefreshDraft = () => {
    if (state.refreshDraft) return;
    state.refreshDraft = {
      presetId: presetSelect.value,
      prompt: promptInput.value,
      width: widthInput.value,
      height: heightInput.value,
      seed: seedInput.value,
    };
  };

  const clearJobView = () => {
    jobsBody.querySelectorAll("video, audio").forEach((media) => {
      media.pause();
      media.removeAttribute("src");
      media.load();
    });
    jobsBody.querySelectorAll("img").forEach((image) => image.removeAttribute("src"));
    clearNode(jobsBody);
    queuedCount.textContent = "—";
    runningCount.textContent = "—";
  };

  const resetSessionData = () => {
    state.refreshDraft = null;
    state.readinessAuthorized = false;
    state.readinessPresetCount = null;
    state.pendingRecoveryBlocked = false;
    state.enabledPresets = [];
    state.jobs = [];
    jobForm.reset();
    clearJobView();
    clearNode(presetSelect);
    clearNode(presetFacts);
    submitButton.disabled = true;
    presetSelect.disabled = true;
  };

  const showSignedOut = () => {
    resetSessionData();
    authCard.hidden = false;
    composeCard.hidden = true;
    signOutButton.hidden = true;
    newJobButton.disabled = true;
    setStatus("未登入", "neutral");
    headlineNote.textContent = "用已存在嘅帳戶登入；呢個頁面唔會建立新帳戶。";
    releasedPresetCount.textContent = "—";
    activeJobCount.textContent = "—";
    latestResult.textContent = "—";
  };

  const setSignedInView = () => {
    if (!state.readinessAuthorized) return;
    authCard.hidden = true;
    composeCard.hidden = false;
    signOutButton.hidden = false;
    newJobButton.disabled = state.enabledPresets.length === 0;
    setStatus("已登入", "connected");
    headlineNote.textContent = "只會提交已放行 preset；完成結果仍要通過 hash 同媒體規格驗證。";
  };

  const showSignedIn = async (context) => {
    showReadinessChecking();
    if (!await loadReadiness(context) || !isCurrentReadiness(context)) return;
    if (!await loadEnabledPresets(context) || !isCurrentReadiness(context)) return;
    if (state.enabledPresets.length !== state.readinessPresetCount) {
      lockPrivateShell("Readiness 同 enabled preset 數量不一致；私人介面保持鎖住。");
      return;
    }
    restoreRefreshDraft(context);
    if (!await loadJobs(context) || !isCurrentReadiness(context)) return;
    state.refreshDraft = null;
    setSignedInView();
    if (isCurrentReadiness(context)) restorePendingForm(context);
  };

  const resetReadinessData = () => {
    state.readinessAuthorized = false;
    state.readinessPresetCount = null;
    state.enabledPresets = [];
    state.jobs = [];
    clearJobView();
    clearNode(presetFacts);
    presetSelect.disabled = true;
    submitButton.disabled = true;
    newJobButton.disabled = true;
  };


  const handleSession = async (nextSession, authGeneration) => {
    if (authGeneration !== state.authGeneration) return;
    const previousOwner = sessionOwner();
    const nextOwner = sessionOwner(nextSession);
    if (previousOwner && previousOwner === nextOwner) {
      captureRefreshDraft();
      state.session = nextSession;
      resetReadinessData();
      showReadinessChecking();
      const context = sessionContext();
      await showSignedIn(context);
      return;
    }
    state.sessionEpoch += 1;
    state.session = nextSession || null;
    const context = sessionContext();
    resetSessionData();
    if (state.session) await showSignedIn(context);
    else showSignedOut();
  };

  const init = async () => {
    if (
      config.authRedirectUrl !== canonicalAuthRedirectUrl
      || !isValidSupabaseUrl(config.supabaseUrl)
      || !config.publishableKey
      || !isPublishableKey(config.publishableKey)
    ) {
      authSubmit.disabled = true;
      setStatus("未設定", "failed");
      headlineNote.textContent = "網站設定未通過 HTTPS redirect檢查；登入同生成保持鎖住。";
      setNote(authNote, "需要先提供 publishable key；service role 絕對唔會放入瀏覽器。", true);
      return;
    }
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      authSubmit.disabled = true;
      setStatus("連線程式未載入", "failed");
      setNote(authNote, "登入元件未能載入；請稍後再試。", true);
      return;
    }
    state.client = window.supabase.createClient(config.supabaseUrl, config.publishableKey);
    state.client.auth.onAuthStateChange((_event, nextSession) => {
      state.authGeneration += 1;
      const authGeneration = state.authGeneration;
      window.setTimeout(() => handleSession(nextSession, authGeneration), 0);
    });
    const authGeneration = state.authGeneration;
    const result = await state.client.auth.getSession();
    if (authGeneration !== state.authGeneration) return;
    if (result.error) {
      showSignedOut();
      setNote(authNote, safeError("auth", result.error), true);
      return;
    }
    await handleSession(result.data.session, authGeneration);
  };

  authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.client) return;
    const email = byId("email").value.trim();
    authSubmit.disabled = true;
    setNote(authNote, "正送出登入連結…", false);
    const result = await state.client.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: config.authRedirectUrl,
        shouldCreateUser: false,
      },
    });
    authSubmit.disabled = false;
    if (result.error) {
      setNote(authNote, safeError("auth", result.error), true);
      return;
    }
    setNote(authNote, "請喺電郵開啟登入連結；只有既有帳戶先會成功。", false);
  });

  jobForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.client || !state.session || !state.readinessAuthorized) {
      setNote(formNote, "請先登入。", true);
      return;
    }
    const request = currentRequest();
    if (!request || state.enabledPresets.length === 0) {
      submitButton.disabled = true;
      setNote(formNote, "A100 smoke test 未完成，未有 preset 可以提交。", true);
      return;
    }
    const context = sessionContext();
    const signature = requestSignature(request);
    const pendingState = readPendingRequestState(context.ownerId);
    if (pendingState.kind === "invalid") {
      blockPendingRecovery("上次 request 復原資料損壞或儲存區讀唔到；已停止新提交，避免重複生成。");
      return;
    }
    const pending = pendingState.kind === "valid" ? pendingState.record : null;
    if (pending && pending.requestSignature !== signature) {
      blockPendingRecovery("仲有另一個未核對 request；原紀錄已保留，請先核對 queue，唔會覆寫或重送。");
      return;
    }
    const idempotencyKey = pending ? pending.idempotencyKey : crypto.randomUUID();
    const rpcArgs = Object.assign({ p_idempotency_key: idempotencyKey }, request);
    if (!writePendingRequest(context.ownerId, { idempotencyKey, requestSignature: signature, request })) {
      blockPendingRecovery("未能安全保存 request 復原資料；已停止提交，避免失去 operation key。");
      return;
    }
    submitButton.disabled = true;
    setNote(formNote, "正安全落單…", false);
    const result = await state.client.rpc("comfy_enqueue", rpcArgs);
    if (!isCurrentSession(context)) {
      if (!result.error) clearPendingRequest(context.ownerId, idempotencyKey);
      return;
    }
    if (result.error) {
      submitButton.disabled = false;
      setNote(formNote, safeError("enqueue", result.error), true);
      return;
    }
    if (clearPendingRequest(context.ownerId, idempotencyKey) !== "cleared") {
      blockPendingRecovery("job 已有回覆，但復原紀錄未能安全清除；已停止新提交，請先核對 queue。");
      return;
    }
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    setNote(formNote, "已記錄 job " + shortId(row && row.job_id) + "；開始與否以 queue 狀態為準。", false);
    jobForm.reset();
    syncPresetControls();
    await loadJobs(context);
  });

  presetSelect.addEventListener("change", syncPresetControls);
  signOutButton.addEventListener("click", async () => {
    if (!state.client) return;
    signOutButton.disabled = true;
    const result = await state.client.auth.signOut();
    signOutButton.disabled = false;
    if (result.error) setNote(authNote, safeError("auth", result.error), true);
  });
  refreshButton.addEventListener("click", () => loadJobs());
  newJobButton.addEventListener("click", () => {
    composeCard.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      const target = button.dataset.view === "queue" ? byId("queue-card") : composeCard;
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && state.session && state.readinessAuthorized) loadJobs();
  });
  window.setInterval(() => {
    if (state.session && state.readinessAuthorized) loadJobs();
  }, 15000);

  showSignedOut();
  init();
})();
