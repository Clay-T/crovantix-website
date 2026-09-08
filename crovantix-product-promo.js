(function () {
  "use strict";

  const PRODUCTS = [
    { file: "secretary-ios-app.html", name: "個人秘書 App", summary: "AI 對話、語音朗讀、新需求與升級方案，協助整理日常問題。" },
    { file: "my-secretary-ios-app.html", name: "我的秘書 App", summary: "背景學習使用習慣，建立秘書工作清單並在相似情境提醒。" },
    { file: "photo-beautify-ios-app.html", name: "社群媒體助手 App", summary: "照片美化、AI 文案生成與社群平台發文管理。" },
    { file: "service-match-ios-app.html", name: "需求媒合 App", summary: "發布需求、接案、工作室與留言對話的服務媒合平台。" },
    { file: "token-killer-ios-app.html", name: "Token 精簡大師 App", summary: "使用 ChatGPT、Gemini、Claude 等 AI 工具前先壓縮 prompt，記錄 request 與 token 節省率。" },
    { file: "company-analysis-ios-app.html", name: "公司股票分析 App", summary: "查詢台股公司資料、K 線、營收、EPS 與收藏追蹤。" },
    { file: "lawyer-ios-app.html", name: "法律助理 App", summary: "法律問題分類、初步分析與專業律師聯繫。" },
    { file: "love-master-ios-app.html", name: "愛情大師 App", summary: "感情分析、愛情教練與 AI 戀愛建議。" },
    { file: "fortune-ios-app.html", name: "命理 App", summary: "命理分析、點數方案與個人資料設定。" },
    { file: "voice-call-ios-app.html", name: "附近語音通話 App", summary: "附近搜尋、語音通話、好友、群組與留言功能。" },
    { file: "voice-agent-ios-app.html", name: "語音 Agent App", summary: "AI 語音助理、新需求與使用者設定管理。" },
    { file: "online-market-ios-app.html", name: "線上交易 App", summary: "商品刊登、交易媒合、留言與個人資訊管理。" },
    { file: "math-tutor-ios-app.html", name: "數學題庫 App", summary: "選擇題測驗、詳解、補習班媒合與升級點數。" },
    { file: "english-question-bank-ios-app.html", name: "英文題庫 App", summary: "英文題庫測驗、分數評估與補習班推薦。" },
    { file: "chinese-question-bank-ios-app.html", name: "國文題庫 App", summary: "國文題庫測驗、詳解與學習支援。" },
    { file: "biology-question-bank-ios-app.html", name: "生物題庫 App", summary: "生物選擇題測驗、成績與詳解功能。" },
    { file: "stock-ios-app.html", name: "股票 App", summary: "股票追蹤、資訊整理與投資輔助展示。" }
  ];
  const PROMO_DELAY_MS = 2400;

  function currentFile() {
    return decodeURIComponent(location.pathname.split("/").pop() || "");
  }

  function pickProduct() {
    const current = currentFile();
    const candidates = PRODUCTS.filter(product => product.file !== current);
    return candidates[Math.floor(Math.random() * candidates.length)] || PRODUCTS[0];
  }

  function appStoreUrl(product) {
    const term = encodeURIComponent(`Crovantix ${product.name}`);
    return `https://apps.apple.com/tw/search?term=${term}`;
  }

  function ensureRegistrationPageVisible() {
    const registrationSelectors = [
      "#registerPage",
      "#registrationPage",
      "#loginPage",
      ".register-page",
      ".registration-page"
    ];
    const registrationPage = registrationSelectors
      .map(selector => document.querySelector(selector))
      .find(Boolean);
    if (!registrationPage) return;

    document.querySelectorAll(".page, .screen-page, .app-page, section[id$='Page']").forEach(page => {
      if (page === registrationPage) return;
      if (page.classList.contains("active")) page.classList.remove("active");
      if (page.classList.contains("show")) page.classList.remove("show");
    });
    registrationPage.classList.add("active");
    registrationPage.classList.add("show");
    registrationPage.hidden = false;
    registrationPage.style.display = "";
  }

  function launchLayersGone() {
    const blockingSelectors = [
      ".splash.show",
      ".launch.show",
      ".launch-screen.show",
      ".brand-launch.show",
      ".crovantix-launch.show",
      ".intro.show"
    ];
    return !blockingSelectors.some(selector => document.querySelector(selector));
  }

  function schedulePromo() {
    if (document.body?.dataset.crovantixDisableProductPromo === "true") return;
    ensureRegistrationPageVisible();
    const startedAt = Date.now();
    const waitForInitialScreen = () => {
      ensureRegistrationPageVisible();
      if (launchLayersGone() || Date.now() - startedAt > 5000) {
        setTimeout(showPromo, 250);
        return;
      }
      setTimeout(waitForInitialScreen, 250);
    };
    setTimeout(waitForInitialScreen, PROMO_DELAY_MS);
  }

  function record(source, payload) {
    const data = {
      source,
      ...payload,
      currentApp: currentFile(),
      shownAt: new Date().toISOString()
    };
    if (window.AppDatabase?.saveMessage) {
      window.AppDatabase.saveMessage(data);
      return;
    }
    const queue = JSON.parse(localStorage.getItem("CROVANTIX_PROMO_QUEUE") || "[]");
    queue.push(data);
    localStorage.setItem("CROVANTIX_PROMO_QUEUE", JSON.stringify(queue.slice(-1000)));
  }

  function flushQueuedRecords() {
    if (!window.AppDatabase?.saveMessage) return;
    const queue = JSON.parse(localStorage.getItem("CROVANTIX_PROMO_QUEUE") || "[]");
    if (!queue.length) return;
    queue.forEach(item => window.AppDatabase.saveMessage(item));
    localStorage.removeItem("CROVANTIX_PROMO_QUEUE");
  }

  function injectStyle() {
    if (document.querySelector("#crovantixProductPromoStyle")) return;
    const style = document.createElement("style");
    style.id = "crovantixProductPromoStyle";
    style.textContent = `
      .crovantix-product-promo {
        position: fixed;
        inset: 0;
        z-index: 2147483000;
        display: none;
        align-items: center;
        justify-content: center;
        padding: 22px;
        background: rgba(2, 7, 13, .64);
        backdrop-filter: blur(12px);
      }
      .crovantix-product-promo.show {
        display: flex;
      }
      .crovantix-product-card {
        width: min(390px, calc(100vw - 36px));
        display: grid;
        gap: 12px;
        border: 1px solid rgba(91, 215, 255, .32);
        border-radius: 20px;
        padding: 20px;
        color: #f7fbff;
        background:
          radial-gradient(circle at 12% 0%, rgba(92, 220, 255, .2), transparent 36%),
          linear-gradient(145deg, #101927, #07111d 58%, #11182a);
        box-shadow: 0 28px 70px rgba(0, 0, 0, .45);
        font-family: -apple-system, BlinkMacSystemFont, "Noto Sans TC", "Segoe UI", sans-serif;
      }
      .crovantix-product-kicker {
        color: #63dcff;
        font-size: 12px;
        font-weight: 900;
        letter-spacing: .08em;
      }
      .crovantix-product-card h2 {
        margin: 0;
        color: #ffffff;
        font-size: 26px;
        line-height: 1.18;
        letter-spacing: 0;
      }
      .crovantix-product-card p {
        margin: 0;
        color: #c4d1df;
        font-size: 15px;
        line-height: 1.55;
      }
      .crovantix-product-actions {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 10px;
        margin-top: 4px;
      }
      .crovantix-product-actions button,
      .crovantix-product-actions a {
        min-height: 46px;
        display: grid;
        place-items: center;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, .14);
        color: #f7fbff;
        background: rgba(255, 255, 255, .08);
        text-decoration: none;
        font-size: 14px;
        font-weight: 900;
        cursor: pointer;
      }
      .crovantix-product-actions a {
        color: #06111b;
        border-color: transparent;
        background: linear-gradient(135deg, #68e2ff, #57c7ff);
      }
    `;
    document.head.appendChild(style);
  }

  function showPromo() {
    if (document.body?.dataset.crovantixDisableProductPromo === "true") return;
    injectStyle();
    flushQueuedRecords();
    const product = pickProduct();
    const productUrl = appStoreUrl(product);
    const overlay = document.createElement("div");
    overlay.className = "crovantix-product-promo";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.innerHTML = `
      <div class="crovantix-product-card">
        <div class="crovantix-product-kicker">CROVANTIX PRODUCT</div>
        <h2>${product.name}</h2>
        <p>${product.summary}</p>
        <p>也可以試試 Crovantix Technologies 開發的其他 App 產品，點選後會前往 iOS App Store 安裝頁面。</p>
        <div class="crovantix-product-actions">
          <button type="button" data-action="dismiss">稍後</button>
          <a href="${productUrl}" target="_blank" rel="noopener" data-action="open">前往安裝</a>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("show"));
    record("Crovantix產品隨機推播顯示", { recommendedProduct: product });

    overlay.addEventListener("click", event => {
      if (event.target === overlay || event.target.closest("[data-action='dismiss']")) {
        record("Crovantix產品隨機推播關閉", { recommendedProduct: product });
        overlay.classList.remove("show");
        setTimeout(() => overlay.remove(), 180);
      }
      if (event.target.closest("[data-action='open']")) {
        record("Crovantix產品隨機推播開啟", { recommendedProduct: product });
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", schedulePromo, { once: true });
  } else {
    schedulePromo();
  }
})();
