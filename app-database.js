(function () {
  "use strict";

  const DB_NAME = "codex-ios-app-database";
  const DB_VERSION = 1;
  const LIMIT = 1000;
  const STORES = ["users", "questions", "messages", "emails"];
  const API_BASE = window.APP_API_BASE
    || localStorage.getItem("APP_API_BASE")
    || (location.protocol.startsWith("http") ? location.origin : "http://127.0.0.1:3000");

  function appId() {
    const file = location.pathname.split("/").pop() || "unknown-app";
    return file.replace(/\.html$/i, "");
  }

  function now() {
    return new Date().toISOString();
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("IndexedDB is not supported"));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        STORES.forEach(storeName => {
          if (!db.objectStoreNames.contains(storeName)) {
            const store = db.createObjectStore(storeName, { keyPath: "id", autoIncrement: true });
            store.createIndex("timestamp", "timestamp");
            store.createIndex("app", "app");
          }
        });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  let dbPromise = openDb().catch(error => {
    console.warn("[AppDB] database unavailable", error);
    return null;
  });

  async function withStore(storeName, mode, callback) {
    const db = await dbPromise;
    if (!db) return null;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      result = callback(store);
    });
  }

  async function prune(storeName) {
    const db = await dbPromise;
    if (!db) return;
    const records = await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, "readonly");
      const request = tx.objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    if (records.length <= LIMIT) return;
    records
      .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
      .slice(LIMIT)
      .forEach(record => {
        withStore(storeName, "readwrite", store => store.delete(record.id));
      });
  }

  async function save(storeName, data) {
    const payload = {
      ...data,
      app: data.app || appId(),
      timestamp: data.timestamp || now()
    };
    await withStore(storeName, "readwrite", store => store.add(payload));
    prune(storeName);
    syncRemote(storeName, payload);
    if (storeName === "users") membershipEntitlement(payload);
    return payload;
  }

  async function syncRemote(storeName, payload) {
    try {
      await fetch(`${API_BASE}/api/records`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: storeName,
          app: payload.app,
          timestamp: payload.timestamp,
          payload
        })
      });
    } catch (error) {
      const queue = JSON.parse(localStorage.getItem("APP_DB_SYNC_QUEUE") || "[]");
      queue.push({ type: storeName, payload, queuedAt: now() });
      localStorage.setItem("APP_DB_SYNC_QUEUE", JSON.stringify(queue.slice(-LIMIT)));
    }
  }

  async function flushQueue() {
    const queue = JSON.parse(localStorage.getItem("APP_DB_SYNC_QUEUE") || "[]");
    if (!queue.length) return;
    const remaining = [];
    for (const item of queue) {
      try {
        await fetch(`${API_BASE}/api/records`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: item.type,
            app: item.payload.app || appId(),
            timestamp: item.payload.timestamp || item.queuedAt || now(),
            payload: item.payload
          })
        });
      } catch {
        remaining.push(item);
      }
    }
    localStorage.setItem("APP_DB_SYNC_QUEUE", JSON.stringify(remaining.slice(-LIMIT)));
  }

  async function membershipEntitlement(identity) {
    const payload = {
      name: text(identity?.name),
      phone: text(identity?.phone),
      email: text(identity?.email),
      app: identity?.app || appId()
    };
    if (!payload.name || !payload.phone || !payload.email) {
      return { matched: false, reason: "missing_identity" };
    }
    try {
      const response = await fetch(`${API_BASE}/api/membership-entitlement`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || "membership lookup failed");
      const entitlement = result.entitlement || { matched: false };
      localStorage.setItem("CROVANTIX_MEMBERSHIP_ENTITLEMENT", JSON.stringify({
        ...entitlement,
        checkedAt: now(),
        app: payload.app
      }));
      if (entitlement.matched) {
        applyGenericEntitlement(entitlement);
        window.dispatchEvent(new CustomEvent("crovantix-membership-entitlement", {
          detail: entitlement
        }));
      }
      return entitlement;
    } catch (error) {
      console.warn("[AppDB] membership entitlement unavailable", error);
      return { matched: false, reason: "network_unavailable" };
    }
  }

  function applyGenericEntitlement(entitlement) {
    const label = entitlement.memberType || entitlement.planLevel || entitlement.subscription?.plan || "";
    if (!label) return;
    const planTargets = [
      document.querySelector("#profilePlan"),
      document.querySelector("#planSummary")
    ].filter(Boolean);
    planTargets.forEach(target => {
      if ("value" in target) target.value = label;
      else target.textContent = label;
    });
    document.body.dataset.crovantixMembership = entitlement.planLevel || label;
  }

  function text(value) {
    return String(value || "").trim();
  }

  function labelText(input) {
    const label = input.closest("label");
    if (!label) return "";
    return [...label.childNodes]
      .filter(node => node.nodeType === Node.TEXT_NODE)
      .map(node => node.textContent)
      .join("")
      .trim();
  }

  function activeContainer(element) {
    return element.closest(".page.active, .content.page.active, section, form, .card, .request-card, .settings-card") || document;
  }

  function collectFields(container) {
    const fields = {};
    container.querySelectorAll("input, textarea, select").forEach(input => {
      if (input.type === "password" || input.type === "file" || input.type === "hidden") return;
      const key = input.id || input.name || labelText(input);
      const value = text(input.value);
      if (key && value) fields[key] = value;
    });
    return fields;
  }

  function userSnapshot(container = document) {
    const fields = collectFields(container);
    const allFields = { ...collectFields(document), ...fields };
    const pick = patterns => {
      const entry = Object.entries(allFields).find(([key]) => patterns.some(pattern => pattern.test(key)));
      return entry ? entry[1] : "";
    };
    return {
      name: pick([/name/i, /姓名/, /暱稱/, /使用者/]),
      phone: pick([/phone/i, /tel/i, /電話/, /手機/]),
      email: pick([/email/i, /mail/i, /信箱/]),
      gender: pick([/gender/i, /性別/]),
      age: pick([/age/i, /年齡/]),
      plan: text(document.querySelector("#profilePlan")?.value || document.querySelector("#profilePlan")?.textContent || ""),
      credits: text(document.querySelector("#profileCredits")?.value || document.querySelector("#profileCredits")?.textContent || ""),
      fields: allFields
    };
  }

  function meaningfulText(container) {
    const values = [...container.querySelectorAll("textarea, input")]
      .filter(input => !["button", "submit", "file", "hidden", "password"].includes(input.type))
      .map(input => text(input.value))
      .filter(value => value.length >= 2);
    return values.sort((a, b) => b.length - a.length)[0] || "";
  }

  function saveUser(container) {
    const snapshot = userSnapshot(container);
    if (!snapshot.name && !snapshot.phone && !snapshot.email) return;
    save("users", snapshot);
  }

  function saveQuestion(container, source) {
    const question = meaningfulText(container);
    if (!question) return;
    save("questions", {
      question,
      source,
      user: userSnapshot(container)
    });
  }

  function saveMessage(container, source) {
    const message = meaningfulText(container);
    if (!message) return;
    save("messages", {
      message,
      source,
      user: userSnapshot(container)
    });
  }

  function saveEmail(container, source) {
    const fields = collectFields(container);
    const emailValues = Object.entries(fields).filter(([key, value]) => /email|mail|信箱/i.test(key) || /@/.test(value));
    const body = meaningfulText(container);
    if (!emailValues.length && !body) return;
    save("emails", {
      source,
      to: emailValues.map(([, value]) => value).join(", "),
      subject: text(fields.subject || fields.emailSubject || fields["主旨"] || ""),
      body,
      fields,
      user: userSnapshot(container)
    });
  }

  function buttonText(button) {
    return text(button.textContent || button.getAttribute("aria-label") || button.title);
  }

  function classifyClick(button) {
    if (button.closest("#crovantixNewRequestPage")) return;
    const label = buttonText(button);
    const id = `${button.id || ""} ${button.className || ""} ${button.dataset.page || ""}`;
    const haystack = `${label} ${id}`;
    const container = activeContainer(button);

    if (/完成註冊|儲存|save|profile|register|註冊/i.test(haystack)) saveUser(container);
    if (/詢問|送出分析|啟動試算|產生題庫|解題|ask|analy|solve|generate/i.test(haystack)) saveQuestion(container, label);
    if (/留言|洽談|聯繫|諮詢|送出需求|送出|message|contact|request/i.test(haystack)) saveMessage(container, label);
    const hasEmailField = [...container.querySelectorAll("input, textarea")].some(input => /email|mail|信箱/i.test(input.id || input.name || labelText(input)));
    if (/email|mail|寫信|郵件|信箱/i.test(haystack) || hasEmailField) saveEmail(container, label);
  }

  function observeAssistantQuestions() {
    document.addEventListener("click", event => {
      const button = event.target.closest("button");
      if (button) classifyClick(button);
    }, true);

    document.addEventListener("change", event => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement)) return;
      const container = activeContainer(target);
      const key = `${target.id || ""} ${target.name || ""} ${labelText(target)}`;
      if (/name|phone|email|gender|age|姓名|電話|信箱|性別|年齡|暱稱/i.test(key)) saveUser(container);
    }, true);
  }

  function injectNewRequestFeature() {
    if (document.body && document.body.dataset.crovantixDisableSharedTabs === "true") return;
    const hasNativeRequest = Boolean(document.querySelector("#requestPage"));
    const hasInjectedRequest = Boolean(document.querySelector("#crovantixNewRequestPage"));
    const hasIssueReport = Boolean(document.querySelector("#crovantixIssueReportPage"));
    if ((hasNativeRequest || hasInjectedRequest) && hasIssueReport) return;
    const host = document.querySelector(".screen") || document.querySelector(".phone") || document.querySelector(".app") || document.body;
    const bottomNav = document.querySelector(".tabbar")
      || [...document.querySelectorAll("nav, .nav, .bottom-nav, .bottom-bar")]
        .find(element => element.querySelector("button"));
    if (!document.querySelector("#crovantixRequestSharedStyle")) {
      const style = document.createElement("style");
      style.id = "crovantixRequestSharedStyle";
      style.textContent = `
      .crovantix-enhanced-tabbar {
        display: grid !important;
        grid-auto-flow: column;
        grid-auto-columns: minmax(0, 1fr);
        flex-wrap: nowrap !important;
        overflow: hidden;
      }
      .crovantix-enhanced-tabbar[hidden] {
        display: grid !important;
      }
      .crovantix-enhanced-tabbar > button {
        display: grid !important;
        place-items: center;
        align-content: center;
        gap: 2px;
        min-width: 0 !important;
        max-width: 100%;
        white-space: nowrap !important;
        overflow: hidden;
      }
      .crovantix-enhanced-tabbar > button .nav-symbol {
        display: grid;
        place-items: center;
        width: 20px;
        height: 20px;
        line-height: 1;
        font-size: 15px;
      }
      .crovantix-enhanced-tabbar > button .nav-label,
      .crovantix-enhanced-tabbar > button span:not(.nav-symbol) {
        max-width: 100%;
        white-space: nowrap !important;
        overflow: hidden;
        text-overflow: ellipsis;
        font-size: min(11px, 2.55vw);
      }
      .crovantix-registration-toast {
        position: absolute;
        left: 18px;
        right: 18px;
        bottom: 78px;
        z-index: 9997;
        display: none;
        min-height: 42px;
        place-items: center;
        border: 1px solid rgba(85,215,255,.42);
        border-radius: 12px;
        color: #06111b;
        background: #55d7ff;
        box-shadow: 0 14px 32px rgba(0,0,0,.28);
        font: 900 14px -apple-system, BlinkMacSystemFont, "Noto Sans TC", "Segoe UI", sans-serif;
      }
      .crovantix-registration-toast.show {
        display: grid;
      }
      .crovantix-request-entry.crovantix-request-fallback {
        position: absolute;
        left: 18px;
        right: 18px;
        bottom: 74px;
        z-index: 9998;
        min-height: 46px;
        border: 0;
        border-radius: 12px;
        padding: 0 16px;
        color: #06111b;
        background: #55d7ff;
        box-shadow: 0 12px 28px rgba(0,0,0,.28);
        font: 900 14px -apple-system, BlinkMacSystemFont, "Noto Sans TC", "Segoe UI", sans-serif;
      }
      .crovantix-request-page {
        position: absolute;
        inset: 0;
        z-index: 9999;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 20px;
        background: rgba(3,7,12,.72);
        backdrop-filter: blur(12px);
      }
      .crovantix-request-page.show { display: flex; }
      .crovantix-request-panel {
        width: min(440px, 100%);
        max-height: min(760px, calc(100vh - 36px));
        overflow: auto;
        display: grid;
        gap: 12px;
        border: 1px solid rgba(255,255,255,.14);
        border-radius: 16px;
        padding: 18px;
        color: #f7fbff;
        background: #101722;
        box-shadow: 0 22px 70px rgba(0,0,0,.42);
      }
      .crovantix-request-panel h2 {
        margin: 0;
        font-size: 24px;
        letter-spacing: 0;
      }
      .crovantix-request-panel p {
        margin: 0;
        color: #a9b7c7;
        line-height: 1.55;
        font-size: 13px;
      }
      .crovantix-request-panel label {
        display: grid;
        gap: 6px;
        color: #c9d7e8;
        font-size: 13px;
        font-weight: 850;
      }
      .crovantix-request-panel input,
      .crovantix-request-panel textarea {
        width: 100%;
        border: 1px solid rgba(255,255,255,.14);
        border-radius: 10px;
        padding: 12px;
        color: #f7fbff;
        background: #0b121b;
        font: inherit;
      }
      .crovantix-request-panel textarea {
        min-height: 128px;
        resize: vertical;
        line-height: 1.5;
      }
      .crovantix-request-actions {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 10px;
      }
      .crovantix-request-actions button {
        min-height: 46px;
        border: 1px solid rgba(255,255,255,.14);
        border-radius: 10px;
        color: #f7fbff;
        background: rgba(255,255,255,.08);
        font-weight: 900;
      }
      .crovantix-request-actions button.primary {
        color: #06111b;
        border-color: transparent;
        background: #55d7ff;
      }
      .crovantix-request-status {
        min-height: 20px;
        color: #73f0bc !important;
        font-weight: 850;
      }
    `;
      document.head.appendChild(style);
    }

    const pages = [];
    let previousActiveButton = null;
    let registerToastTimer = null;

    function navHtml(symbol, label) {
      return `<span class="nav-symbol">${symbol}</span><span class="nav-label">${label}</span>`;
    }

    function enhanceBottomNav() {
      if (!bottomNav) return;
      bottomNav.classList.add("crovantix-enhanced-tabbar");
      iconizeBottomNav();
      bottomNav.style.gridTemplateColumns = `repeat(${bottomNav.children.length}, minmax(0, 1fr))`;
    }

    function iconForButton(button, label) {
      const page = button.dataset.page || "";
      const haystack = `${label} ${page}`;
      if (/新需求|request/i.test(haystack)) return "＋";
      if (/問題回報|回報|issue|report/i.test(haystack)) return "!";
      if (/設定|settings/i.test(haystack)) return "⚙";
      if (/升級|方案|點數|plan|upgrade|points/i.test(haystack)) return "◇";
      if (/收藏|favorite/i.test(haystack)) return "♡";
      if (/紀錄|history|record/i.test(haystack)) return "▣";
      if (/個人|帳戶|profile|account|user/i.test(haystack)) return "⌾";
      if (/專業|律師|諮詢|consult|lawyer/i.test(haystack)) return "§";
      if (/分析|算命|題庫|發文|首頁|home|main|practice|edit/i.test(haystack)) return "⌁";
      if (/補習班|school|tutor/i.test(haystack)) return "⌂";
      if (/買|市場|market|buy/i.test(haystack)) return "▥";
      if (/賣|sell/i.test(haystack)) return "+";
      return "•";
    }

    function iconizeBottomNav() {
      if (!bottomNav) return;
      [...bottomNav.querySelectorAll("button")].forEach(button => {
        const existingSymbol = button.querySelector(".nav-symbol");
        const existingLabel = button.querySelector(".nav-label");
        const textNodes = [...button.childNodes].filter(node => node.nodeType === Node.TEXT_NODE && text(node.textContent));
        if (existingSymbol && existingLabel) return;
        const label = existingLabel?.textContent.trim()
          || textNodes.map(node => text(node.textContent)).join("")
          || text(button.textContent).replace(text(existingSymbol?.textContent), "").trim()
          || text(button.getAttribute("aria-label") || button.dataset.page || "功能");
        const symbol = text(existingSymbol?.textContent) || iconForButton(button, label);
        button.innerHTML = `<span class="nav-symbol">${symbol}</span><span class="nav-label">${label}</span>`;
      });
    }

    function activePageId() {
      return document.querySelector(".page.active, .content.page.active")?.id || "";
    }

    function isVisible(element) {
      if (!element) return false;
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
    }

    function registrationLocked() {
      if (document.querySelector(".screen.locked")) return true;
      const pageId = activePageId();
      if (/^(login|register)/i.test(pageId)) return true;
      const registrationPanel = document.querySelector(".registration, #registerPage, #loginPage");
      if (isVisible(registrationPanel)) return true;
      const userText = text(document.querySelector("#userButton")?.textContent
        || document.querySelector("#userNameButton")?.textContent
        || document.querySelector("#profileButton")?.textContent
        || document.querySelector(".user-pill")?.textContent
        || "");
      return /尚未註冊|未註冊|未登入|首次使用/i.test(userText);
    }

    function showRegistrationRequired() {
      const status = document.querySelector("#appStatus")
        || document.querySelector("#pageStatus")
        || document.querySelector("#registerStatus");
      if (status) status.textContent = "請先完成註冊";
      let toast = host.querySelector(".crovantix-registration-toast");
      if (!toast) {
        toast = document.createElement("div");
        toast.className = "crovantix-registration-toast";
        toast.textContent = "請先完成註冊";
        host.appendChild(toast);
      }
      toast.classList.add("show");
      clearTimeout(registerToastTimer);
      registerToastTimer = setTimeout(() => toast.classList.remove("show"), 1800);
    }

    function restoreActive(entry) {
      entry.classList.remove("active");
      previousActiveButton?.classList.add("active");
    }

    function addFeature(config) {
      if (document.querySelector(`#${config.pageId}`)) return;
      const entry = document.createElement("button");
      entry.className = "crovantix-request-entry";
      entry.type = "button";
      entry.innerHTML = navHtml(config.symbol, config.navLabel);
      if (bottomNav) {
        bottomNav.appendChild(entry);
        enhanceBottomNav();
      } else {
        entry.classList.add("crovantix-request-fallback");
        host.appendChild(entry);
      }

      const page = document.createElement("section");
      page.className = "crovantix-request-page";
      page.id = config.pageId;
      page.innerHTML = `
        <div class="crovantix-request-panel" role="dialog" aria-modal="true" aria-labelledby="${config.pageId}Title">
          <h2 id="${config.pageId}Title">${config.title}</h2>
          <p>${config.description}</p>
          <label>提出者姓名
            <input data-request-name readonly>
          </label>
          <label>提出者 Email
            <input data-request-email readonly>
          </label>
          <label>${config.textLabel}
            <textarea data-request-text maxlength="300" placeholder="${config.placeholder}"></textarea>
          </label>
          <p class="crovantix-request-status" data-request-status></p>
          <div class="crovantix-request-actions">
            <button type="button" data-request-close>關閉</button>
            <button class="primary" type="button" data-request-submit>${config.submitLabel}</button>
          </div>
        </div>
      `;
      host.appendChild(page);
      pages.push({ page, entry });

      const requestName = page.querySelector("[data-request-name]");
      const requestEmail = page.querySelector("[data-request-email]");
      const requestText = page.querySelector("[data-request-text]");
      const requestStatus = page.querySelector("[data-request-status]");

      function fillRequester() {
        const snapshot = userSnapshot(document);
        requestName.value = snapshot.name || "使用者";
        requestEmail.value = snapshot.email || "尚未填寫 Email";
      }

      entry.addEventListener("click", () => {
        fillRequester();
        requestStatus.textContent = "";
        previousActiveButton = bottomNav?.querySelector("button.active") || null;
        bottomNav?.querySelectorAll("button").forEach(button => button.classList.remove("active"));
        pages.forEach(item => {
          item.page.classList.remove("show");
          item.entry.classList.remove("active");
        });
        entry.classList.add("active");
        page.classList.add("show");
        requestText.focus();
      });

      page.querySelector("[data-request-close]").addEventListener("click", () => {
        page.classList.remove("show");
        restoreActive(entry);
      });

      page.querySelector("[data-request-submit]").addEventListener("click", () => {
        const detail = text(requestText.value);
        fillRequester();
        if (!detail) {
          requestStatus.textContent = config.emptyMessage;
          return;
        }
        const payload = {
          source: config.source,
          app: appId(),
          requesterName: requestName.value,
          requesterEmail: requestEmail.value,
          authorEmail: "support@crovantix.com",
          message: detail,
          status: config.sentStatus,
          submittedAt: now()
        };
        save("messages", payload);
        save("emails", {
          ...payload,
          to: "support@crovantix.com",
          subject: `${appId()} ${config.emailSubject}`,
          body: detail
        });
        requestStatus.textContent = config.sentMessage;
        requestText.value = "";
      });
    }

    if (bottomNav) {
      bottomNav.addEventListener("click", event => {
        const button = event.target.closest("button");
        if (!button) return;
        if (registrationLocked()) {
          event.preventDefault();
          event.stopImmediatePropagation();
          pages.forEach(item => {
            item.page.classList.remove("show");
            item.entry.classList.remove("active");
          });
          showRegistrationRequired();
          return;
        }
      }, true);

      bottomNav.addEventListener("click", event => {
        const button = event.target.closest("button");
        if (!button || button.classList.contains("crovantix-request-entry")) return;
        pages.forEach(item => {
          item.page.classList.remove("show");
          item.entry.classList.remove("active");
        });
      });
    }

    if (!hasNativeRequest && !hasInjectedRequest) {
      addFeature({
        pageId: "crovantixNewRequestPage",
        navLabel: "新需求",
        symbol: "＋",
        title: "提出新功能需求",
        description: "需求內容會寄送到作者信箱。作者評估後會將更新費用寄到使用者 Email；若使用者同意費用，再點選信中連結完成後續更新流程。",
        textLabel: "需求內容",
        placeholder: "請輸入希望新增或修改的功能",
        submitLabel: "送出需求",
        source: "新需求",
        emailSubject: "新功能需求",
        emptyMessage: "請先輸入需求內容。",
        sentStatus: "已通知作者",
        sentMessage: "需求已送出，後續將由作者評估後回覆。\nCrovantix 創微科技\n官網：www.crovantix.com"
      });
    }

    if (!hasIssueReport) {
      addFeature({
        pageId: "crovantixIssueReportPage",
        navLabel: "問題回報",
        symbol: "!",
        title: "問題回報",
        description: "請描述遇到的問題、發生頁面與操作步驟，客服會依回報內容協助確認。",
        textLabel: "問題內容",
        placeholder: "請輸入問題內容、發生時間或操作步驟",
        submitLabel: "送出回報",
        source: "問題回報",
        emailSubject: "問題回報",
        emptyMessage: "請先輸入問題內容。",
        sentStatus: "已送出回報",
        sentMessage: "問題回報已送出，後續將由客服協助確認。\nCrovantix 創微科技\n官網：www.crovantix.com"
      });
    }
  }

  function injectSupportWebsite() {
    const SUPPORT_WEBSITE = "www.crovantix.com";
    if (!document.querySelector("#crovantixSupportWebsiteStyle")) {
      const style = document.createElement("style");
      style.id = "crovantixSupportWebsiteStyle";
      style.textContent = `
        .crovantix-support-website {
          margin: 8px 0 0;
          color: inherit;
          opacity: .92;
          font-size: .95em;
          font-weight: 850;
          line-height: 1.45;
        }
        .crovantix-support-website a {
          color: inherit;
          text-decoration: underline;
          text-underline-offset: 3px;
        }
      `;
      document.head.appendChild(style);
    }

    const markers = [...document.querySelectorAll("h1, h2, h3, strong, span, label, .label-row, .setting-field")]
      .filter(element => /聯繫客服|Contact Support/i.test(element.textContent || ""));
    markers.forEach(marker => {
      const container = marker.classList?.contains("label-row")
        ? marker.parentElement
        : marker.closest(".card, .setting-card, .settings-card, .panel, .block, label, section, article, div") || marker.parentElement;
      if (!container || container.textContent.includes(SUPPORT_WEBSITE)) return;
      const website = document.createElement("p");
      website.className = "crovantix-support-website";
      website.innerHTML = `官網：<a href="https://${SUPPORT_WEBSITE}" target="_blank" rel="noopener">${SUPPORT_WEBSITE}</a>`;
      container.appendChild(website);
    });
  }

  function injectShareRewardFeature() {
    if (window.DISABLE_CROVANTIX_SHARE_REWARD || document.documentElement.dataset.disableShareReward === "true") return;
    if (document.querySelector("#crovantixShareRewardCard")) return;
    if (!document.querySelector("#crovantixShareRewardStyle")) {
      const style = document.createElement("style");
      style.id = "crovantixShareRewardStyle";
      style.textContent = `
        .crovantix-share-reward-card {
          display: grid;
          gap: 10px;
          margin-top: 12px;
          border: 1px solid rgba(85,215,255,.26);
          border-radius: 12px;
          padding: 14px;
          color: inherit;
          background: rgba(85,215,255,.08);
        }
        .crovantix-share-reward-card strong {
          color: inherit;
          font-size: 1.05em;
        }
        .crovantix-share-reward-card p {
          margin: 0;
          color: inherit;
          opacity: .82;
          line-height: 1.5;
        }
        .crovantix-share-reward-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr);
          gap: 8px;
        }
        .crovantix-share-reward-card select,
        .crovantix-share-reward-card input {
          min-height: 42px;
          width: 100%;
          border: 1px solid rgba(255,255,255,.16);
          border-radius: 10px;
          padding: 0 12px;
          color: #111827;
          background: #fff;
          font: inherit;
          font-weight: 800;
        }
        .crovantix-share-reward-card button {
          min-height: 44px;
          border: 0;
          border-radius: 10px;
          color: #06111b;
          background: #55d7ff;
          font: inherit;
          font-weight: 950;
          cursor: pointer;
        }
        .crovantix-share-reward-status {
          min-height: 20px;
          color: #73f0bc !important;
          font-weight: 850;
        }
        @media (max-width: 520px) {
          .crovantix-share-reward-grid {
            grid-template-columns: 1fr;
          }
        }
      `;
      document.head.appendChild(style);
    }

    const settingsPage = document.querySelector("#settingsPage")
      || [...document.querySelectorAll(".page, section, .settings-card, .card")]
        .find(element => /設定|Settings/i.test(element.textContent || ""));
    const host = settingsPage?.querySelector(".card:last-child, .settings-card:last-child, .panel:last-child")
      || settingsPage
      || document.querySelector(".screen, .phone, .app")
      || document.body;
    const card = document.createElement("div");
    card.className = "crovantix-share-reward-card";
    card.id = "crovantixShareRewardCard";
    card.innerHTML = `
      <strong>分享 App 賺免費點數</strong>
      <p>把此 App 透過 FB、IG、Threads、LINE 或其他平台分享給朋友，可免費獲得 5 點。相同朋友不可重複領點。</p>
      <div class="crovantix-share-reward-grid">
        <select id="crovantixSharePlatform" aria-label="分享平台">
          <option value="Facebook">Facebook</option>
          <option value="Instagram">Instagram</option>
          <option value="Threads">Threads</option>
          <option value="LINE">LINE</option>
          <option value="Other">其他平台</option>
        </select>
        <input id="crovantixShareFriend" placeholder="朋友 Email / 電話 / 帳號" autocomplete="off">
      </div>
      <button type="button" id="crovantixShareSubmit">分享並領取 5 點</button>
      <p class="crovantix-share-reward-status" id="crovantixShareStatus"></p>
    `;
    host.appendChild(card);

    const platformInput = card.querySelector("#crovantixSharePlatform");
    const friendInput = card.querySelector("#crovantixShareFriend");
    const status = card.querySelector("#crovantixShareStatus");
    card.querySelector("#crovantixShareSubmit").addEventListener("click", () => {
      const platform = platformInput.value;
      const friend = normalizeFriend(friendInput.value);
      if (!friend) {
        status.textContent = "請先輸入朋友 Email、電話或帳號。";
        return;
      }
      const state = shareRewardState();
      if (state.friends.includes(friend)) {
        status.textContent = "已分享給相同朋友，不能重複領取點數。";
        save("messages", {
          source: "分享領點重複阻擋",
          platform,
          friend,
          rewardPoints: 0
        });
        return;
      }
      state.friends.push(friend);
      state.rewardPoints = Number(state.rewardPoints || 0) + 5;
      localStorage.setItem(shareRewardKey(), JSON.stringify(state));
      addVisibleCredits(5);
      status.textContent = `已記錄分享給新朋友，免費獲得 5 點。目前分享獎勵共 ${state.rewardPoints} 點。`;
      save("messages", {
        source: "分享App獲得點數",
        platform,
        friend,
        rewardPoints: 5,
        totalShareRewardPoints: state.rewardPoints
      });
      openSharePlatform(platform);
    });
  }

  function shareRewardKey() {
    return `CROVANTIX_SHARE_REWARD_${appId()}`;
  }

  function shareRewardState() {
    let state;
    try {
      state = JSON.parse(localStorage.getItem(shareRewardKey()) || "{}");
    } catch {
      state = {};
    }
    return {
      friends: Array.isArray(state.friends) ? state.friends : [],
      rewardPoints: Number(state.rewardPoints || 0)
    };
  }

  function normalizeFriend(value) {
    return text(value).toLowerCase().replace(/\s+/g, "").replace(/[()-]/g, "");
  }

  function openSharePlatform(platform) {
    const shareUrl = encodeURIComponent(location.href);
    const shareText = encodeURIComponent("推薦你試試 Crovantix Technologies 開發的 App。");
    const urls = {
      Facebook: `https://www.facebook.com/sharer/sharer.php?u=${shareUrl}`,
      Threads: `https://www.threads.net/intent/post?text=${shareText}%20${shareUrl}`,
      LINE: `https://social-plugins.line.me/lineit/share?url=${shareUrl}`,
      Instagram: `https://www.instagram.com/`
    };
    window.open(urls[platform] || location.href, "_blank", "noopener");
  }

  function addVisibleCredits(points) {
    const selectors = [
      "#pointsBadge",
      "#creditBadge",
      "#creditsBadge",
      "#remainingCredits",
      "#profileCredits",
      "#pointsButton",
      "#creditButton",
      "[data-credits]",
      "[data-points]"
    ];
    const targets = new Set(selectors.flatMap(selector => [...document.querySelectorAll(selector)]));
    [...document.querySelectorAll("button, span, strong, b, small")]
      .filter(element => /剩餘點數|剩餘次數|點數|credits/i.test(element.textContent || ""))
      .forEach(element => targets.add(element));
    targets.forEach(element => {
      if ("value" in element && /\d+/.test(element.value || "")) {
        element.value = element.value.replace(/\d+/, number => String(Number(number) + points));
        return;
      }
      if (/\d+/.test(element.textContent || "")) {
        element.textContent = element.textContent.replace(/\d+/, number => String(Number(number) + points));
      }
    });
    window.dispatchEvent(new CustomEvent("crovantix-share-reward", {
      detail: { points, app: appId() }
    }));
  }

  window.AppDatabase = {
    save,
    saveUser: data => save("users", { ...data, app: appId() }),
    membershipEntitlement,
    saveQuestion: data => save("questions", { ...data, app: appId() }),
    saveMessage: data => save("messages", { ...data, app: appId() }),
    saveEmail: data => save("emails", { ...data, app: appId() }),
    flushQueue,
    apiBase: API_BASE,
    getAll: async storeName => {
      const db = await dbPromise;
      if (!db) return [];
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readonly");
        const request = tx.objectStore(storeName).getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
    },
    prune,
    limit: LIMIT,
    name: DB_NAME
  };

  observeAssistantQuestions();
  function initializeSharedAppFeatures() {
    injectNewRequestFeature();
    injectSupportWebsite();
    injectShareRewardFeature();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeSharedAppFeatures, { once: true });
  } else {
    initializeSharedAppFeatures();
  }
  flushQueue();
  window.addEventListener("online", flushQueue);
})();
