(() => {
  "use strict";

  const config = window.COMFY_CONFIG || {};
  const canonicalAuthRedirectUrl = "https://yinstagram.github.io/comfy-yinops/";
  const state = {
    client: null,
    session: null,
    authGeneration: 0,
    logoutLocked: false,
    sessionEpoch: 0,
    readinessAuthorized: false,
    readinessPresetCount: null,
    pendingRecoveryBlocked: false,
    refreshDraft: null,
    enabledPresets: [],
    jobs: [],
    inventory: null,
    inventoryRequest: 0,
    inventoryPair: null,
    selectedAccount: "",
    selectedGpu: "",
    jobsRequest: 0,
    enqueueRequest: 0,
    draftRevision: 0,
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
  const accountNote = byId("account-note");
  const accountCards = byId("account-cards");
  const accountControls = byId("account-controls");
  const accountSelect = byId("account-selector");
  const refreshAccounts = byId("refresh-accounts");
  const accountSelectionNote = byId("account-selection-note");
  const gpuSelect = byId("gpu-selector");
  const gpuNote = byId("gpu-note");
  const consentCard = byId("consent-card");
  const consentStatus = byId("consent-status");
  const consentAccount = byId("consent-account");
  const consentAck = byId("consent-ack");
  const consentStart = byId("consent-start");
  const consentRefresh = byId("consent-refresh");
  const consentGoogle = byId("consent-google");
  const consentForm = byId("consent-return");
  const consentResponse = byId("consent-response");
  const consentSubmit = byId("consent-submit");
  // Default-off local candidate. This setting never grants backend admission.
  const consentConfig = config.mobileConsent;
  const consentScopes = ["openid", "https://www.googleapis.com/auth/userinfo.profile",
    "https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/colaboratory", "https://www.googleapis.com/auth/drive.file"];
  const consentRedirect = "https://sdk.cloud.google.com/applicationdefaultauthcode.html";
  const consentClient = "764086051850-6qr4p6gpi6hn506pt8ejuq83di341hur.apps.googleusercontent.com";
  const consentExact = (value, keys) => Boolean(value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === keys.slice().sort().join(","));
  const consentHex = value => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
  const consentUuid = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
  const consentBytes = value => new TextEncoder().encode(value);
  const consentDigest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
  const consentBase64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
  const consentUnbase64 = value => {
    if (typeof value !== "string" || value.length > 4096 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw Error("key");
    const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0));
    if (consentBase64(bytes) !== value) throw Error("key");
    return bytes;
  };
  const consentAuthorizationUrl = (value, email) => {
    try {
      if (typeof value !== "string" || consentBytes(value).length > 8192) return null;
      const url = new URL(value), q = url.searchParams;
      const expectedKeys = ["client_id", "redirect_uri", "response_type", "code_challenge_method", "code_challenge",
        "state", "login_hint", "access_type", "prompt", "token_usage", "scope"];
      const keys = [...q.keys()];
      if (url.origin !== "https://accounts.google.com" || url.pathname !== "/o/oauth2/auth"
        || url.username || url.password || url.hash || keys.length !== expectedKeys.length
        || keys.some(k => !expectedKeys.includes(k) || q.getAll(k).length !== 1)
        || q.get("client_id") !== consentClient || q.get("redirect_uri") !== consentRedirect
        || q.get("response_type") !== "code" || q.get("code_challenge_method") !== "S256"
        || !/^[A-Za-z0-9_-]{43}$/.test(q.get("code_challenge") || "")
        || !q.get("state") || q.get("state").length > 512 || q.get("login_hint") !== email
        || q.get("access_type") !== "offline" || q.get("prompt") !== "consent select_account"
        || q.get("token_usage") !== "remote"
        || (q.get("scope") || "").split(" ").sort().join(" ") !== consentScopes.slice().sort().join(" ")) return null;
      return url;
    } catch { return null; }
  };
  const consentReturnValid = (value, publication) => {
    try {
      if (typeof value !== "string" || !value || consentBytes(value).length > 8192) return false;
      const u = new URL(value), q = u.searchParams, auth = new URL(publication.authorization_url);
      return u.origin + u.pathname === consentRedirect && !u.username && !u.password && !u.hash
        && [...q.keys()].every(k => ["code", "state", "scope", "authuser", "prompt"].includes(k) && q.getAll(k).length === 1)
        && Boolean(q.get("code")) && q.get("code").length <= 4096 && q.get("state") === auth.searchParams.get("state");
    } catch { return false; }
  };
  const encryptReturnUrl = async (publication, aad, response) => {
    const names = ["schema", "owner_id", "account_id", "operation_id", "handoff_id", "generation", "owner_session_id",
      "pending_sha256", "key_sha256", "expires_at", "request_id", "host_instance_id"];
    if (!window.isSecureContext || !crypto.subtle || !consentExact(aad, names)
      || !consentExact(publication, ["schema", "authorization_url", "pending_sha256", "key_spki_b64", "key_sha256", "expires_at"])
      || publication.schema !== "yin.comfy.mobile-consent-publication/v1"
      || aad.schema !== "yin.comfy.mobile-consent-aad/v1"
      || !["owner_id", "account_id", "operation_id", "handoff_id", "owner_session_id", "request_id", "host_instance_id"].every(k => consentUuid(aad[k]))
      || !["pending_sha256", "key_sha256"].every(k => consentHex(aad[k]))
      || !Number.isInteger(aad.generation) || aad.generation < 1 || aad.generation > 2147483647
      || !Number.isSafeInteger(aad.expires_at) || aad.expires_at < 0
      || publication.pending_sha256 !== aad.pending_sha256 || publication.key_sha256 !== aad.key_sha256
      || publication.expires_at !== aad.expires_at || !consentReturnValid(response, publication)) throw Error("binding");
    const spki = consentUnbase64(publication.key_spki_b64);
    if (await consentDigest(spki) !== publication.key_sha256) throw Error("key");
    const key = await crypto.subtle.importKey("spki", spki, {name: "RSA-OAEP", hash: "SHA-256"}, false, ["encrypt"]);
    if (key.algorithm.modulusLength !== 3072 || consentBase64(key.algorithm.publicExponent) !== "AQAB") throw Error("key");
    const additionalData = consentBytes(JSON.stringify(Object.fromEntries(names.sort().map(k => [k, aad[k]]))));
    const aes = await crypto.subtle.generateKey({name: "AES-GCM", length: 256}, true, ["encrypt"]);
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", aes));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = consentBytes(response);
    try {
      const wrapped = await crypto.subtle.encrypt({name: "RSA-OAEP"}, key, raw);
      const ciphertext = await crypto.subtle.encrypt({name: "AES-GCM", iv, additionalData, tagLength: 128}, aes, plain);
      return {schema: "yin.comfy.mobile-consent-envelope/v1", algorithm: "RSA-OAEP-3072-SHA256+A256GCM",
        wrapped_key_b64: consentBase64(wrapped), iv_b64: consentBase64(iv), ciphertext_b64: consentBase64(ciphertext),
        aad_sha256: await consentDigest(additionalData)};
    } finally { raw.fill(0); plain.fill(0); }
  };
  const consentState = { epoch: 0, paused: false, busy: false, snapshot: null, binding: null, clockAtRead: 0, started: 0, poll: null, pending: null, checkedAccount: false };
  // Local opt-in only. Backend setup and deployment remain separate admission gates.
  const wakeEnabled = config.mobileWake === "v1";
  const wakeState = {snapshot: null, binding: null, busy: false, poll: null, clockAtRead: 0, started: 0};
  const wakeKey = () => consentMarkerKey() + ":wake";
  const wakeMarker = () => {
    const raw = localStorage.getItem(wakeKey());
    if (raw === null) return null;
    const m = JSON.parse(raw);
    if (!consentExact(m, ["version", "owner_id", "operation_id", "owner_session_id", "request_id", "cancel_started"])
      || m.version !== 1 || m.owner_id !== consentConfig.ownerId || m.operation_id !== consentConfig.operationId
      || !consentUuid(m.owner_session_id) || !consentUuid(m.request_id) || typeof m.cancel_started !== "boolean") throw Error("wake marker");
    return m;
  };
  const wakeWrite = m => {
    const raw = JSON.stringify(m); localStorage.setItem(wakeKey(), raw);
    if (localStorage.getItem(wakeKey()) !== raw) throw Error("wake storage");
  };
  const wakeNow = () => Math.max(Date.now() / 1000,
    wakeState.clockAtRead + Math.max(0, performance.now() - wakeState.started) / 1000);
  const wakeReady = () => {
    if (!wakeEnabled) return true;
    try {
      const m = wakeMarker(), r = wakeState.snapshot;
      return !wakeState.busy && r?.status === "ready" && r.expires_at > wakeNow()
        && r.owner_session_id === consentSessionId() && (!m || (m.owner_session_id === consentSessionId() && m.request_id === r.request_id && !m.cancel_started));
    } catch { return false; }
  };
  const wakeValidate = (r, context) => {
    if (!consentExact(r, ["schema", "operation_id", "account_id", "owner_id", "status", "server_time", "request_id", "owner_session_id", "requested_at", "expires_at"])
      || r.schema !== "yin.comfy.wake-status/v1" || r.operation_id !== consentConfig.operationId
      || r.account_id !== consentConfig.accountId || r.owner_id !== context.ownerId
      || !["setup_required", "not_requested", "requested", "claimed", "ready", "cancelled", "expired", "revoked"].includes(r.status)
      || !Number.isSafeInteger(r.server_time) || r.server_time < 0) return false;
    if (r.request_id === null) {
      if (!["setup_required", "not_requested", "expired", "revoked"].includes(r.status)
        || ["owner_session_id", "requested_at", "expires_at"].some(k => r[k] !== null)) return false;
    } else if (!consentUuid(r.request_id) || r.owner_session_id !== context.consentSession
      || ["setup_required", "not_requested"].includes(r.status)
      || !Number.isSafeInteger(r.requested_at) || r.requested_at < 0 || r.requested_at > r.server_time
      || !Number.isSafeInteger(r.expires_at) || r.expires_at <= r.requested_at || r.expires_at > r.requested_at + 300) return false;
    const m = wakeMarker(), prior = wakeState.binding;
    if (m && (m.owner_session_id !== context.consentSession || (r.request_id !== null && m.request_id !== r.request_id))) return false;
    if (prior) {
      if (r.server_time < prior.server_time) return false;
      if (prior.request_id !== null && ["request_id", "owner_session_id", "requested_at", "expires_at"].some(k => r[k] !== prior[k])) return false;
      const order = ["not_requested", "requested", "claimed", "ready", "expired", "revoked", "cancelled"];
      if (order.indexOf(r.status) < order.indexOf(prior.status)) return false;
    }
    return true;
  };
  const renderWake = () => {
    if (!wakeEnabled) return false;
    const request = byId("wake-request"), cancel = byId("wake-cancel"), r = wakeState.snapshot;
    let m;
    try { m = wakeMarker(); } catch { consentStatus.textContent = "本機連接紀錄未能安全讀取；暫時只可保留現況作核對。"; return true; }
    if (m && m.owner_session_id !== consentSessionId()) {
      consentStatus.textContent = "呢次本機接駁屬於另一個登入階段；原紀錄已保留，唔會重新要求或取消。"; return true;
    }
    const busy = wakeState.busy || consentState.busy;
    consentRefresh.disabled = busy;
    cancel.hidden = !r?.request_id || r.status === "cancelled" || consentState.snapshot?.status === "connected";
    cancel.disabled = busy || Boolean(m?.cancel_started);
    if (wakeReady()) return false;
    consentStart.hidden = true;
    const stage = byId("consent-stage"), next = byId("consent-guidance");
    if (busy) { stage.textContent = "正核對本機接駁"; consentStatus.textContent = "請稍候；未確認前唔會開啟 Google 授權。"; return true; }
    if (m?.cancel_started && r?.status !== "cancelled") {
      stage.textContent = "取消結果未確認";
      consentStatus.textContent = "取消要求結果仍未確認；唔會重送或繼續授權。呢個狀態唔代表已取消或已撤回 Google 權限。"; return true;
    }
    if (!r) { stage.textContent = "本機接駁狀態未知"; consentStatus.textContent = "暫時讀唔到本機接駁狀態；唔會自動建立或重送要求。"; return true; }
    const status = r.expires_at !== null && r.expires_at <= wakeNow() && !["cancelled", "revoked"].includes(r.status) ? "expired" : r.status;
    const copy = {
      setup_required: ["本機仍需準備", "本機連接設定未完成，暫時未有可用嘅授權入口。", "等本機準備完成後，再按「核對連接狀態」。網站唔會自行建立另一個帳戶或設定。"],
      not_requested: [m ? "接駁要求結果未確認" : "可以要求本機接駁", m ? "上次要求未確認，原紀錄已保留，唔會重送。" : "目前未確認 Mac 在線；你可以要求已設定嘅本機準備連接。", "要求接駁唔會啟動 GPU，亦唔等於已完成 Google 授權。"],
      requested: ["等候本機接駁", "接駁要求已收到；仍未確認 Mac 目前在線。", "此頁會自動核對。你可以暫停此頁，或者取消呢次接駁要求。"],
      claimed: ["等候本機準備", "本機曾接收呢次要求；未確認目前仍在線，亦未提供授權連結。", "此頁會自動核對，唔需要重新要求接駁。"],
      expired: ["呢次接駁已過期", "已停止繼續授權，唔會自動重開。", "可核對原結果；新連接要等本機重新準備。"],
      revoked: ["呢次接駁已停用", "本機連接許可已停用，唔會繼續授權。", "可核對原結果；此頁唔會恢復或更改本機許可。"],
      cancelled: ["呢次接駁已取消", "後端已確認取消呢次要求。呢個動作唔代表撤回已授予 Google 嘅權限。", "原紀錄已保留；此頁唔會再提交或重新要求接駁。"],
    };
    const lines = copy[status];
    if (lines) { stage.textContent = lines[0]; consentStatus.textContent = lines[1]; next.textContent = lines[2]; }
    request.hidden = status !== "not_requested" || Boolean(m);
    request.disabled = request.hidden;
    return true;
  };
  const wakeSchedule = () => {
    clearTimeout(wakeState.poll);
    let marker;
    try { marker = wakeMarker(); } catch { return; }
    if (!consentState.paused && !document.hidden && consentAllowed() && !marker?.cancel_started && wakeState.snapshot?.expires_at > wakeNow()
      && ["requested", "claimed"].includes(wakeState.snapshot.status)) wakeState.poll = setTimeout(() => loadConsent(), 3000);
  };
  const wakeRun = async (action = "read") => {
    if (!wakeEnabled || !consentAllowed() || consentState.paused || wakeState.busy || consentState.busy) return;
    const context = consentContext();
    const run = async () => {
      if (!consentCurrent(context) || wakeState.busy || consentState.busy) return;
      let m = wakeMarker(), requestId = null;
      if (m && m.owner_session_id !== context.consentSession) throw Error("wake session");
      if (action === "request") {
        if (m || wakeState.snapshot?.status !== "not_requested") return;
        requestId = crypto.randomUUID();
        m = {version: 1, owner_id: context.ownerId, operation_id: consentConfig.operationId,
          owner_session_id: context.consentSession, request_id: requestId, cancel_started: false};
      } else if (action === "cancel") {
        const r = wakeState.snapshot;
        if (!r?.request_id || r.status === "cancelled" || m?.cancel_started || consentState.snapshot?.status === "connected") return;
        requestId = r.request_id;
        m = {...(m || {version: 1, owner_id: context.ownerId, operation_id: consentConfig.operationId,
          owner_session_id: context.consentSession, request_id: requestId}), cancel_started: true};
      }
      if (action !== "read") wakeWrite(m);
      clearTimeout(wakeState.poll); clearTimeout(consentState.poll);
      wakeState.busy = true;
      consentState.snapshot = null; consentResponse.value = "";
      renderConsent();
      const started = performance.now();
      const result = await consentCall("comfy_owner_wake_v8", {p_action: action, p_operation_id: consentConfig.operationId, p_request_id: requestId});
      if (!consentCurrent(context)) return;
      if (result?.error || !wakeValidate(result?.data, context)) throw Error("wake unavailable");
      wakeState.clockAtRead = Math.max(wakeNow(), result.data.server_time + Math.max(0, performance.now() - started) / 1000);
      wakeState.started = performance.now(); wakeState.snapshot = result.data; wakeState.binding = result.data;
      wakeState.busy = false;
      renderConsent(); wakeSchedule();
      if (wakeReady()) await loadConsentDirect();
    };
    try {
      if (action === "read") await run();
      else await navigator.locks.request(consentMarkerKey(), {mode: "exclusive", ifAvailable: true}, async lock => { if (lock) await run(); });
    } catch {
      if (consentCurrent(context)) { wakeState.snapshot = null; consentState.snapshot = null; clearTimeout(wakeState.poll); }
    } finally {
      if (consentCurrent(context)) { const unfinished = wakeState.busy; wakeState.busy = false; if (unfinished) renderConsent(); }
    }
  };
  const consentConfigured = () => consentExact(consentConfig, ["version", "ownerId", "accountId", "operationId", "expectedEmail"])
    && consentConfig.version === "v1" && ["ownerId", "accountId", "operationId"].every(k => consentUuid(consentConfig[k]))
    && consentConfig.expectedEmail === "zuyanww@gmail.com";
  const consentSessionId = () => {
    try {
      const value = decodeJwtPart(state.session.access_token.split(".")[1]);
      return value.sub === sessionOwner() && consentUuid(value.session_id) ? value.session_id : null;
    } catch { return null; }
  };
  const consentAllowed = () => consentConfigured() && state.readinessAuthorized && sessionOwner() === consentConfig.ownerId
    && consentSessionId() && window.isSecureContext && Boolean(crypto.subtle) && Boolean(navigator.locks?.request);
  const consentMarkerKey = () => "comfy:consent:v1:" + project() + ":" + consentConfig.ownerId + ":" + consentConfig.operationId;
  const consentReadMarker = () => {
    const raw = localStorage.getItem(consentMarkerKey());
    if (raw === null) return null;
    const m = JSON.parse(raw);
    if (!consentExact(m, ["version", "owner_id", "operation_id", "owner_session_id", "action", "handoff_id", "request_id", "envelope_sha256"])
      || m.version !== 1 || m.owner_id !== consentConfig.ownerId || m.operation_id !== consentConfig.operationId
      || !consentUuid(m.owner_session_id) || !["start", "submit"].includes(m.action)
      || (m.action === "start" ? m.handoff_id !== null || m.request_id !== null || m.envelope_sha256 !== null
        : !consentUuid(m.handoff_id) || !consentUuid(m.request_id) || !consentHex(m.envelope_sha256))) throw Error("marker");
    return m;
  };
  const consentWriteMarker = marker => {
    const text = JSON.stringify(marker);
    localStorage.setItem(consentMarkerKey(), text);
    if (localStorage.getItem(consentMarkerKey()) !== text) throw Error("storage");
  };
  const resetConsent = () => {
    consentState.epoch += 1;
    clearTimeout(wakeState.poll); wakeState.poll = null; wakeState.busy = false; wakeState.snapshot = null; wakeState.binding = null; wakeState.clockAtRead = 0;
    clearTimeout(consentState.poll);
    consentState.poll = null;
    consentState.busy = false;
    consentState.snapshot = null;
    consentState.binding = null;
    consentState.clockAtRead = 0;
    consentState.pending = null;
    consentState.checkedAccount = false;
    consentCard.hidden = true;
    consentGoogle.hidden = true; consentGoogle.removeAttribute("href");
    consentForm.hidden = true; consentResponse.value = "";
    consentAccount.textContent = ""; consentAck.checked = false;
    consentStart.disabled = consentRefresh.disabled = consentAck.disabled = consentSubmit.disabled = true;
  };
  const consentNow = () => Math.max(Date.now() / 1000,
    consentState.clockAtRead + Math.max(0, performance.now() - consentState.started) / 1000);
  const consentLiveSnapshot = () => consentState.snapshot && consentState.snapshot.expires_at > consentNow();
  const renderConsent = (message) => {
    consentCard.hidden = !state.readinessAuthorized;
    consentStart.disabled = consentRefresh.disabled = consentAck.disabled = consentSubmit.disabled = true;
    consentGoogle.hidden = true; consentGoogle.removeAttribute("href"); consentForm.hidden = true;
    const stage = byId("consent-stage"), guidance = byId("consent-guidance");
    stage.textContent = "狀態未確認";
    guidance.textContent = "按「核對連接狀態」只會查看原本結果，唔會重新提交。";
    byId("wake-request").hidden = byId("wake-cancel").hidden = true;
    byId("wake-request").disabled = byId("wake-cancel").disabled = true;
    const allowed = consentAllowed();
    byId("consent-disclosure").hidden = !allowed;
    consentRefresh.hidden = !allowed || consentState.paused;
    byId("consent-pause").hidden = !allowed || consentState.paused;
    byId("consent-resume").hidden = !allowed || !consentState.paused;
    byId("consent-pause-note").hidden = !allowed;
    byId("consent-disclosure").hidden = !allowed || consentState.paused;
    consentStart.hidden = !allowed || Boolean(consentState.snapshot && consentState.snapshot.status !== "not_started");
    if (!state.readinessAuthorized) return;
    if (!consentAllowed()) {
      stage.textContent = "連接入口未準備好";
      guidance.textContent = "入口開放前，暫時未有可用嘅授權連結。呢個畫面唔代表 Mac 已經在線。";
      consentStatus.textContent = "呢個連接入口暫未開放；帳戶連接狀態仍未核對。";
      if (consentConfigured() && sessionOwner() === consentConfig.ownerId) {
        consentAccount.textContent = consentConfig.expectedEmail;
        if (!window.isSecureContext || !crypto.subtle || !navigator.locks?.request) consentStatus.textContent = "呢個瀏覽器未能安全提交授權資料；請使用支援安全連線嘅瀏覽器。";
      }
      return;
    }
    consentAccount.textContent = consentConfig.expectedEmail;
    if (consentState.paused) {
      consentStart.hidden = true;
      stage.textContent = "已暫停此頁";
      consentStatus.textContent = "此頁已停止自動核對，貼上嘅網址亦已清除。呢個動作唔會取消後端要求或撤回 Google 授權。";
      guidance.textContent = "想繼續時，按「繼續核對原本連接」。只會讀取原操作，唔會重送。重新整理頁面會恢復核對。";
      return;
    }
    consentRefresh.disabled = consentState.busy;
    if (renderWake()) return;
    let marker;
    try { marker = consentReadMarker(); }
    catch { consentStatus.textContent = "連接紀錄未能安全讀取；已停止提交，請保留此頁作核對。"; return; }
    if (marker && marker.owner_session_id !== consentSessionId()) {
      consentStatus.textContent = "上次連接屬於另一個登入階段；已保留原紀錄，暫時只可核對狀態。"; return;
    }
    const r = consentState.snapshot;
    if (message) { consentStatus.textContent = message; return; }
    if (!r) { consentStatus.textContent = "暫時未能確認連接狀態；唔會自動重新提交。"; return; }
    if (r.status === "connected") {
      stage.textContent = consentState.checkedAccount ? "帳戶身份已核對" : "等候帳戶資料核對";
      guidance.textContent = "可喺上面嘅帳戶資料查看最新狀態；連接帳戶唔代表 GPU 可用。";
      consentStatus.textContent = consentState.checkedAccount
        ? "第一個帳戶身份已核對。餘額、使用資格同 GPU 仍需另外確認；第二個帳戶未處理。"
        : "授權結果已收到，帳戶資料仍未核對完成；餘額同 GPU 未知。"; return;
    }
    if (r.status === "expired" || (r.expires_at !== null && !consentLiveSnapshot())) {
      stage.textContent = "呢次連接已過期";
      guidance.textContent = "唔好再貼上舊網址。可按「核對連接狀態」查原結果；新連接要等本機重新準備。";
      consentResponse.value = ""; consentStatus.textContent = "呢次連接已過期，唔會自動重開或重送；請保留原紀錄作核對。"; return;
    }
    if (consentState.busy) { consentStatus.textContent = "正核對連接狀態…"; return; }
    if (r.status === "not_started") {
      stage.textContent = marker ? "開始要求結果未確認" : "尚未開始連接";
      if (!marker) guidance.textContent = "先了解下方權限，再按「準備 Google 授權」。目前未確認 Mac 在線。";
      consentAck.disabled = Boolean(marker);
      consentStart.disabled = Boolean(marker) || !consentAck.checked;
      consentStatus.textContent = marker ? "之前嘅開始要求未確認；唔會重送，請核對原本狀態。"
        : "尚未開始。需要 Mac 上嘅連接程式準備好，先會提供 Google 授權連結。"; return;
    }
    if (r.status === "authorization_ready") {
      if (marker?.action === "submit") { consentStatus.textContent = "上次提交結果未確認；原紀錄已保留，唔會重新加密或重送。"; return; }
      stage.textContent = "可以核對授權權限";
      guidance.textContent = "確認權限後前往 Google；完成後返回此頁，貼上同一次授權嘅完整回程網址。";
      consentAck.disabled = false;
      consentStatus.textContent = "Mac 已準備好呢次授權。請核對權限，再用指定帳戶完成 Google 授權。";
      if (consentAck.checked) {
        consentGoogle.href = r.publication.authorization_url; consentGoogle.hidden = false;
        consentForm.hidden = false; consentSubmit.disabled = false;
      }
      return;
    }
    stage.textContent = ["requested", "begin_claimed"].includes(r.status) ? "等候本機接駁" : "授權結果未確認";
    guidance.textContent = ["requested", "begin_claimed"].includes(r.status)
      ? "未確認 Mac 目前在線。此頁會自動核對；你亦可以暫停此頁，稍後再繼續。"
      : "請勿再次提交。此頁會核對原結果；你亦可以暫停此頁，稍後再繼續。";
    const messages = {
      requested: "等候 Mac 準備，暫未收到授權連結。Mac 未在線時無法繼續；你可以稍後核對狀態。",
      begin_claimed: "Mac 已接收要求，仍未收到授權連結；唔會重開另一個連接。",
      response_submitted: "加密資料已收到，等候 Mac 核對帳戶；請勿再次提交。",
      delivery_claimed: "Mac 已接收呢次授權，結果仍未確認；唔會重送。",
    };
    consentStatus.textContent = messages[r.status];
  };
  const consentValidate = async (r, context) => {
    const keys = ["schema", "operation_id", "account_id", "owner_id", "operation_state", "status", "server_time", "handoff_id",
      "generation", "owner_session_id", "host_instance_id", "expires_at", "publication", "request_id", "envelope_sha256", "connected"];
    if (!consentExact(r, keys) || r.schema !== "yin.comfy.mobile-consent-status/v1" || r.operation_id !== consentConfig.operationId
      || r.account_id !== consentConfig.accountId || r.owner_id !== context.ownerId || typeof r.operation_state !== "string"
      || !["not_started", "requested", "begin_claimed", "authorization_ready", "response_submitted", "delivery_claimed", "expired", "connected"].includes(r.status)
      || !Number.isSafeInteger(r.server_time) || r.server_time < 0 || typeof r.connected !== "boolean"
      || r.connected !== (r.status === "connected") || (r.connected && r.operation_state !== "active")) return false;
    if (wakeEnabled && (!wakeReady() || r.server_time < wakeState.snapshot.server_time
      || (r.expires_at !== null && r.expires_at > wakeState.snapshot.expires_at))) return false;
    if (r.handoff_id === null) {
      if (!["not_started", "connected"].includes(r.status)
        || ["generation", "owner_session_id", "host_instance_id", "expires_at", "publication", "request_id", "envelope_sha256"].some(k => r[k] !== null)) return false;
    } else {
      if (!consentUuid(r.handoff_id) || r.generation !== 1 || r.owner_session_id !== context.consentSession
        || (r.host_instance_id !== null && !consentUuid(r.host_instance_id))
        || !Number.isSafeInteger(r.expires_at) || r.expires_at < 0 || r.expires_at > r.server_time + 600
        || (r.request_id !== null && !consentUuid(r.request_id)) || (r.envelope_sha256 !== null && !consentHex(r.envelope_sha256))
        || ((r.request_id === null) !== (r.envelope_sha256 === null))) return false;
      if (["authorization_ready", "response_submitted", "delivery_claimed"].includes(r.status) && r.host_instance_id === null) return false;
      if (["response_submitted", "delivery_claimed"].includes(r.status) && r.request_id === null) return false;
      if (["requested", "begin_claimed", "authorization_ready"].includes(r.status) && r.request_id !== null) return false;
      if (r.status === "requested" && r.host_instance_id !== null) return false;
      if (r.status === "not_started") return false;
    }
    if (r.status === "authorization_ready" && (!r.publication || r.server_time >= r.expires_at)) return false;
    if (r.status === "expired" && r.publication !== null) return false;
    if (r.publication !== null) {
      const p = r.publication;
      if (!consentExact(p, ["schema", "authorization_url", "pending_sha256", "key_spki_b64", "key_sha256", "expires_at"])
        || p.schema !== "yin.comfy.mobile-consent-publication/v1" || !consentHex(p.pending_sha256) || !consentHex(p.key_sha256)
        || p.expires_at !== r.expires_at || !consentAuthorizationUrl(p.authorization_url, consentConfig.expectedEmail)) return false;
      try {
        const spki = consentUnbase64(p.key_spki_b64);
        if (await consentDigest(spki) !== p.key_sha256) return false;
        const key = await crypto.subtle.importKey("spki", spki, {name: "RSA-OAEP", hash: "SHA-256"}, false, ["encrypt"]);
        if (key.algorithm.modulusLength !== 3072 || consentBase64(key.algorithm.publicExponent) !== "AQAB") return false;
      } catch { return false; }
    }
    const marker = consentReadMarker();
    if (marker?.action === "submit" && r.request_id !== null && (r.request_id !== marker.request_id || r.envelope_sha256 !== marker.envelope_sha256 || r.handoff_id !== marker.handoff_id)) return false;
    const prior = consentState.binding;
    if (prior) {
      if (r.server_time < prior.server_time || ["handoff_id", "generation", "owner_session_id", "expires_at"].some(k => r[k] !== prior[k])
        || (prior.host_instance_id !== null && r.host_instance_id !== prior.host_instance_id)
        || (prior.request_id !== null && (r.request_id !== prior.request_id || r.envelope_sha256 !== prior.envelope_sha256))
        || (prior.publication !== null && r.publication !== null && JSON.stringify(Object.fromEntries(Object.keys(r.publication).sort().map(k => [k, r.publication[k]])))
          !== JSON.stringify(Object.fromEntries(Object.keys(prior.publication).sort().map(k => [k, prior.publication[k]]))))) return false;
      const order = ["requested", "begin_claimed", "authorization_ready", "response_submitted", "delivery_claimed", "expired", "connected"];
      if (order.indexOf(r.status) < order.indexOf(prior.status)) return false;
    }
    return true;
  };
  const consentCall = async (name, args) => {
    let timer;
    try {
      return await Promise.race([Promise.resolve().then(() => state.client.rpc(name, args)),
        new Promise((_, reject) => { timer = setTimeout(() => reject(Error("timeout")), 10000); })]);
    } finally { clearTimeout(timer); }
  };
  const consentCurrent = context => isCurrentReadiness(context) && state.readinessAuthorized && context.consentSession === consentSessionId()
    && !consentState.paused && context.consentEpoch === consentState.epoch;
  const consentContext = () => ({...sessionContext(), consentSession: consentSessionId(), consentEpoch: consentState.epoch});
  const consentApply = async (result, context, started) => {
    if (!consentCurrent(context)) return false;
    if (result?.error || !await consentValidate(result?.data, context)) throw Error("unavailable");
    if (!consentCurrent(context)) return false;
    const elapsed = Math.max(0, performance.now() - started) / 1000;
    const observed = Math.max(consentNow(), result.data.server_time + elapsed);
    consentState.snapshot = result.data; consentState.started = performance.now(); consentState.clockAtRead = observed; consentState.checkedAccount = false;
    if (result.data.handoff_id !== null) consentState.binding = result.data;
    if (result.data.status === "connected") {
      await loadInventory(context);
      if (!consentCurrent(context)) return false;
      consentState.checkedAccount = Boolean(state.inventory?.rows.some(r => r.account_id === consentConfig.accountId
        && r.account_verified === true && r.account_state === "verified" && stamp(r.identity_expires_at) > Date.now()
        && stamp(r.identity_observed_at) <= stamp(r.server_observed_at)));
    }
    return true;
  };
  const consentSchedule = () => {
    clearTimeout(consentState.poll);
    if (consentAllowed() && !consentState.paused && !document.hidden && consentLiveSnapshot()
      && ["requested", "begin_claimed", "response_submitted", "delivery_claimed"].includes(consentState.snapshot.status)) {
      consentState.poll = setTimeout(() => loadConsent(), 3000);
    }
  };
  const loadConsent = () => wakeEnabled ? wakeRun("read") : loadConsentDirect();
  const loadConsentDirect = async () => {
    if (!consentAllowed() || consentState.paused || consentState.busy) { renderConsent(); return; }
    const context = consentContext(), started = performance.now();
    consentState.busy = true; renderConsent("正核對連接狀態…");
    let okay = false;
    try { okay = await consentApply(await consentCall("comfy_owner_consent_read_v7", {p_operation_id: consentConfig.operationId}), context, started); }
    catch { if (consentCurrent(context)) { consentState.snapshot = null; renderConsent("暫時讀唔到連接狀態；原操作唔會重送。請稍後核對。"); } }
    finally {
      if (consentCurrent(context)) { consentState.busy = false; if (okay) { renderConsent(); consentSchedule(); } else consentRefresh.disabled = false; }
    }
  };
  const consentMutate = async action => {
    if (!consentAllowed() || !wakeReady() || consentState.paused || consentState.busy || !consentAck.checked) return;
    const context = consentContext();
    try {
      await navigator.locks.request(consentMarkerKey(), {mode: "exclusive", ifAvailable: true}, async lock => {
        if (!consentCurrent(context)) return;
        if (!lock) { renderConsent("另一個分頁正處理連接；請稍後核對狀態。"); return; }
        const marker = consentReadMarker(), r = consentState.snapshot;
        if (marker && marker.owner_session_id !== context.consentSession) { renderConsent(); return; }
        if (action === "start" ? !r || r.status !== "not_started" || marker
          : !r || r.status !== "authorization_ready" || !consentLiveSnapshot() || marker?.action === "submit") { renderConsent(); return; }
        let response = action === "submit" ? consentResponse.value : "";
        if (action === "submit" && !consentReturnValid(response, r.publication)) {
          consentStatus.textContent = "需要同一次 Google 授權後地址欄嘅完整回程網址；單獨驗證碼或其他連結唔可以用。"; return;
        }
        clearTimeout(consentState.poll); consentState.busy = true; renderConsent("正安全處理連接要求…");
        let args = {p_operation_id: consentConfig.operationId}, pending = null;
        try {
          if (action === "submit") {
            const requestId = crypto.randomUUID();
            const aad = {schema: "yin.comfy.mobile-consent-aad/v1", owner_id: r.owner_id, account_id: r.account_id,
              operation_id: r.operation_id, handoff_id: r.handoff_id, generation: r.generation, owner_session_id: r.owner_session_id,
              pending_sha256: r.publication.pending_sha256, key_sha256: r.publication.key_sha256, expires_at: r.expires_at,
              request_id: requestId, host_instance_id: r.host_instance_id};
            const envelope = await encryptReturnUrl(r.publication, aad, response);
            response = "";
            const digest = await consentDigest(consentBytes(JSON.stringify(Object.fromEntries(Object.keys(envelope).sort().map(k => [k, envelope[k]])))));
            if (!consentCurrent(context) || !wakeReady() || !consentLiveSnapshot()) return;
            args = {...args, p_handoff_id: r.handoff_id, p_request_id: requestId, p_envelope: envelope};
            pending = {requestId, envelope, digest};
          }
          if (!consentCurrent(context) || !wakeReady()) return;
          consentWriteMarker({version: 1, owner_id: context.ownerId, operation_id: consentConfig.operationId,
            owner_session_id: context.consentSession, action, handoff_id: action === "submit" ? r.handoff_id : null,
            request_id: pending?.requestId || null, envelope_sha256: pending?.digest || null});
          consentState.pending = pending; // Encrypted envelope in RAM only; never resend it.
          if (action === "submit") consentResponse.value = "";
          const sentAt = performance.now();
          const okay = await consentApply(await consentCall(action === "start" ? "comfy_owner_consent_start_v7" : "comfy_owner_consent_submit_v7", args), context, sentAt);
          if (okay) { consentState.busy = false; renderConsent(); consentSchedule(); }
        } catch {
          if (consentCurrent(context)) {
            consentState.snapshot = null;
            renderConsent("未能確認連接要求結果；已停止提交，唔會重送。請核對原本連接狀態。");
          }
        } finally {
          response = "";
          if (consentCurrent(context)) { consentState.busy = false; consentRefresh.disabled = false; }
        }
      });
    } catch { if (consentCurrent(context)) renderConsent("未能安全保存連接紀錄；已停止提交，請保留此頁作核對。"); }
  };
  byId("consent-pause").addEventListener("click", () => {
    if (!consentAllowed()) return;
    consentState.paused = true;
    clearTimeout(wakeState.poll); wakeState.poll = null; wakeState.busy = false; wakeState.snapshot = null;
    consentState.epoch += 1;
    clearTimeout(consentState.poll); consentState.poll = null;
    consentState.busy = false; consentState.snapshot = null; consentState.pending = null;
    consentResponse.value = ""; consentAck.checked = false;
    renderConsent();
  });
  byId("consent-resume").addEventListener("click", () => {
    if (!consentAllowed() || !consentState.paused) return;
    consentState.paused = false;
    consentState.snapshot = null;
    loadConsent();
  });
  byId("wake-request").addEventListener("click", () => wakeRun("request"));
  byId("wake-cancel").addEventListener("click", () => wakeRun("cancel"));
  consentAck.addEventListener("change", () => renderConsent());
  consentStart.addEventListener("click", () => consentMutate("start"));
  consentRefresh.addEventListener("click", () => loadConsent());
  consentForm.addEventListener("submit", event => { event.preventDefault(); consentMutate("submit"); });
  consentGoogle.addEventListener("click", event => {
    try {
      if (!consentAllowed() || !wakeReady() || consentState.paused || consentState.busy || !consentAck.checked || !consentLiveSnapshot()
        || consentState.snapshot.status !== "authorization_ready" || consentReadMarker()?.action === "submit") throw Error("held");
    } catch { event.preventDefault(); renderConsent(); }
  });
  window.addEventListener("storage", event => { if (consentConfigured() && [consentMarkerKey(), wakeKey()].includes(event.key)) renderConsent(); });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { clearTimeout(consentState.poll); clearTimeout(wakeState.poll); }
    else { renderConsent(); consentSchedule(); wakeSchedule(); }
  });
  window.addEventListener("pagehide", () => { consentResponse.value = ""; resetConsent(); });
  window.addEventListener("pageshow", event => { if (event.persisted) loadConsent(); });
  window.setInterval(() => {
    if (wakeEnabled && wakeState.snapshot?.expires_at !== null && wakeState.snapshot && wakeState.snapshot.expires_at <= wakeNow()) { consentResponse.value = ""; renderConsent(); }
    if (consentAllowed() && consentState.snapshot?.expires_at !== null && consentState.snapshot && !consentLiveSnapshot()
      && consentState.snapshot.status !== "connected") renderConsent();
  }, 1000);
  const targetedReadModel = config.targetedReadModel === "v3";
  // Default-off candidate: current production inventory remains explicitly held.
  const targetedExecution = targetedReadModel && config.targetedExecution === "v1";
  const targetRoute = "comfy-targeted/v3";
  const blobUrls = new Set();
  const jobDownloads = new Set();
  let jobsFlight = null;
  const abortJobDownloads = (controller = null) => {
    for (const item of jobDownloads) {
      if (controller && item.owner !== controller) continue;
      item.controller.abort();
      if (item.reader) {
        try { Promise.resolve(item.reader.cancel()).catch(() => {}); } catch { /* already closed */ }
      }
    }
  };
  let targetBusy = false;
  let targetLockActive = false;
  const supportsTargetLock = () => Boolean(navigator.locks && typeof navigator.locks.request === "function");
  const targetLockUnavailable = "呢個瀏覽器未支援安全提交；已停用提交同取消，仍可查看作品狀態。";
  const withTargetLock = async (context, action) => {
    if (!targetedExecution || !isCurrentReadiness(context)) return;
    if (!supportsTargetLock()) { blockPendingRecovery(targetLockUnavailable); return; }
    try {
      // All cooperative tabs on this origin share the same project/owner lock.
      // Read the existing durable record only after acquisition; never invent a
      // replacement key while another tab owns submit, cancel or reconciliation.
      await navigator.locks.request("comfy:targeted:v1:" + project() + ":" + context.ownerId,
        { mode: "exclusive", ifAvailable: true }, async (lock) => {
          if (!isCurrentReadiness(context)) return;
          if (!lock) {
            setNote(formNote, "另一個分頁正處理呢個帳戶嘅提交；請稍後重新整理核對狀態。", true);
            return;
          }
          targetLockActive = true;
          applyAccountHold();
          try { await action(); }
          finally { targetLockActive = false; if (isCurrentReadiness(context)) applyAccountHold(); }
        });
    } catch {
      if (isCurrentReadiness(context)) blockPendingRecovery("未能確認安全提交狀態；原紀錄已保留，請重新整理核對。");
    }
  };
  const uuid = (value) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  const hash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  const project = () => new URL(config.supabaseUrl).origin;
  const targetKey = (owner) => "comfy:pending-enqueue:v2:" + encodeURIComponent(project()) + ":" + encodeURIComponent(owner);
  const legacyCancelKey = (owner, jobId) => "comfy:pending-cancel:v1:" + encodeURIComponent(project())
    + ":" + encodeURIComponent(owner) + ":" + encodeURIComponent(jobId);
  const legacyCancelRead = (owner, jobId) => {
    try {
      const key = legacyCancelKey(owner, jobId), raw = localStorage.getItem(key);
      if (raw === null) return { kind: "absent", key };
      const record = JSON.parse(raw);
      if (!record || Object.keys(record).sort().join(",") !== "action,jobId,ownerId,phase,project,route,version"
        || record.version !== 1 || record.action !== "cancel" || record.phase !== "claimed"
        || record.route !== "legacy" || record.project !== project()
        || record.ownerId !== owner || record.jobId !== jobId || !uuid(jobId)) return { kind: "invalid", key, raw };
      return { kind: "valid", key, raw, record };
    } catch { return { kind: "invalid" }; }
  };
  const legacyCancelClaim = (owner, jobId) => {
    const current = legacyCancelRead(owner, jobId);
    if (current.kind !== "absent") return { ...current, existing: true };
    try {
      const record = { version: 1, project: project(), ownerId: owner, route: "legacy",
        jobId, action: "cancel", phase: "claimed" };
      const raw = JSON.stringify(record);
      localStorage.setItem(current.key, raw);
      return localStorage.getItem(current.key) === raw
        ? { kind: "valid", key: current.key, raw, record }
        : { kind: "invalid", key: current.key };
    } catch { return { kind: "invalid", key: current.key }; }
  };
  const legacyCancelClear = (owner, jobId) => {
    const current = legacyCancelRead(owner, jobId);
    if (current.kind !== "valid") return current.kind === "absent";
    try {
      if (localStorage.getItem(current.key) !== current.raw) return false;
      localStorage.removeItem(current.key);
      return localStorage.getItem(current.key) === null;
    } catch { return false; }
  };
  const canonical = (v) => Array.isArray(v) ? "[" + v.map(canonical).join(",") + "]"
    : v && typeof v === "object" ? "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}" : JSON.stringify(v);
  const sha = async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
  const targetRead = (owner) => {
    try {
      const raw = localStorage.getItem(targetKey(owner));
      if (raw === null) return { kind: "absent" };
      const r = JSON.parse(raw), q = r.request;
      const keys = r.phase === "accepted" ? "draft,jobId,ownerId,phase,project,request,requestHash,route,signature,version" : "draft,ownerId,phase,project,request,route,signature,version";
      if (Object.keys(r).sort().join(",") !== keys || !r.draft
        || !["prompt", "width", "height", "seed"].every(k => typeof r.draft[k] === "string") || r.version !== 2 || r.ownerId !== owner || r.project !== project() || r.route !== targetRoute
        || !q || !uuid(q.account_id) || !["A100", "T4"].includes(q.gpu_type) || !uuid(q.idempotency_key)
        || typeof q.preset_id !== "string" || typeof q.preset_version !== "string" || !q.params || typeof q.params !== "object" || Array.isArray(q.params) || !Array.isArray(q.input_asset_ids)
        || Object.keys(q).sort().join(",") !== "account_id,gpu_type,idempotency_key,input_asset_ids,params,preset_id,preset_version"
        || canonical(q) !== r.signature || !["claimed", "accepted"].includes(r.phase)
        || (r.phase === "accepted" && (!uuid(r.jobId) || !hash(r.requestHash)))) return { kind: "invalid", raw };
      return { kind: "valid", raw, record: r };
    } catch { return { kind: "invalid" }; }
  };
  const targetWrite = (owner, record, expectedRaw) => {
    try {
      const key = targetKey(owner);
      if (expectedRaw !== undefined && localStorage.getItem(key) !== expectedRaw) return false;
      const raw = JSON.stringify(record); localStorage.setItem(key, raw);
      return localStorage.getItem(key) === raw;
    } catch { return false; }
  };
  const invokeTarget = async (action, payload) => {
    let deadline;
    try {
      return await Promise.race([state.client.functions.invoke("comfy-targeted", { body: { action, payload } }),
        new Promise(resolve => { deadline = setTimeout(() => resolve({ error: true }), 10000); })]);
    } catch { return { error: true }; } finally { clearTimeout(deadline); }
  };
  const validStatus = (data, jobId, requestHash) => data && Object.keys(data).sort().join(",") === "action_allowed,job_id,job_status,request_hash"
    && uuid(data.job_id) && hash(data.request_hash) && data.action_allowed === false
    && (!jobId || data.job_id === jobId) && (!requestHash || data.request_hash === requestHash)
    && ["queued", "running", "cancel_requested", "reconciling", "verifying", "blocked", "succeeded", "failed", "canceled"].includes(data.job_status);
  const targetEligible = () => {
    const snap = state.inventory;
    if (!targetedExecution || !supportsTargetLock() || !state.readinessAuthorized || !snap || !sameInventoryPair(snap.pair, currentInventoryPair())) return false;
    const rows = snap.rows.filter(r => r.account_id === state.selectedAccount && r.gpu_type === state.selectedGpu);
    if (rows.length !== 1) return false;
    const r = rows[0], now = Math.max(Date.now(), stamp(r.server_observed_at) + performance.now() - snap.started);
    const fresh = (name) => Number.isFinite(stamp(r[name + "_observed_at"])) && stamp(r[name + "_observed_at"]) <= stamp(r.server_observed_at)
      && stamp(r[name + "_expires_at"]) > now;
    return r.integration_ready === true && r.dispatch_allowed === true && r.hold_reason === null
      && now - stamp(r.server_observed_at) < 60000 && stamp(r.server_observed_at) <= Date.now() + 5000
      && ["identity", "policy", "balance", "allocation", "compatibility"].every(fresh)
      && r.account_verified === true && r.account_state === "verified" && r.policy_eligible === true
      && r.policy_state === "allowed" && r.policy_scope === "identity_bound_worker"
      && r.balance_fresh === true && r.balance_state === "fresh" && r.eligibility_state === "eligible"
      && r.eligible_gpu_types.includes(state.selectedGpu) && r.allocation_verified === true
      && r.runtime_state === "allocated" && r.compatibility_verified === true && r.preset_released === true;
  };
  const reconcileTargetLocked = async (context) => {
    if (!targetedExecution || !isCurrentReadiness(context)) return;
    const saved = targetRead(context.ownerId);
    if (saved.kind === "absent") return;
    if (saved.kind !== "valid") { blockPendingRecovery("指定資源嘅復原紀錄讀唔到；已保留原文，暫停提交。"); return; }
    blockPendingRecovery("正核對原提交；唔會重複落單。");
    const r = saved.record, result = await invokeTarget("request_status", { idempotency_key: r.request.idempotency_key });
    if (!isCurrentReadiness(context)) return;
    const data = result.data;
    if (result.error || !validStatus(data, r.jobId, r.requestHash)) {
      blockPendingRecovery("原提交結果未知；保留草稿同紀錄，只會繼續核對狀態。"); return;
    }
    const readback = await state.client.from("comfy_jobs")
      .select("id,owner_id,idempotency_key,request_hash,requested_account_id,requested_gpu_type,preset_id,preset_version,params,input_asset_ids")
      .eq("id", data.job_id).eq("idempotency_key", r.request.idempotency_key).limit(2);
    if (!isCurrentReadiness(context)) return;
    const job = Array.isArray(readback.data) && readback.data.length === 1 ? readback.data[0] : null, q = r.request;
    if (readback.error || !job || job.owner_id !== context.ownerId || job.id !== data.job_id
      || job.idempotency_key !== q.idempotency_key || job.request_hash !== data.request_hash
      || job.requested_account_id !== q.account_id || job.requested_gpu_type !== q.gpu_type
      || job.preset_id !== q.preset_id || job.preset_version !== q.preset_version || !job.params
      || !Object.keys(q.params).every(k => canonical(q.params[k]) === canonical(job.params[k]))
      || canonical(job.input_asset_ids) !== canonical(q.input_asset_ids)) {
      blockPendingRecovery("原提交內容未能核對一致；保留原紀錄，唔會再提交。"); return;
    }
    if (!targetWrite(context.ownerId, { ...r, phase: "accepted", jobId: data.job_id, requestHash: data.request_hash }, saved.raw)) {
      blockPendingRecovery("未能保存核對結果；原紀錄保持不變。"); return;
    }
    state.pendingRecoveryBlocked = !["succeeded", "failed", "canceled", "blocked"].includes(data.job_status);
    setNote(formNote, "原提交：" + statusLabel(data.job_status) + "；新草稿已保留。", false);
    applyAccountHold();
  };
  const reconcileTarget = (context) => withTargetLock(context, () => reconcileTargetLocked(context));
  const submitTarget = () => {
    const context = sessionContext();
    return withTargetLock(context, () => submitTargetLocked());
  };
  const submitTargetLocked = async () => {
    if (targetBusy) return;
    targetBusy = true;
    const context = sessionContext(), revision = state.draftRevision, draft = draftSnapshot();
    try {
      try {
        const rawDraft = localStorage.getItem(targetKey(context.ownerId) + ":draft");
        if (rawDraft !== null) {
          const d = JSON.parse(rawDraft);
          if (d.version !== 2 || d.ownerId !== context.ownerId || d.project !== project()
            || !["presetId", "prompt", "width", "height", "seed", "account", "gpu"].every(k => typeof d[k] === "string")) throw Error("draft");
        }
      } catch { blockPendingRecovery("草稿復原資料讀唔到；保留原文，未有落單。"); return; }
      const legacy = readPendingRequestState(context.ownerId), old = targetRead(context.ownerId);
      if (legacy.kind !== "absent" || old.kind === "invalid") { blockPendingRecovery("原提交紀錄需要先核對；已保留，唔會另落單。"); return; }
      let expectedRaw = null;
      if (old.kind === "valid") {
        await reconcileTargetLocked(context);
        if (!isCurrentReadiness(context) || state.pendingRecoveryBlocked) return;
        const reconciled = targetRead(context.ownerId);
        if (reconciled.kind !== "valid") return;
        expectedRaw = reconciled.raw;
      }
      await loadInventory(context);
      if (!isCurrentReadiness(context) || revision !== state.draftRevision || draft !== draftSnapshot() || !targetEligible()) {
        applyAccountHold(); setNote(formNote, accountHold, true); return;
      }
      const base = currentRequest(); if (!base) return;
      const request = { account_id: state.selectedAccount, gpu_type: state.selectedGpu, idempotency_key: crypto.randomUUID(),
        preset_id: base.p_preset_id, preset_version: base.p_preset_version, params: base.p_params, input_asset_ids: base.p_input_asset_ids };
      const record = { version: 2, ownerId: context.ownerId, project: project(), route: targetRoute,
        phase: "claimed", request, signature: canonical(request), draft: { prompt: promptInput.value, width: widthInput.value, height: heightInput.value, seed: seedInput.value } };
      if (!targetWrite(context.ownerId, record, expectedRaw)) { blockPendingRecovery("未能保存原提交；未有落單。"); return; }
      blockPendingRecovery("正提交到指定帳戶同 GPU…");
      await invokeTarget("enqueue", request);
      // Even a lost ACK is reconciled exclusively by the original durable key.
      if (!isCurrentReadiness(context)) return;
      await reconcileTargetLocked(context); await loadJobs(context, { supersede: true });
    } finally { targetBusy = false; if (isCurrentReadiness(context)) applyAccountHold(); }
  };
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
    && !state.logoutLocked
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

  // 007 is a read-only local candidate. It never supplies execution authority.
  const accountHold = "呢個帳戶暫不可用嚟製作作品；唔會自動轉用其他帳戶。";
  const applyAccountHold = () => {
    if (targetedExecution || state.selectedAccount || state.selectedGpu) submitButton.disabled = targetBusy || targetLockActive || state.pendingRecoveryBlocked || !targetEligible();
    gpuSelect.disabled = !state.selectedAccount || !state.readinessAuthorized;
    gpuSelect.value = state.selectedGpu;
    gpuNote.textContent = targetEligible() ? "已核對指定 " + state.selectedGpu + " 分配；提交前會再檢查。" : state.selectedGpu
      ? "已選 " + state.selectedGpu + " 偏好；實際分配未確認。指定資源製作仍未接通。"
      : "揀帳戶後可選 GPU 偏好；呢個選擇唔代表已分配資源。";
    accountSelectionNote.textContent = targetedExecution && !supportsTargetLock() ? targetLockUnavailable : state.selectedAccount ? (targetEligible() ? "指定帳戶及 GPU 資料已核對；提交前會再檢查。" : accountHold)
      : "暫時只可查看帳戶資料，未能指定帳戶製作作品。";
  };
  const resetInventory = (message, clearSelection = false) => {
    state.inventoryRequest += 1;
    state.inventory = null;
    state.inventoryPair = null;
    if (clearSelection) { state.selectedAccount = ""; state.selectedGpu = ""; }
    clearNode(accountCards);
    clearNode(accountSelect);
    accountSelect.append(element("option", "", "暫不指定帳戶"));
    accountSelect.firstChild.value = "";
    if (state.selectedAccount) {
      const held = element("option", "", "已選帳戶 · 暫未能確認");
      held.value = state.selectedAccount;
      accountSelect.append(held);
      accountSelect.value = state.selectedAccount;
    }
    accountControls.hidden = !state.selectedAccount;
    refreshAccounts.disabled = !state.readinessAuthorized;
    accountNote.textContent = message;
    applyAccountHold();
  };
  const stamp = (value) => typeof value === "string" && value.trim() ? Date.parse(value) : NaN;
  const observationTime = (value) => Number.isFinite(stamp(value))
    ? new Intl.DateTimeFormat("zh-HK", { dateStyle: "medium", timeStyle: "medium" }).format(new Date(value)) : "未知";
  const numericObservation = (value) => {
    if (value === null) return null;
    if (!(typeof value === "number" || (typeof value === "string" && /^\d+(\.\d+)?$/.test(value)))) return NaN;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : NaN;
  };
  const accountFields = ["account_label", "provider", "account_state", "account_verified",
    "identity_observed_at", "identity_expires_at", "policy_state", "policy_scope", "policy_eligible",
    "policy_observed_at", "policy_expires_at", "compute_units", "units_per_hour", "balance_observed_at",
    "balance_expires_at", "balance_fresh", "balance_state", "eligibility_state", "eligible_gpu_types"];
  const validateInventory = (rows, pair) => {
    if (!Array.isArray(rows) || rows.length > 500) return false;
    const accounts = new Map();
    const runtimes = new Set();
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const row of rows) {
      if (!row || typeof row !== "object" || !uuid.test(row.account_id)
        || typeof row.account_label !== "string" || !row.account_label.trim() || row.account_label.length > 80
        || row.provider !== "google_colab" || row.preset_id !== pair.p_preset_id || row.preset_version !== pair.p_preset_version
        || !["account_verified", "policy_eligible", "allocation_verified", "compatibility_verified", "preset_released", "balance_fresh"].every((key) => typeof row[key] === "boolean")
        || !((row.integration_ready === false && row.dispatch_allowed === false
          && row.hold_reason === "identity_bound_queue_edge_worker_integration_pending")
          || (targetedExecution && row.integration_ready === true && row.dispatch_allowed === true && row.hold_reason === null))
        || !["unknown", "ambiguous", "future", "stale", "fresh"].includes(row.balance_state)
        || !["unknown", "eligible", "ineligible"].includes(row.eligibility_state)
        || !Array.isArray(row.eligible_gpu_types) || row.eligible_gpu_types.some((gpu) => !["A100", "T4"].includes(gpu))
        || !Number.isFinite(stamp(row.server_observed_at)) || stamp(row.server_observed_at) > Date.now() + 5000
        || Number.isNaN(numericObservation(row.compute_units)) || Number.isNaN(numericObservation(row.units_per_hour))) return false;
      if (row.runtime_id === null) {
        if (row.gpu_type !== null || row.runtime_state !== null || row.allocation_verified || row.compatibility_verified) return false;
      } else {
        if (!uuid.test(row.runtime_id) || runtimes.has(row.runtime_id) || !["T4", "A100"].includes(row.gpu_type)) return false;
        runtimes.add(row.runtime_id);
      }
      const signature = JSON.stringify(accountFields.map((key) => row[key]));
      if (accounts.has(row.account_id) && accounts.get(row.account_id) !== signature) return false;
      accounts.set(row.account_id, signature);
    }
    return true;
  };
  const currentInventoryPair = () => {
    const preset = state.enabledPresets.find((item) => item.preset_id === presetSelect.value);
    return { p_preset_id: preset ? preset.preset_id : null, p_preset_version: preset ? preset.version : null };
  };
  const sameInventoryPair = (left, right) => Boolean(left && right
    && left.p_preset_id === right.p_preset_id && left.p_preset_version === right.p_preset_version);
  const syncInventorySelection = () => {
    if (state.inventoryPair && !sameInventoryPair(state.inventoryPair, currentInventoryPair())) {
      // Includes programmatic form.reset(), draft restoration and preset changes.
      // loadInventory clears the old snapshot before starting the next read.
      loadInventory();
    }
  };
  const renderInventory = () => {
    const snapshot = state.inventory;
    if (!snapshot || !state.readinessAuthorized) return;
    if (!sameInventoryPair(snapshot.pair, currentInventoryPair())) {
      loadInventory();
      return;
    }
    const groups = new Map();
    for (const row of snapshot.rows) {
      if (!groups.has(row.account_id)) groups.set(row.account_id, []);
      groups.get(row.account_id).push(row);
    }
    clearNode(accountCards);
    const elapsed = Math.max(0, performance.now() - snapshot.started);
    const validAt = (row, observedKey, expiryKey) => {
      const serverNow = stamp(row.server_observed_at);
      const now = Math.max(Date.now(), serverNow + elapsed);
      const observed = stamp(row[observedKey]);
      const expiry = stamp(row[expiryKey]);
      return now - serverNow < 60000 && Number.isFinite(observed) && Number.isFinite(expiry)
        && observed <= serverNow && expiry > now && expiry > observed;
    };
    const fact = (list, label, value, className = "") => {
      const item = element("div");
      item.append(element("dt", "", label), element("dd", className, value));
      list.append(item);
    };
    for (const [id, rows] of groups) {
      if (state.selectedAccount && id !== state.selectedAccount) continue;
      const row = rows[0];
      const identity = row.account_verified === true && row.account_state === "verified"
        && validAt(row, "identity_observed_at", "identity_expires_at");
      const fresh = identity && row.balance_fresh === true && row.balance_state === "fresh"
        && validAt(row, "balance_observed_at", "balance_expires_at");
      const card = element("article", "account-card");
      card.dataset.accountId = id;
      card.append(element("h4", "", row.account_label));
      const list = element("dl", "account-facts");
      const freshness = { unknown: "未有記錄", ambiguous: "資料不一致", future: "資料時間異常", stale: "資料已過期", fresh: "資料已過期或帳戶未確認" };
      fact(list, "資料狀態", fresh ? "資料有效" : "未知 · " + freshness[row.balance_state]);
      const numberLabel = (value) => fresh && numericObservation(value) !== null ? String(numericObservation(value)) : "未知";
      fact(list, "餘額（CU）", numberLabel(row.compute_units), "account-balance");
      fact(list, "耗用率（CU／小時）", numberLabel(row.units_per_hour));
      fact(list, "上次更新", observationTime(row.balance_observed_at));
      fact(list, "可申請 GPU", fresh && row.eligibility_state === "eligible" && row.eligible_gpu_types.length
        ? row.eligible_gpu_types.join("、") + "（未保證有位）"
        : fresh && row.eligibility_state === "ineligible" ? "暫不符合資格" : "未知");
      fact(list, "自動使用權限", identity && row.policy_eligible === true && row.policy_state === "allowed"
        && row.policy_scope === "identity_bound_worker" && validAt(row, "policy_observed_at", "policy_expires_at")
        ? "已確認；網站暫未開放" : "未確認／已失效");
      card.append(list);
      const runtimeList = element("ul", "account-runtimes");
      for (const runtime of rows) {
        const allocated = identity && runtime.allocation_verified === true && runtime.runtime_state === "allocated"
          && validAt(runtime, "allocation_observed_at", "allocation_expires_at");
        const compatible = allocated && runtime.compatibility_verified === true && runtime.preset_released === true
          && validAt(runtime, "compatibility_observed_at", "compatibility_expires_at");
        runtimeList.append(element("li", "", runtime.runtime_id === null ? "未有 GPU 分配記錄"
          : runtime.gpu_type + " · " + (allocated ? "分配資料有效" : "分配狀態未知")
            + " · " + (compatible ? "所選模型已核對" : "所選模型未確認相容")));
      }
      card.append(runtimeList, element("p", "account-hold", "暫不可使用此帳戶製作"));
      accountCards.append(card);
    }
    if (state.selectedAccount && !groups.has(state.selectedAccount)) {
      accountCards.append(element("p", "empty", "暫時讀唔到已選帳戶，未能用佢製作作品。"));
    }
  };
  const loadInventory = async (context = sessionContext()) => {
    if (!state.client || !state.readinessAuthorized || !isCurrentReadiness(context)) return;
    resetInventory("正讀取帳戶狀態…");
    const requestId = state.inventoryRequest;
    const pair = currentInventoryPair();
    state.inventoryPair = pair;
    const started = performance.now();
    let result;
    let deadline;
    try {
      result = await Promise.race([
        state.client.rpc("comfy_account_inventory_v2", pair),
        new Promise((resolve) => { deadline = window.setTimeout(() => resolve({ error: true }), 10000); }),
      ]);
    } catch { result = { error: true }; }
    finally { window.clearTimeout(deadline); }
    if (!isCurrentReadiness(context) || requestId !== state.inventoryRequest) return;
    if (!sameInventoryPair(pair, currentInventoryPair())) { loadInventory(context); return; }
    if (!result || result.error) {
      accountNote.textContent = "暫時讀唔到帳戶資料，未能顯示餘額同 GPU；你仍可查看作品進度。請稍後再更新。";
      return;
    }
    if (!validateInventory(result.data, pair)) {
      accountNote.textContent = "帳戶資料有問題，暫時未能確認；請稍後更新。";
      return;
    }
    state.inventory = { rows: result.data, started, pair };
    const accounts = new Map(result.data.map((row) => [row.account_id, row.account_label]));
    clearNode(accountSelect);
    const defaultOption = element("option", "", "暫不指定帳戶");
    defaultOption.value = "";
    accountSelect.append(defaultOption);
    if (state.selectedAccount && !accounts.has(state.selectedAccount)) {
      const held = element("option", "", "已選帳戶 · 暫未能確認");
      held.value = state.selectedAccount;
      accountSelect.append(held);
    }
    for (const [id, label] of accounts) {
      const option = element("option", "", label); option.value = id; accountSelect.append(option);
    }
    accountSelect.value = state.selectedAccount;
    accountControls.hidden = accounts.size === 0 && !state.selectedAccount;
    accountNote.textContent = accounts.size ? "共 " + accounts.size + " 個帳戶；" + (targetedExecution ? "選定帳戶後會檢查製作資格。" : "暫時只供查看資料。")
      : "未有帳戶記錄，餘額同 GPU 仍然未知。";
    renderInventory();
    applyAccountHold();
  };

  const safeError = (scope, error) => {
    console.error("Yinops Render " + scope + " unavailable");
    if (scope === "auth") return "登入未完成，請稍後再試。";
    if (scope === "readiness") return "暫時確認唔到帳戶授權；私人介面保持鎖住。";
    if (scope === "presets") return "暫時讀唔到已開放模型，未能開始製作。";
    if (scope === "enqueue") return "未能確認提交結果；已保留原設定，同一設定再提交時唔會重複建立。";
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
    if (row.status === "blocked") return "模型未開放，或所需資料未通過檢查。";
    if (row.status === "failed") return "生成未完成；內部錯誤已收起。";
    if (row.status === "cancel_requested") return "正等製作端確認取消。";
    if (row.status === "reconciling") return "正核對製作結果，唔會重複提交。";
    if (row.status === "verifying") return "正檢查作品檔案，完成後就可以查看。";
    return "";
  };

  // Absence of routing columns is not evidence of a legacy job, in any config.
  const jobRoute = (row) => {
    if (row.requested_account_id === null && row.target_account_id === null) return "legacy";
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuid.test(row.requested_account_id) || uuid.test(row.target_account_id)) return "targeted";
    return "unknown";
  };
  const isTargeted = (row) => jobRoute(row) === "targeted";
  const verifiedArtifact = (row) => {
    if (jobRoute(row) !== "legacy") return null;
    const artifacts = Array.isArray(row.comfy_artifacts) ? row.comfy_artifacts : [];
    return artifacts.find((artifact) => artifact.verification_state === "verified") || null;
  };

  const appendTargetResult = async (cell, listed, context) => {
    const unavailable = () => cell.append(element("span", "muted", "指定資源作品未有完整驗證結果。模型組件仍未核實。"));
    if (!targetedExecution || listed.status !== "succeeded" || !uuid(listed.id) || !hash(listed.request_hash)
      || typeof listed.idempotency_key !== "string") { unavailable(); return; }
    if (!isCurrentJobs(context)) return;
    try {
      const status = await invokeTarget("request_status", { idempotency_key: listed.idempotency_key });
      if (!isCurrentJobs(context)) return;
      if (status.error || !validStatus(status.data, listed.id, listed.request_hash) || status.data.job_status !== "succeeded") throw Error("status");
      const result = await state.client.from("comfy_jobs").select("*,comfy_artifacts(*)")
        .eq("id", listed.id).eq("idempotency_key", listed.idempotency_key).limit(2);
      if (!isCurrentJobs(context)) return;
      if (result.error || !Array.isArray(result.data) || result.data.length !== 1) throw Error("job");
      const j = result.data[0], t = j.requested_target;
      if (j.owner_id !== context.ownerId || j.id !== listed.id || j.idempotency_key !== listed.idempotency_key
        || j.request_hash !== listed.request_hash || j.status !== "succeeded" || j.cancel_requested_at !== null
        || j.kind !== "image" || !uuid(j.current_attempt_id) || !Number.isInteger(j.fence_generation) || j.fence_generation < 1
        || !t || t.schema !== "comfy.request/v3" || t.owner_id !== context.ownerId
        || !uuid(j.requested_account_id) || t.account_id !== j.requested_account_id
        || t.gpu_type !== j.requested_gpu_type || !["A100", "T4"].includes(t.gpu_type)
        || t.preset_id !== j.preset_id || t.preset_version !== j.preset_version
        || !j.params || !Array.isArray(j.input_asset_ids) || !hash(t.workflow_hash)
        || typeof t.model_revision !== "string" || !t.model_revision || t.model_revision === "UNKNOWN") throw Error("binding");
      const provenance = await state.client.rpc("comfy_authenticated_result_provenance_v3", { p_job_id: j.id, p_request_hash: j.request_hash });
      if (!isCurrentJobs(context)) return;
      const a = provenance.data;
      if (provenance.error || !a || Object.keys(a).sort().join(",") !== "id,job_id,model_revision,model_stack,phase,workflow_hash"
        || a.id !== j.current_attempt_id || a.job_id !== j.id || a.phase !== "succeeded" || a.model_stack !== null
        || a.workflow_hash !== t.workflow_hash || a.model_revision !== t.model_revision) throw Error("provenance");
      const artifacts = (Array.isArray(j.comfy_artifacts) ? j.comfy_artifacts : []).filter(x => x.role === "primary" && x.attempt_id === j.current_attempt_id);
      if (artifacts.length !== 1) throw Error("primary");
      const f = artifacts[0], path = context.ownerId + "/" + j.id + "/" + j.current_attempt_id + "/primary/" + f.sha256 + ".png";
      if (!uuid(f.id) || f.owner_id !== context.ownerId || f.job_id !== j.id || f.kind !== "image"
        || f.verification_state !== "verified" || !hash(f.sha256) || f.readback_sha256 !== f.sha256
        || f.storage_path !== path || f.immutable_storage_key !== path || f.mime_type !== "image/png"
        || !Number.isSafeInteger(f.byte_size) || f.byte_size <= 0 || f.byte_size > 100 * 1024 * 1024
        || !Number.isSafeInteger(f.width) || !Number.isSafeInteger(f.height) || f.width <= 0 || f.height <= 0
        || (j.params.width !== undefined && f.width !== j.params.width) || (j.params.height !== undefined && f.height !== j.params.height)) throw Error("artifact");
      const signed = await state.client.storage.from("comfy-outputs").createSignedUrl(path, 600);
      if (!isCurrentJobs(context)) return;
      if (signed.error || !signed.data || typeof signed.data.signedUrl !== "string") throw Error("sign");
      const url = new URL(signed.data.signedUrl);
      if (url.origin !== project() || url.protocol !== "https:" || url.username || url.password || url.hash
        || url.pathname !== "/storage/v1/object/sign/comfy-outputs/" + path) throw Error("url");
      const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), 10000);
      const download = { controller: abort, owner: context.itemAbort || context.jobsAbort, reader: null };
      jobDownloads.add(download);
      let bytes;
      try {
        if (!isCurrentJobs(context)) return;
        const response = await fetch(url.href, { credentials: "omit", redirect: "error", signal: abort.signal, cache: "no-store" });
        if (!isCurrentJobs(context)) return;
        if (!response.ok || response.headers.get("content-type")?.split(";")[0] !== "image/png" || !response.body) throw Error("download");
        const reader = response.body.getReader(), chunks = []; download.reader = reader; let size = 0;
        for (;;) { const part = await reader.read(); if (!isCurrentJobs(context)) return; if (part.done) break; size += part.value.length;
          if (size > f.byte_size) { await reader.cancel(); throw Error("size"); } chunks.push(part.value); }
        if (size !== f.byte_size) throw Error("size");
        bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      } finally { clearTimeout(timeout); jobDownloads.delete(download); }
      if (!isCurrentJobs(context)) return;
      if (await sha(bytes) !== f.sha256) throw Error("hash");
      if (!isCurrentJobs(context)) return;
      const blob = new Blob([bytes], { type: "image/png" }), bitmap = await createImageBitmap(blob);
      const correctSize = bitmap.width === f.width && bitmap.height === f.height; bitmap.close();
      if (!correctSize || !isCurrentJobs(context)) throw Error("dimensions/session");
      // Re-read both current attempt and fenced provenance after downloading.
      const again = await state.client.rpc("comfy_authenticated_result_provenance_v3", { p_job_id: j.id, p_request_hash: j.request_hash });
      if (again.error || canonical(again.data) !== canonical(a) || !isCurrentJobs(context)) throw Error("superseded");
      const fresh = await invokeTarget("request_status", { idempotency_key: j.idempotency_key });
      if (fresh.error || !validStatus(fresh.data, j.id, j.request_hash) || fresh.data.job_status !== "succeeded" || !isCurrentJobs(context)) throw Error("changed");
      const objectUrl = URL.createObjectURL(blob); blobUrls.add(objectUrl);
      const image = element("img", "result-media"); image.src = objectUrl; image.alt = "已核對檔案 · " + shortId(j.id);
      cell.append(image, element("span", "row-subline", "檔案已核對；模型組件未能核實，未代表畫面驗收。"));
    } catch { if (isCurrentJobs(context)) unavailable(); }
  };

  const appendResult = async (cell, row, artifact, context) => {
    if (isTargeted(row) && targetedExecution) { await appendTargetResult(cell, row, context); return; }
    if (jobRoute(row) !== "legacy") {
      cell.append(element("span", "muted", isTargeted(row)
        ? "指定資源作品嘅檔案連結未接通" : "任務類型未確認，暫不提供檔案連結"));
      return;
    }
    if (!artifact || !state.client) {
      cell.append(element("span", "muted", row.status === "succeeded" ? "驗證結果未就緒" : "—"));
      return;
    }
    const result = await state.client.storage.from("comfy-outputs").createSignedUrl(artifact.storage_path, 600);
    if (!isCurrentJobs(context)) return;
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
      media.alt = "作品 " + shortId(row.id);
      media.loading = "lazy";
    }
    cell.append(media);
  };

  const readTargetedStatus = async (row, note, button, context) => {
    // Observation only: never turns a status read into enqueue, cancel or retry.
    if (!isCurrentJobs(context) || !isTargeted(row) || !targetedReadModel) return;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuid.test(row.id) || typeof row.idempotency_key !== "string" || !row.idempotency_key
      || row.idempotency_key.length > 128 || /[\x00-\x1f\x7f]/.test(row.idempotency_key)
      || typeof row.request_hash !== "string" || !/^[a-f0-9]{64}$/.test(row.request_hash)) {
      note.textContent = "原提交資料未齊，結果保持未知；唔會重複提交。";
      return;
    }
    button.disabled = true;
    note.textContent = "正核對原有提交…";
    let result, deadline;
    try {
      result = await Promise.race([
        state.client.functions.invoke("comfy-targeted", { body: {
          action: "request_status", payload: { idempotency_key: row.idempotency_key },
        } }),
        new Promise((resolve) => { deadline = window.setTimeout(() => resolve({ error: true }), 10000); }),
      ]);
    } catch { result = { error: true }; }
    finally { window.clearTimeout(deadline); }
    if (!isCurrentJobs(context)) return;
    button.disabled = false;
    const data = result && result.data;
    if (!result || result.error) {
      note.textContent = "暫時未能核對原提交；結果未知，唔會重複提交。";
    } else if (!data || Object.keys(data).sort().join(",") !== "action_allowed,job_id,job_status,request_hash"
      || data.job_id !== row.id || data.request_hash !== row.request_hash || data.action_allowed !== false
      || !["queued", "running", "cancel_requested", "reconciling", "verifying", "blocked", "succeeded", "failed", "canceled"].includes(data.job_status)) {
      note.textContent = "未有一致嘅提交記錄，結果保持未知；唔會重複提交。";
    } else {
      note.textContent = "原提交：" + statusLabel(data.job_status) + "；只核對狀態，未代表檔案已可查看。";
    }
  };

  const cancelJob = async (jobId, listContext) => {
    if (!state.client || !state.session || !state.readinessAuthorized) return;
    if (!isCurrentJobs(listContext)) return;
    const currentJob = state.jobs.find((row) => row.id === jobId);
    if (!currentJob || jobRoute(currentJob) !== "legacy") return;
    const context = sessionContext();
    if (!navigator.locks || typeof navigator.locks.request !== "function") {
      setNote(formNote, "未能安全防止重複取消；未有送出要求。", true);
      return;
    }
    let attempt;
    try {
      attempt = await navigator.locks.request("comfy:legacy-cancel:v1:" + project() + ":" + context.ownerId + ":" + jobId,
        { mode: "exclusive" }, () => {
          if (!isCurrentJobs(listContext)) return { claim: { kind: "stale" } };
          const claim = legacyCancelClaim(context.ownerId, jobId);
          if (claim.kind !== "valid" || claim.existing) return { claim };
          // PostgREST requests are thenable: invoke then while the lock is held,
          // before an auth refresh can invalidate this list's context.
          let resultPromise;
          try {
            const request = state.client.rpc("comfy_cancel_job", { p_job_id: jobId });
            resultPromise = new Promise((resolve) => {
              try { request.then(resolve, () => resolve({ error: true })); }
              catch { resolve({ error: true }); }
            });
          } catch {
            resultPromise = Promise.resolve({ error: true });
          }
          return { claim, resultPromise };
        });
    } catch {
      setNote(formNote, "未能安全防止重複取消；未有送出要求。", true);
      return;
    }
    const { claim, resultPromise } = attempt;
    if (!resultPromise && !isCurrentJobs(listContext)) return;
    if (claim.kind !== "valid" || claim.existing) {
      setNote(formNote, claim.kind === "invalid"
        ? "取消復原紀錄讀唔到；未有重送取消要求。"
        : "取消要求已經送出；只會重新讀取實際狀態。", true);
      return;
    }
    let result;
    try { result = await resultPromise; }
    catch { result = { error: true }; }
    if (!isCurrentReadiness(context)) return;
    const row = Array.isArray(result && result.data) && result.data.length === 1 ? result.data[0] : null;
    const acknowledged = !result.error && row && Object.keys(row).sort().join(",") === "cancel_requested,job_id,job_status"
      && row.job_id === jobId && row.cancel_requested === true
      && ["cancel_requested", "canceled"].includes(row.job_status);
    setNote(formNote, acknowledged
      ? "取消要求已記錄；畫面會重新讀取實際狀態。"
      : "取消結果未知；已保留原紀錄，只會核對狀態，唔會重送。", !acknowledged);
    await loadJobs(context, { supersede: true });
  };

  const isCurrentJobs = (context) => isCurrentReadiness(context) && context.jobsRequest === state.jobsRequest
    && (!context.jobsAbort || !context.jobsAbort.signal.aborted)
    && (!context.itemAbort || !context.itemAbort.signal.aborted);

  const renderJobs = (rows, context) => {
    const fragment = document.createDocumentFragment();
    const queued = rows.filter((row) => row.status === "queued").length;
    const active = rows.filter((row) => ["running", "cancel_requested", "reconciling", "verifying"].includes(row.status)).length;
    const hydrations = [];

    if (!rows.length) {
      const tr = element("tr");
      const td = tableCell("製作清單", "", "empty-cell");
      td.colSpan = 6;
      td.append(element("div", "empty", "未有作品。揀已開放嘅模型，就可以開始製作。"));
      tr.append(td);
      fragment.append(tr);
    }

    for (const row of rows.slice(0, 20)) {
      const tr = element("tr");
      tr.append(tableCell("編號", shortId(row.id), "id"));

      const mediaCell = tableCell("模型", "");
      mediaCell.append(element("strong", "row-title", row.kind === "video" ? "影片" : "圖片"));
      mediaCell.append(element("span", "row-subline", modelLabel(row.preset_id || row.model)));
      if (isTargeted(row)) mediaCell.append(element("span", "row-subline",
        "指定帳戶 · " + (["A100", "T4"].includes(row.requested_gpu_type) ? row.requested_gpu_type + " 偏好" : "GPU 未知")
        + "；實際分配另行確認"));
      tr.append(mediaCell);

      const stateCell = tableCell("狀態", "");
      stateCell.append(element("span", statusClass(row.status), statusLabel(row.status)));
      const detail = jobMessage(row);
      if (detail) stateCell.append(element("span", "row-subline", detail));
      tr.append(stateCell);

      tr.append(tableCell("建立時間", timeLabel(row.created_at), "time"));

      const resultCell = tableCell("結果", "");
      hydrations.push({ cell: resultCell, row, artifact: verifiedArtifact(row) });
      tr.append(resultCell);

      const actionCell = tableCell("操作", "", "row-action");
      if (jobRoute(row) === "unknown") {
        actionCell.append(element("span", "row-subline", "任務類型未確認；只供查看"));
      } else if (isTargeted(row)) {
        const note = element("p", "targeted-readback row-subline", "指定資源任務；只可核對原提交。");
        note.setAttribute("role", "status");
        const button = element("button", "link-button", "核對狀態");
        button.type = "button";
        button.addEventListener("click", () => readTargetedStatus(row, note, button, context));
        actionCell.append(button, note);
        if (targetedExecution && uuid(row.requested_account_id) && ["queued", "running", "reconciling", "verifying"].includes(row.status)) {
          const cancel = element("button", "link-button", "取消"); cancel.type = "button";
          cancel.disabled = !supportsTargetLock();
          if (cancel.disabled) note.textContent = targetLockUnavailable;
          cancel.addEventListener("click", async () => {
            if (!isCurrentJobs(context) || cancel.disabled) return;
            cancel.disabled = true;
            await withTargetLock(context, async () => {
              if (!isCurrentJobs(context)) return;
              // A lost cancel ACK is also read-only recovery, including after reload.
              const key = targetKey(context.ownerId) + ":cancel:" + row.id;
              try {
                if (localStorage.getItem(key) !== null) {
                  await readTargetedStatus(row, note, button, context); return;
                }
                const claim = JSON.stringify({ version: 1, project: project(), ownerId: context.ownerId,
                  route: targetRoute, jobId: row.id, requestHash: row.request_hash, action: "cancel" });
                localStorage.setItem(key, claim);
                if (localStorage.getItem(key) !== claim) throw Error("cancel claim");
              } catch { note.textContent = "未能保存取消紀錄；未有送出取消要求。"; return; }
              const result = await invokeTarget("cancel", { job_id: row.id });
              if (!isCurrentJobs(context)) return;
              note.textContent = result.error ? "取消結果未知；只會核對原狀態。" : "取消要求已記錄；正讀取實際狀態。";
              await readTargetedStatus(row, note, button, context);
            });
          });
          actionCell.append(cancel);
        }
      } else if (["queued", "running", "reconciling", "verifying"].includes(row.status)) {
        const cancelState = legacyCancelRead(context.ownerId, row.id);
        const button = element("button", "link-button", cancelState.kind === "absent" ? "取消" : "取消待核對");
        button.type = "button";
        button.disabled = cancelState.kind !== "absent";
        button.addEventListener("click", () => {
          button.disabled = true;
          cancelJob(row.id, context);
        });
        actionCell.append(button);
      } else {
        if (["blocked", "succeeded", "failed", "canceled"].includes(row.status)) legacyCancelClear(context.ownerId, row.id);
        actionCell.append(element("span", "muted", "—"));
      }
      tr.append(actionCell);
      fragment.append(tr);
    }
    if (!isCurrentJobs(context)) return null;
    state.jobs = rows;
    clearNode(jobsBody);
    jobsBody.append(fragment);
    const visibleBlobs = new Set(Array.from(jobsBody.querySelectorAll('img[src^="blob:"]'), image => image.src));
    for (const url of blobUrls) if (!visibleBlobs.has(url)) { URL.revokeObjectURL(url); blobUrls.delete(url); }
    queuedCount.textContent = String(queued);
    runningCount.textContent = String(active);
    activeJobCount.textContent = String(queued + active);
    latestResult.textContent = "未有";
    let nextHydration = 0;
    const hydrateWorker = async () => {
      while (isCurrentJobs(context)) {
        const item = hydrations[nextHydration++];
        if (!item) return;
        const itemAbort = new AbortController();
        const itemContext = { ...context, itemAbort };
        let itemDeadline;
        try {
          await Promise.race([
            appendResult(item.cell, item.row, item.artifact, itemContext),
            new Promise(resolve => { itemDeadline = window.setTimeout(() => {
              itemAbort.abort(); abortJobDownloads(itemAbort);
              if (isCurrentJobs(context)) item.cell.append(element("span", "muted", "結果連結未就緒"));
              resolve();
            }, 30000); }),
          ]);
        } catch {
          if (isCurrentJobs(itemContext)) item.cell.append(element("span", "muted", "結果連結未就緒"));
        } finally { window.clearTimeout(itemDeadline); }
      }
    };
    const workerCount = Math.min(2, hydrations.length);
    return Promise.allSettled(Array.from({ length: workerCount }, () => hydrateWorker())).then(() => {
      if (!isCurrentJobs(context)) return;
      const verifiedCount = hydrations.filter(({ cell }) => cell.querySelector("img, video")).length;
      latestResult.textContent = verifiedCount ? String(verifiedCount) + " 可開啟" : "未有";
    });
  };

  const loadJobs = (context = sessionContext(), options = {}) => {
    if (!state.client || !state.session || !state.readinessAuthorized || !isCurrentReadiness(context)) return Promise.resolve(false);
    const supersede = options.supersede === true;
    // Background polling coalesces with an active read/hydration so a slow but
    // valid media result cannot be invalidated every 15 seconds.  A user
    // refresh or a confirmed enqueue/cancel explicitly asks for a newer
    // snapshot and may supersede the older flight.  The request epoch in
    // isCurrentJobs keeps any late response from updating the current view.
    if (jobsFlight) {
      if (!supersede) return jobsFlight.result;
      jobsFlight.controller.abort();
      abortJobDownloads(jobsFlight.controller);
      if (jobsFlight.grace) window.clearTimeout(jobsFlight.grace);
      jobsFlight = null;
    }
    const controller = new AbortController();
    context = { ...context, jobsRequest: ++state.jobsRequest, jobsAbort: controller };
    const flight = { context, controller, hydration: null, result: null };
    jobsFlight = flight;
    flight.result = (async () => {
      const targetFields = targetedReadModel ? "requested_account_id,requested_gpu_type,target_account_id,idempotency_key,request_hash," : "";
      let result, readDeadline;
      try {
        result = await Promise.race([
          state.client.from("comfy_jobs")
            .select(targetFields + "id,kind,status,model,preset_id,preset_version,created_at,comfy_artifacts(id,storage_path,mime_type,verification_state,width,height,duration_seconds)")
            .order("created_at", { ascending: false }).limit(50),
          new Promise(resolve => { readDeadline = window.setTimeout(() => resolve({ error: true }), 10000); }),
        ]);
      } catch { result = { error: true }; }
      finally { window.clearTimeout(readDeadline); }
      if (!isCurrentJobs(context)) return false;
      if (result.error) {
        captureRefreshDraft();
        lockPrivateShell(safeError("jobs", result.error));
        return false;
      }
      const hydration = renderJobs(result.data || [], context);
      if (!hydration) return false;
      flight.hydration = hydration;
      // Each visible result already has its own 30-second bound in
      // renderJobs.  A second whole-list deadline is redundant and would
      // couple correctness to future row-count or worker-count changes.
      // Passive polling keeps coalescing with this flight; explicit refresh,
      // mutation, logout and auth-generation changes still abort it through
      // the shared controller/request epoch.
      hydration.finally(() => {
        if (jobsFlight === flight) jobsFlight = null;
      });
      return true;
    })().finally(() => {
      if (!flight.hydration && jobsFlight === flight) jobsFlight = null;
    });
    return flight.result;
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

  const modelLabel = (id) => ({
    "qwen-image-2512-t2i": "Qwen Image · 文字生圖",
    "wan2.1-t2v-1.3b": "Wan 2.1 · 文字生片",
    "wan2.2-ti2v-5b": "Wan 2.2 · 圖文生片",
  }[id] || id || "未知模型");
  const renderPresetFacts = (preset) => {
    clearNode(presetFacts);
    if (!preset) {
      presetFacts.append(element("span", "muted", "暫未有已開放模型。"));
      return;
    }
    const schema = preset.params_schema || {};
    const facts = [
      preset.media_kind === "video" ? "影片" : "圖片",
    ];
    if (schema.output_frames && schema.fps) {
      facts.push(String(schema.output_frames.default) + " 格 · 每秒 " + String(schema.fps.default) + " 格");
    }
    for (const fact of facts) presetFacts.append(element("span", "fact", fact));
  };

  const syncPresetControls = () => {
    syncInventorySelection();
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
    submitButton.disabled = state.pendingRecoveryBlocked || Boolean(state.selectedAccount) || Boolean(state.selectedGpu);
    renderPresetFacts(preset);
  };

  const renderPresetOptions = () => {
    clearNode(presetSelect);
    if (state.enabledPresets.length === 0) {
      const option = element("option", "", "暫未有已開放模型");
      option.value = "";
      presetSelect.append(option);
      presetSelect.disabled = true;
      submitButton.disabled = true;
      newJobButton.disabled = true;
      readinessNote.textContent = "暫未有已開放模型，未能開始製作。";
      releasedPresetCount.textContent = "0";
      syncPresetControls();
      return;
    }
    presetSelect.disabled = false;
    newJobButton.disabled = false;
    for (const preset of state.enabledPresets) {
      const option = element("option", "", modelLabel(preset.preset_id));
      option.value = preset.preset_id;
      presetSelect.append(option);
    }
    readinessNote.textContent = "已開放嘅模型會喺下方列出。";
    releasedPresetCount.textContent = String(state.enabledPresets.length);
    syncPresetControls();
  };

  const showReadinessChecking = () => {
    authCard.hidden = true;
    composeCard.hidden = true;
    signOutButton.hidden = false;
    newJobButton.disabled = true;
    setStatus("檢查授權", "neutral");
    headlineNote.textContent = "正確認登入權限，之後會顯示你嘅模型同作品。";
    readinessNote.textContent = "正核對帳戶授權；未通過前私人介面保持鎖住。";
    releasedPresetCount.textContent = "—";
    activeJobCount.textContent = "—";
    latestResult.textContent = "—";
  };

  const lockPrivateShell = (message) => {
    resetConsent();
    state.readinessAuthorized = false;
    resetInventory("授權未確認；帳戶資料已隱藏。");
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

  const restorePendingForm = (context, preserveDraft = false) => {
    if (!isCurrentReadiness(context)) return;
    const pendingState = readPendingRequestState(context.ownerId);
    if (pendingState.kind === "absent") return;
    if (pendingState.kind !== "valid") {
      blockPendingRecovery("上次提交嘅復原資料損壞或讀唔到；已保留紀錄，請先查看作品進度。");
      return;
    }
    const pending = pendingState.record;
    const request = pending.request;
    if (!state.enabledPresets.some((preset) => preset.preset_id === request.p_preset_id && preset.version === request.p_preset_version)) {
      blockPendingRecovery("上次提交嘅模型已唔可用；原紀錄已保留，暫時不能再提交。");
      return;
    }
    if (!preserveDraft) {
      presetSelect.value = request.p_preset_id;
      syncPresetControls();
      promptInput.value = String(request.p_params.prompt ?? "");
      widthInput.value = String(request.p_params.width ?? widthInput.value);
      heightInput.value = String(request.p_params.height ?? heightInput.value);
      seedInput.value = String(request.p_params.seed ?? seedInput.value);
    }
    setNote(formNote, "搵到上次未確認嘅提交；再用相同設定提交時會沿用原紀錄。", false);
  };

  const restoreRefreshDraft = (context) => {
    const draft = state.refreshDraft;
    if (!draft || !isCurrentReadiness(context)) return;
    if (!state.enabledPresets.some((preset) => preset.preset_id === draft.presetId)) return;
    presetSelect.value = draft.presetId;
    syncPresetControls();
    promptInput.value = draft.prompt;
    widthInput.value = draft.width;
    heightInput.value = draft.height;
    seedInput.value = draft.seed;
    return true;
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
    state.jobsRequest += 1;
    if (jobsFlight) {
      jobsFlight.controller.abort();
      if (jobsFlight.grace) window.clearTimeout(jobsFlight.grace);
    }
    jobsFlight = null;
    abortJobDownloads();
    blobUrls.forEach(url => URL.revokeObjectURL(url)); blobUrls.clear();
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
    resetConsent();
    resetInventory("登入後先讀取帳戶資料。", true);
    refreshAccounts.disabled = true;
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
    headlineNote.textContent = "揀已開放模型製作作品，喺下方查看進度同結果。";
  };

  const showSignedIn = async (context) => {
    showReadinessChecking();
    if (!await loadReadiness(context) || !isCurrentReadiness(context)) return;
    if (!await loadEnabledPresets(context) || !isCurrentReadiness(context)) return;
    if (state.enabledPresets.length !== state.readinessPresetCount) {
      lockPrivateShell("模型資料未能核對一致，暫時未能開始製作。");
      return;
    }
    const restoredDraft = restoreRefreshDraft(context);
    if (!await loadJobs(context) || !isCurrentReadiness(context)) return;
    state.refreshDraft = null;
    setSignedInView();
    if (isCurrentReadiness(context)) {
      restorePendingForm(context, restoredDraft);
      applyAccountHold();
      loadInventory(context);
      renderConsent();
      if (consentAllowed()) loadConsent();
      if (targetedExecution) {
        const old = targetRead(context.ownerId);
        if (!restoredDraft && old.kind === "valid") {
          state.selectedAccount = old.record.request.account_id; state.selectedGpu = old.record.request.gpu_type;
          if (old.record.draft) {
            promptInput.value = old.record.draft.prompt; widthInput.value = old.record.draft.width;
            heightInput.value = old.record.draft.height; seedInput.value = old.record.draft.seed;
          }
        }
        try {
          const raw = localStorage.getItem(targetKey(context.ownerId) + ":draft");
          if (raw !== null && !restoredDraft) {
            const d = JSON.parse(raw);
            if (d.version !== 2 || d.ownerId !== context.ownerId || d.project !== project()
              || !["presetId", "prompt", "width", "height", "seed", "account", "gpu"].every(k => typeof d[k] === "string")) throw Error("draft");
            if (state.enabledPresets.some(p => p.preset_id === d.presetId)) presetSelect.value = d.presetId;
            promptInput.value = d.prompt; widthInput.value = d.width; heightInput.value = d.height; seedInput.value = d.seed;
            state.selectedAccount = d.account; state.selectedGpu = d.gpu;
          }
        } catch { blockPendingRecovery("草稿復原資料讀唔到；已保留原文，暫停提交。"); return; }
        await reconcileTarget(context);
      }
    }
  };

  const resetReadinessData = () => {
    resetConsent();
    state.readinessAuthorized = false;
    resetInventory("重新核對授權中；帳戶資料已隱藏。");
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
    if (state.logoutLocked || authGeneration !== state.authGeneration) return;
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
    const bootstrapHash = window.location.hash || "";
    const bootstrapAttempt = bootstrapHash.startsWith("#bootstrap=");
    const bootstrapMatch = bootstrapAttempt
      ? bootstrapHash.match(/^#bootstrap=([A-Za-z0-9_-]+=*)$/)
      : null;
    const bootstrapValue = bootstrapMatch && bootstrapMatch[1].length <= 32768
      ? bootstrapMatch[1]
      : null;
    if (bootstrapAttempt) {
      // Remove owner tokens from the address bar before any async work. A
      // malformed or rejected one-time bootstrap remains failed closed.
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
    if (
      config.authRedirectUrl !== canonicalAuthRedirectUrl
      || !isValidSupabaseUrl(config.supabaseUrl)
      || !config.publishableKey
      || !isPublishableKey(config.publishableKey)
    ) {
      authSubmit.disabled = true;
      setStatus("未設定", "failed");
      headlineNote.textContent = "網站登入設定有問題，暫時未能登入或製作。";
      setNote(authNote, "需要先修正網站設定，請稍後再試。", true);
      return;
    }
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      authSubmit.disabled = true;
      setStatus("連線程式未載入", "failed");
      setNote(authNote, "登入元件未能載入；請稍後再試。", true);
      return;
    }
    state.client = window.supabase.createClient(config.supabaseUrl, config.publishableKey);
    let bootstrapSettled = !bootstrapAttempt;
    state.client.auth.onAuthStateChange((_event, nextSession) => {
      if (!bootstrapSettled || state.logoutLocked) return;
      resetConsent();
      state.authGeneration += 1;
      const authGeneration = state.authGeneration;
      window.setTimeout(() => handleSession(nextSession, authGeneration), 0);
    });
    if (bootstrapAttempt) {
      if (!bootstrapValue) {
        showSignedOut();
        setNote(authNote, "登入復原資料無效；請重新使用登入連結。", true);
        return;
      }
      try {
        const decoded = JSON.parse(window.atob(
          bootstrapValue.replace(/-/g, "+").replace(/_/g, "/"),
        ));
        if (
          decoded
          && typeof decoded.access_token === "string"
          && decoded.access_token.length > 0
          && typeof decoded.refresh_token === "string"
          && decoded.refresh_token.length > 0
        ) {
          const setResult = await state.client.auth.setSession({
            access_token: decoded.access_token,
            refresh_token: decoded.refresh_token,
          });
          if (setResult.error) {
            console.error("Yinops Render bootstrap setSession failed");
            showSignedOut();
            setNote(authNote, "登入復原未能確認；請重新使用登入連結。", true);
            return;
          }
        } else {
          showSignedOut();
          setNote(authNote, "登入復原資料無效；請重新使用登入連結。", true);
          return;
        }
      } catch {
        console.error("Yinops Render bootstrap parse failed");
        showSignedOut();
        setNote(authNote, "登入復原資料無效；請重新使用登入連結。", true);
        return;
      }
      bootstrapSettled = true;
    }
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

  const draftSnapshot = () => JSON.stringify([
    presetSelect.value, promptInput.value, widthInput.value, heightInput.value, seedInput.value,
    state.selectedAccount, state.selectedGpu,
  ]);
  const saveTargetDraft = () => {
    state.draftRevision += 1;
    if (!targetedExecution || !sessionOwner()) return;
    const value = { version: 2, ownerId: sessionOwner(), project: project(), presetId: presetSelect.value,
      prompt: promptInput.value, width: widthInput.value, height: heightInput.value, seed: seedInput.value,
      account: state.selectedAccount, gpu: state.selectedGpu };
    try {
      const key = targetKey(sessionOwner()) + ":draft", raw = JSON.stringify(value);
      localStorage.setItem(key, raw);
      if (localStorage.getItem(key) !== raw) throw Error("draft readback");
    }
    catch { blockPendingRecovery("未能保存草稿；暫停提交，文字仍保留喺畫面。"); }
  };
  jobForm.addEventListener("input", saveTargetDraft);
  jobForm.addEventListener("change", saveTargetDraft);

  jobForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.client || !state.session || !state.readinessAuthorized) {
      setNote(formNote, "請先登入。", true);
      return;
    }
    if (targetedExecution || state.selectedAccount || state.selectedGpu) {
      if (targetedExecution) await submitTarget();
      else { applyAccountHold(); setNote(formNote, accountHold, true); }
      return;
    }
    if (targetedExecution && targetRead(sessionOwner()).kind !== "absent") {
      await reconcileTarget(sessionContext()); return;
    }
    const request = currentRequest();
    if (!request || state.enabledPresets.length === 0) {
      submitButton.disabled = true;
      setNote(formNote, "暫未有已開放模型，未能開始製作。", true);
      return;
    }
    const context = sessionContext();
    const signature = requestSignature(request);
    const pendingState = readPendingRequestState(context.ownerId);
    if (pendingState.kind === "invalid") {
      blockPendingRecovery("上次提交嘅復原資料損壞或讀唔到；暫停提交，避免重複製作。");
      return;
    }
    const pending = pendingState.kind === "valid" ? pendingState.record : null;
    if (pending && pending.requestSignature !== signature) {
      blockPendingRecovery("仲有一次提交未確認；已保留原紀錄，請先查看作品進度，唔會重複提交。");
      return;
    }
    const idempotencyKey = pending ? pending.idempotencyKey : crypto.randomUUID();
    const rpcArgs = Object.assign({ p_idempotency_key: idempotencyKey }, request);
    if (!writePendingRequest(context.ownerId, { idempotencyKey, requestSignature: signature, request })) {
      blockPendingRecovery("未能保存提交嘅復原資料；暫停提交，避免重複製作。");
      return;
    }
    const requestId = ++state.enqueueRequest;
    const submittedDraft = draftSnapshot();
    const draftRevision = state.draftRevision;
    submitButton.disabled = true;
    setNote(formNote, "正安全落單…", false);
    const result = await state.client.rpc("comfy_enqueue", rpcArgs);
    if (!isCurrentReadiness(context) || requestId !== state.enqueueRequest) {
      if (!result.error) clearPendingRequest(context.ownerId, idempotencyKey);
      return;
    }
    if (result.error) {
      submitButton.disabled = Boolean(state.selectedAccount);
      setNote(formNote, safeError("enqueue", result.error), true);
      return;
    }
    if (clearPendingRequest(context.ownerId, idempotencyKey) !== "cleared") {
      blockPendingRecovery("已收到製作回覆，但復原紀錄未能清除；請先查看作品進度，暫時不能再提交。");
      return;
    }
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    setNote(formNote, "已加入製作清單 · " + shortId(row && row.job_id) + "；可以喺作品進度查看有冇開始。", false);
    if (state.draftRevision === draftRevision && draftSnapshot() === submittedDraft) {
      jobForm.reset();
      syncPresetControls();
    } else {
      // Newer human input belongs to the current form, not to this completion.
      submitButton.disabled = state.pendingRecoveryBlocked || Boolean(state.selectedAccount)
        || Boolean(state.selectedGpu) || !state.enabledPresets.length;
    }
    await loadJobs(context, { supersede: true });
  });

  presetSelect.addEventListener("change", syncPresetControls);
  refreshAccounts.addEventListener("click", () => loadInventory());
  accountSelect.addEventListener("change", () => {
    state.selectedAccount = accountSelect.value;
    state.selectedGpu = "";
    submitButton.disabled = Boolean(state.selectedAccount) || state.pendingRecoveryBlocked || !state.readinessAuthorized || !state.enabledPresets.length;
    applyAccountHold();
    renderInventory();
    saveTargetDraft();
  });
  gpuSelect.addEventListener("change", () => {
    state.selectedGpu = ["A100", "T4"].includes(gpuSelect.value) ? gpuSelect.value : "";
    applyAccountHold();
    saveTargetDraft();
  });
  window.setInterval(() => { renderInventory(); applyAccountHold(); }, 1000);
  signOutButton.addEventListener("click", async () => {
    if (!state.client) return;
    signOutButton.disabled = true;
    captureRefreshDraft();
    state.logoutLocked = true;
    state.authGeneration += 1;
    resetReadinessData();
    lockPrivateShell("正登出，私人資料已隱藏。");
    let result;
    try { result = await state.client.auth.signOut(); }
    catch { result = { error: true }; }
    signOutButton.disabled = false;
    if (!result || result.error) {
      lockPrivateShell("未能確認登出，私人資料保持鎖住；可以再按登出。");
      return;
    }
    state.authGeneration += 1;
    state.sessionEpoch += 1;
    state.session = null;
    state.logoutLocked = false;
    showSignedOut();
  });
  refreshButton.addEventListener("click", async () => {
    const context = sessionContext();
    await reconcileTarget(context);
    await loadJobs(context, { supersede: true });
  });
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
    if (!document.hidden && state.session && state.readinessAuthorized) { renderInventory(); loadJobs(); }
  });
  window.setInterval(() => {
    if (state.session && state.readinessAuthorized) loadJobs();
  }, 15000);

  showSignedOut();
  init();
})();
