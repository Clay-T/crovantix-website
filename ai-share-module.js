(function () {
  const SHARE_TARGET_SELECTOR = [
    "#solveResult",
    "#resultCard",
    "#answerCard",
    "#legalResult",
    ".message.assistant .bubble",
    ".solution.show"
  ].join(",");

  const shareOptions = [
    { id: "line", label: "LINE", hint: "使用手機已安裝的 LINE 分享" },
    { id: "wechat", label: "WeChat", hint: "使用手機已安裝的 WeChat 分享" },
    { id: "email", label: "Email", hint: "用電子郵件寄出" },
    { id: "sms", label: "簡訊", hint: "用手機簡訊送出" }
  ];

  let activeShareText = "";
  let activeShareChoice = "line";

  function injectShareStyles() {
    if (document.querySelector("#aiShareStyles")) return;
    const style = document.createElement("style");
    style.id = "aiShareStyles";
    style.textContent = `
      .ai-share {
        display: grid;
        gap: 8px;
        margin-top: 12px;
      }
      .ai-share-button,
      .ai-share-send,
      .ai-share-close,
      .ai-share-option {
        border: 0;
        border-radius: 14px;
        cursor: pointer;
        font: inherit;
        font-weight: 900;
      }
      .ai-share-button {
        align-self: start;
        background: rgba(94, 210, 255, .16);
        border: 1px solid rgba(94, 210, 255, .42);
        color: var(--blue, #5ed2ff);
        padding: 9px 12px;
      }
      .ai-share-modal.hidden { display: none; }
      .ai-share-modal {
        align-items: end;
        background: rgba(1, 10, 18, .62);
        display: grid;
        inset: 0;
        padding: 18px;
        position: fixed;
        z-index: 9999;
      }
      .ai-share-sheet {
        background: var(--panel, #152434);
        border: 1px solid rgba(148, 163, 184, .28);
        border-radius: 22px;
        box-shadow: 0 24px 60px rgba(0, 0, 0, .38);
        color: var(--ink, #f8fbff);
        display: grid;
        gap: 12px;
        margin: 0 auto;
        max-width: 420px;
        padding: 18px;
        width: min(100%, 420px);
      }
      .ai-share-sheet h2 {
        font-size: 20px;
        margin: 0;
      }
      .ai-share-sheet p {
        color: var(--muted, #9fb0c5);
        margin: 0;
      }
      .ai-share-options {
        display: grid;
        gap: 8px;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .ai-share-option {
        background: rgba(255, 255, 255, .08);
        color: var(--ink, #f8fbff);
        display: grid;
        gap: 4px;
        min-height: 74px;
        padding: 12px;
        text-align: left;
      }
      .ai-share-option.active {
        background: rgba(94, 210, 255, .2);
        outline: 2px solid rgba(94, 210, 255, .45);
      }
      .ai-share-option span {
        color: var(--muted, #9fb0c5);
        font-size: 12px;
        font-weight: 700;
      }
      .ai-share-actions {
        display: grid;
        gap: 10px;
        grid-template-columns: 1fr 1fr;
      }
      .ai-share-send {
        background: var(--blue, #5ed2ff);
        color: #05131d;
        padding: 12px;
      }
      .ai-share-close {
        background: rgba(255, 255, 255, .08);
        color: var(--ink, #f8fbff);
        padding: 12px;
      }
      .ai-share-status {
        min-height: 20px;
      }
    `;
    document.head.appendChild(style);
  }

  function ensureShareModal() {
    let modal = document.querySelector("#aiShareModal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "aiShareModal";
    modal.className = "ai-share-modal hidden";
    modal.innerHTML = `
      <div class="ai-share-sheet" role="dialog" aria-modal="true" aria-label="分享 AI 回覆">
        <h2>分享 AI 回覆</h2>
        <p>選擇要分享的通訊軟體、Email 或簡訊後送出。</p>
        <div class="ai-share-options">
          ${shareOptions.map(option => `
            <button class="ai-share-option" type="button" data-share-choice="${option.id}">
              ${option.label}
              <span>${option.hint}</span>
            </button>
          `).join("")}
        </div>
        <div class="ai-share-actions">
          <button class="ai-share-close" type="button">取消</button>
          <button class="ai-share-send" type="button">送出</button>
        </div>
        <p class="ai-share-status" id="aiShareStatus"></p>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelectorAll(".ai-share-option").forEach(button => {
      button.addEventListener("click", () => {
        activeShareChoice = button.dataset.shareChoice;
        updateActiveShareOption();
      });
    });
    modal.querySelector(".ai-share-close").addEventListener("click", closeShareModal);
    modal.querySelector(".ai-share-send").addEventListener("click", sendShare);
    modal.addEventListener("click", event => {
      if (event.target === modal) closeShareModal();
    });
    return modal;
  }

  function updateActiveShareOption() {
    document.querySelectorAll(".ai-share-option").forEach(button => {
      button.classList.toggle("active", button.dataset.shareChoice === activeShareChoice);
    });
  }

  function closeShareModal() {
    document.querySelector("#aiShareModal")?.classList.add("hidden");
  }

  function openShareModal(text) {
    activeShareText = text;
    const modal = ensureShareModal();
    modal.querySelector("#aiShareStatus").textContent = "";
    modal.classList.remove("hidden");
    updateActiveShareOption();
  }

  function sendShare() {
    const text = activeShareText.trim();
    const encoded = encodeURIComponent(text);
    const status = document.querySelector("#aiShareStatus");
    if (!text) {
      status.textContent = "沒有可分享的 AI 回覆內容。";
      return;
    }
    if (activeShareChoice === "email") {
      window.location.href = `mailto:?subject=${encodeURIComponent("AI 回覆分享")}&body=${encoded}`;
      status.textContent = "已開啟 Email 分享。";
      return;
    }
    if (activeShareChoice === "sms") {
      window.location.href = `sms:?&body=${encoded}`;
      status.textContent = "已開啟簡訊分享。";
      return;
    }
    if (activeShareChoice === "line") {
      window.open(`https://line.me/R/share?text=${encoded}`, "_blank");
      status.textContent = "已送出 LINE 分享請求。";
      return;
    }
    status.textContent = "已送出 WeChat 分享請求，請在手機分享選單中選擇 WeChat。";
  }

  function isShareableTarget(element) {
    if (!element || element.closest(".ai-share") || element.closest(".ai-share-modal")) return false;
    if (document.body.classList.contains("no-chat-bubble-share") && element.matches(".message.assistant .bubble")) return false;
    if (element.id === "legalResult" && element.classList.contains("hidden")) return false;
    if (element.classList.contains("solution") && !element.classList.contains("show")) return false;
    const text = getShareText(element);
    if (!text || text.length < 8) return false;
    const placeholderWords = ["這裡會顯示", "尚未", "選擇題目後", "輸入英文題目後"];
    return !placeholderWords.some(word => text.includes(word));
  }

  function getShareText(element) {
    const clone = element.cloneNode(true);
    clone.querySelectorAll(".ai-share, script, style, button, input, textarea, select").forEach(node => node.remove());
    return clone.textContent.replace(/\s+/g, " ").trim();
  }

  function attachShareButton(element) {
    if (!isShareableTarget(element)) return;
    let wrapper = element.querySelector(":scope > .ai-share");
    if (!wrapper) {
      wrapper = document.createElement("div");
      wrapper.className = "ai-share";
      const button = document.createElement("button");
      button.className = "ai-share-button";
      button.type = "button";
      button.textContent = "分享";
      button.addEventListener("click", () => openShareModal(getShareText(element)));
      wrapper.appendChild(button);
      element.appendChild(wrapper);
    }
  }

  function syncShareButtons() {
    document.querySelectorAll(SHARE_TARGET_SELECTOR).forEach(attachShareButton);
  }

  function startShareModule() {
    injectShareStyles();
    ensureShareModal();
    syncShareButtons();
    const observer = new MutationObserver(() => {
      window.requestAnimationFrame(syncShareButtons);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startShareModule);
  } else {
    startShareModule();
  }
}());
