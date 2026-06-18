(function () {
  const CONFIG = window.PINGRADAR_CONFIG || {};
  const WORKER_URL = (CONFIG.WORKER_URL || "").replace(/\/$/, "");
  const SITE_KEY = CONFIG.TURNSTILE_SITE_KEY || "";

  const state = {
    domain: "",
    key: "",
    verified: false,
    widgetOwn: null,
    widgetBacklink: null,
    tokenOwn: "",
    tokenBacklink: "",
  };

  // ---------- project id (local-only identity, no account) ----------
  function getProjectId() {
    let id = localStorage.getItem("pingradar_project_id");
    if (!id) {
      id = "p" + Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      localStorage.setItem("pingradar_project_id", id);
    }
    return id;
  }

  async function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ "Content-Type": "application/json", "X-Project-Id": getProjectId() }, opts.headers || {});
    const res = await fetch(WORKER_URL + path, opts);
    let data;
    try { data = await res.json(); } catch (e) { data = {}; }
    return { status: res.status, ok: res.ok, data };
  }

  // ---------- key generation ----------
  function genKey() {
    return Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  const domainInput = document.getElementById("domain-input");
  const keyDisplay = document.getElementById("key-display");
  const keyInstruction = document.getElementById("key-instruction");
  const genKeyBtn = document.getElementById("gen-key-btn");
  const copyKeyBtn = document.getElementById("copy-key-btn");
  const verifyBtn = document.getElementById("verify-btn");
  const verifyStatus = document.getElementById("verify-status");

  genKeyBtn.addEventListener("click", () => {
    state.key = genKey();
    keyDisplay.textContent = state.key;
    const domain = domainInput.value.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    keyInstruction.innerHTML = domain
      ? `Create a file named <strong>${state.key}.txt</strong> containing just the key, and upload it to your site root so it's reachable at <code>https://${domain}/${state.key}.txt</code>.`
      : `Create a file named <strong>${state.key}.txt</strong> containing just the key, and upload it to your site's root directory.`;
    setVerifyStatus("pending", "Key generated — upload the file, then verify");
  });

  copyKeyBtn.addEventListener("click", async () => {
    if (!state.key) return;
    await navigator.clipboard.writeText(state.key);
    copyKeyBtn.textContent = "copied";
    setTimeout(() => (copyKeyBtn.textContent = "copy"), 1200);
  });

  function setVerifyStatus(kind, text) {
    const dot = verifyStatus.querySelector(".status-dot");
    dot.className = "status-dot " + (kind === "ok" ? "ok" : kind === "bad" ? "bad" : kind === "pending" ? "pending" : "");
    verifyStatus.querySelector("span:last-child").textContent = text;
  }

  verifyBtn.addEventListener("click", async () => {
    const domain = domainInput.value.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!domain || !state.key) {
      setVerifyStatus("bad", "Enter a domain and generate a key first");
      return;
    }
    setVerifyStatus("pending", "Checking " + domain + "/" + state.key + ".txt …");
    const { data } = await api("/api/verify", { method: "POST", body: JSON.stringify({ domain, key: state.key }) });
    if (data.verified) {
      state.domain = domain;
      state.verified = true;
      setVerifyStatus("ok", "Verified — you can submit URLs on this domain");
    } else {
      state.verified = false;
      setVerifyStatus("bad", "Not verified yet (" + (data.error || "unknown") + ") — file not found or mismatched");
    }
  });

  // ---------- tabs ----------
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById("panel-" + tab.dataset.tab).classList.add("active");
    });
  });

  // ---------- turnstile (explicit render, poll until script is ready) ----------
  function whenTurnstileReady(cb) {
    if (window.turnstile) cb();
    else setTimeout(() => whenTurnstileReady(cb), 200);
  }

  if (SITE_KEY) {
    whenTurnstileReady(() => {
      state.widgetOwn = window.turnstile.render("#turnstile-own", {
        sitekey: SITE_KEY,
        callback: (t) => (state.tokenOwn = t),
      });
      state.widgetBacklink = window.turnstile.render("#turnstile-backlink", {
        sitekey: SITE_KEY,
        callback: (t) => (state.tokenBacklink = t),
      });
    });
  }

  // ---------- own-site submission ----------
  const ENGINE_IDS = ["bing", "yandex", "naver", "seznam", "yep"];

  function lightEngines(success) {
    ENGINE_IDS.forEach((id) => {
      const el = document.getElementById("engine-" + id);
      const node = document.getElementById("node-" + id);
      el.classList.remove("lit", "failed");
      if (node) node.querySelector("circle").setAttribute("stroke", success ? "#39ffc4" : "#ff5c72");
      el.classList.add(success ? "lit" : "failed");
    });
  }

  function buildGscLinks(domain, urls) {
    const list = document.getElementById("gsc-list");
    list.innerHTML = "";
    const resourceId = encodeURIComponent("sc-domain:" + domain);
    urls.forEach((u) => {
      const a = document.createElement("a");
      a.href = `https://search.google.com/search-console/inspect?resource_id=${resourceId}&id=${encodeURIComponent(u)}`;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = "Request indexing → " + u;
      list.appendChild(a);
    });
    document.getElementById("gsc-section").style.display = urls.length ? "block" : "none";
  }

  const submitOwnBtn = document.getElementById("submit-own-btn");
  submitOwnBtn.addEventListener("click", async () => {
    if (!state.verified) {
      alert("Verify domain ownership first (Step 1).");
      return;
    }
    const urls = document.getElementById("own-urls").value.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!urls.length) return;
    if (SITE_KEY && !state.tokenOwn) {
      alert("Complete the verification checkbox first.");
      return;
    }
    submitOwnBtn.disabled = true;
    submitOwnBtn.textContent = "Pinging…";
    const { data } = await api("/api/submit", {
      method: "POST",
      body: JSON.stringify({ domain: state.domain, key: state.key, urls, token: state.tokenOwn }),
    });
    submitOwnBtn.disabled = false;
    submitOwnBtn.textContent = "Push to IndexNow";

    if (data.ok) {
      lightEngines(true);
      buildGscLinks(state.domain, urls);
    } else {
      lightEngines(false);
      alert("Submission failed: " + (data.error || "unknown error"));
    }
    if (window.turnstile && state.widgetOwn) window.turnstile.reset(state.widgetOwn);
    state.tokenOwn = "";
    loadHistory();
  });

  // ---------- backlink discovery submission ----------
  const submitBacklinkBtn = document.getElementById("submit-backlink-btn");
  submitBacklinkBtn.addEventListener("click", async () => {
    const urls = document.getElementById("backlink-urls").value.split("\n").map((s) => s.trim()).filter(Boolean);
    const title = document.getElementById("backlink-title").value.trim();
    const resultEl = document.getElementById("backlink-result");
    if (!urls.length) return;
    if (SITE_KEY && !state.tokenBacklink) {
      alert("Complete the verification checkbox first.");
      return;
    }
    submitBacklinkBtn.disabled = true;
    submitBacklinkBtn.textContent = "Creating page…";
    const { data } = await api("/api/discover", {
      method: "POST",
      body: JSON.stringify({ urls, title, token: state.tokenBacklink }),
    });
    submitBacklinkBtn.disabled = false;
    submitBacklinkBtn.textContent = "Create discovery page";

    if (data.ok) {
      resultEl.innerHTML = `Created: <a href="${data.pageUrl}" target="_blank" rel="noopener">${data.pageUrl}</a> (${data.included} URLs linked)`;
    } else {
      resultEl.textContent = "Failed: " + (data.error || "unknown error");
    }
    if (window.turnstile && state.widgetBacklink) window.turnstile.reset(state.widgetBacklink);
    state.tokenBacklink = "";
    loadHistory();
  });

  // ---------- history / log feed ----------
  async function loadHistory() {
    const feed = document.getElementById("log-feed");
    try {
      const { data } = await api("/api/history?projectId=" + getProjectId(), { method: "GET" });
      const items = data.items || [];
      if (!items.length) {
        feed.innerHTML = '<div class="empty-state">Nothing submitted yet from this browser.</div>';
        return;
      }
      feed.innerHTML = items
        .map((it) => {
          const time = new Date(it.ts).toLocaleString();
          const label =
            it.type === "indexnow_submit"
              ? `IndexNow → ${it.domain} (${it.count} URLs, HTTP ${it.status})`
              : `Discovery page → ${it.pageUrl} (${it.count} URLs)`;
          return `<div class="log-row"><span class="log-time">${time}</span><span class="log-tag">${it.type}</span><span>${label}</span></div>`;
        })
        .join("");
    } catch (e) {
      feed.innerHTML = '<div class="empty-state">Could not load history.</div>';
    }
  }

  loadHistory();
})();
