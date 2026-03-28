// Jira Estimate Editor - Content Script con TypeScript
// Clean UI design: No permanent icons, toggle-based estimate mode

// ============================================
// TYPES
// ============================================

interface TicketData {
  key?: string; // opzionale (content script usa Map)
  estimate: number | null;
  element: Element; // obbligatorio in content script
  summary?: string; // opzionale
  issueType?: string; // opzionale
}
interface Message {
  type: string;
  issueKey?: string;
  value?: number;
}

interface TicketInfo {
  key: string;
  estimate: number | null;
  summary: string;
  issueType: string;
}

interface MessageResponse {
  tickets?: TicketInfo[];
  success?: boolean;
  error?: string;
}

interface IssueData {
  editmeta?: {
    fields?: Record<string, FieldMeta>;
  };
  fields?: Record<string, any>;
}

interface FieldMeta {
  name?: string;
  [key: string]: any;
}

(function () {
  console.log("😾 Jira Estimate Editor loaded");

  // ============================================
  // CONSTANTS
  // ============================================

  const ESTIMATE_VALUES: number[] = [0.1, 0.2, 0.5, 1, 1.5, 2, 3];

  // ============================================
  // STATE
  // ============================================

  let estimateModeActive: boolean = false;
  let currentPicker: HTMLDivElement | null = null;
  let fab: HTMLButtonElement | null = null;
  let statusBar: HTMLDivElement | null = null;
  let keyboardHint: HTMLDivElement | null = null;
  let ticketData = new Map<string, TicketData>(); // issueKey -> {estimate, element}

  // ============================================
  // INITIALIZATION
  // ============================================

  function init(): void {
    console.log("😺 Initializing Jira Estimate Editor");
    createFAB();
    createStatusBar();
    createKeyboardHint();
    scanTickets();

    // Re-scan when DOM changes
    const observer = new MutationObserver(() => {
      if (estimateModeActive) {
        setTimeout(scanTickets, 100);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  // ============================================
  // UI COMPONENTS
  // ============================================

  function createFAB(): void {
    fab = document.createElement("button");
    fab.className = "jee-fab";
    fab.innerHTML = "⏱";
    fab.title = "Toggle Estimate Mode (Alt+E)";

    fab.addEventListener("click", () => toggleEstimateMode());

    // Show keyboard hint on first hover
    let hasShownHint = false;
    fab.addEventListener("mouseenter", () => {
      if (!hasShownHint && keyboardHint) {
        hasShownHint = true;
        keyboardHint.classList.add("visible");
        setTimeout(() => keyboardHint?.classList.remove("visible"), 3000);
      }
    });

    document.body.appendChild(fab);
  }

  function createStatusBar(): void {
    statusBar = document.createElement("div");
    statusBar.className = "jee-status-bar";
    statusBar.innerHTML = `
      <div class="jee-status-item">
        <span id="jee-ticket-count">0 tickets</span>
      </div>
      <div class="jee-status-divider"></div>
      <div class="jee-status-item">
        <strong id="jee-total-estimate">0d</strong> total
      </div>
      <div class="jee-status-divider"></div>
      <div class="jee-status-item">
        <span id="jee-unestimated-count">0 unestimated</span>
      </div>
      <button class="jee-status-close" title="Close (Esc)">✕</button>
    `;

    const closeBtn = statusBar.querySelector(".jee-status-close");
    closeBtn?.addEventListener("click", () => {
      toggleEstimateMode(false);
    });
    document.body.appendChild(statusBar);
  }

  function createKeyboardHint(): void {
    keyboardHint = document.createElement("div");
    keyboardHint.className = "jee-keyboard-hint";
    keyboardHint.innerHTML = "Press <kbd>Alt</kbd>+<kbd>E</kbd> to toggle";
    document.body.appendChild(keyboardHint);
  }

  // ============================================
  // ESTIMATE MODE TOGGLE
  // ============================================

  function toggleEstimateMode(active?: boolean): void {
    if (active === undefined) {
      active = !estimateModeActive;
    }

    estimateModeActive = active;

    if (estimateModeActive) {
      enterEstimateMode();
    } else {
      exitEstimateMode();
    }
  }

  function enterEstimateMode(): void {
    console.log("😺 Entering estimate mode");

    document.body.classList.add("jee-estimate-mode-active");
    fab?.classList.add("active");
    statusBar?.classList.add("visible");

    scanTickets();
    addCardBadges();
    attachCardListeners();
    updateStatusBar();
  }

  function exitEstimateMode(): void {
    console.log("😺 Exiting estimate mode");

    document.body.classList.remove("jee-estimate-mode-active");
    fab?.classList.remove("active");
    statusBar?.classList.remove("visible");

    removeCardBadges();
    removeCardListeners();
    closePicker();
  }

  // ============================================
  // TICKET SCANNING
  // ============================================

  function scanTickets(): void {
    const cardSelectors: string[] = [
      ".ghx-issue",
      '[data-testid*="card"]',
      "[data-rbd-draggable-id]",
    ];

    const cards = document.querySelectorAll<Element>(cardSelectors.join(", "));
    console.log("😺 Found", cards.length, "cards");

    cards.forEach((card) => {
      const issueKey = findIssueKey(card);
      if (!issueKey) return;

      const estimate = findEstimateOnCard(card);

      ticketData.set(issueKey, {
        estimate,
        element: card,
      });
    });

    if (estimateModeActive) {
      updateStatusBar();
    }
  }

  function findIssueKey(card: Element): string | null {
    const keyAttr = card.getAttribute("data-issue-key");
    if (keyAttr) return keyAttr;

    const link = card.querySelector<HTMLAnchorElement>('a[href*="/browse/"]');
    if (link) {
      const match = link.href.match(/([A-Z][A-Z0-9]+-\d+)/);
      if (match) return match[1];
    }

    const keyEl = card.querySelector<HTMLElement>(
      '.ghx-key a, [data-testid*="issue-key"]'
    );
    if (keyEl) {
      const text = keyEl.textContent?.trim();
      if (text && /^[A-Z][A-Z0-9]+-\d+$/.test(text)) return text;
    }

    const textMatch = card.textContent?.match(/([A-Z][A-Z0-9]+-\d+)/);
    return textMatch ? textMatch[1] : null;
  }

  function findEstimateOnCard(card: Element): number | null {
    const estimateSelectors: string[] = [
      ".ghx-estimate",
      ".ghx-statistic-badge",
      '[data-tooltip*="Story Points"]',
      ".aui-badge",
      '[class*="storypoint"]',
      '[class*="estimate"]',
    ];

    for (const sel of estimateSelectors) {
      const el = card.querySelector<HTMLElement>(sel);
      if (el) {
        const val = parseFloat(el.textContent?.trim() || "");
        if (!isNaN(val) && val >= 0 && val <= 100) {
          return val;
        }
      }
    }

    // Look for leaf nodes with numbers
    const allElements = card.querySelectorAll<HTMLElement>("*");
    for (const el of allElements) {
      if (el.children.length === 0) {
        const text = el.textContent?.trim();
        if (text && /^[0-9]+\.?[0-9]*$/.test(text)) {
          const val = parseFloat(text);
          if (!isNaN(val) && val >= 0 && val <= 21) {
            const parent = el.parentElement;
            if (
              parent &&
              (parent.classList.contains("ghx-stat-1") ||
                parent.classList.contains("ghx-estimate") ||
                parent.className.includes("statistic"))
            ) {
              return val;
            }
          }
        }
      }
    }

    return null;
  }

  // ============================================
  // CARD BADGES & INTERACTION
  // ============================================

  function addCardBadges(): void {
    ticketData.forEach((data, issueKey) => {
      if (data.element.querySelector(".jee-card-estimate-badge")) return;

      const badge = document.createElement("div");
      badge.className = "jee-card-estimate-badge";

      if (data.estimate !== null) {
        badge.textContent = `${data.estimate}d`;
        badge.classList.add("has-value");
      } else {
        badge.textContent = "-";
        badge.classList.add("no-value");
      }

      badge.dataset.issueKey = issueKey;

      const container =
        data.element.querySelector<HTMLElement>(".ghx-issue-content") ||
        data.element;
      container.appendChild(badge);
    });
  }

  function removeCardBadges(): void {
    document.querySelectorAll(".jee-card-estimate-badge").forEach((badge) => {
      badge.remove();
    });
  }

  function attachCardListeners(): void {
    ticketData.forEach((data, issueKey) => {
      const el = data.element as HTMLElement;
      el.addEventListener("click", handleCardClick);
      el.dataset.jeeIssueKey = issueKey;
    });
  }

  function removeCardListeners(): void {
    ticketData.forEach((data) => {
      const el = data.element as HTMLElement;
      el.removeEventListener("click", handleCardClick);
      delete el.dataset.jeeIssueKey;
    });
  }

  function handleCardClick(this: HTMLElement, e: MouseEvent): void {
    // Don't intercept if clicking on a link or button
    if ((e.target as HTMLElement).closest("a, button, input, textarea")) return;

    e.preventDefault();
    e.stopPropagation();

    const issueKey = this.dataset.jeeIssueKey;
    if (!issueKey) return;

    const data = ticketData.get(issueKey);
    if (!data) return;

    showEstimatePicker(issueKey, data.estimate, e);
  }

  // ============================================
  // ESTIMATE PICKER
  // ============================================

  function showEstimatePicker(
    issueKey: string,
    currentEstimate: number | null,
    clickEvent: MouseEvent
  ): void {
    closePicker();

    currentPicker = document.createElement("div");
    currentPicker.className = "jee-estimate-picker";
    currentPicker.innerHTML = `
      <div class="jee-estimate-picker-header">
        <span class="jee-estimate-picker-title">Estimate (days)</span>
        <span class="jee-estimate-picker-key">${issueKey}</span>
      </div>
      <div class="jee-estimate-picker-buttons">
        ${ESTIMATE_VALUES.map(
          (val) => `
          <button class="jee-estimate-picker-btn${
            currentEstimate === val ? " active" : ""
          }"
                  data-value="${val}">${val}</button>
        `
        ).join("")}
      </div>
      <div class="jee-estimate-picker-custom">
        <input type="number"
               class="jee-estimate-picker-input"
               placeholder="Custom"
               step="0.1"
               min="0">
        <button class="jee-estimate-picker-set">Set</button>
      </div>
    `;

    document.body.appendChild(currentPicker);

    // Position near click
    const target = clickEvent.target as HTMLElement;
    const rect = target.getBoundingClientRect();
    let top = rect.top + window.scrollY;
    let left = rect.right + window.scrollX + 10;

    // Keep on screen
    const pickerRect = currentPicker.getBoundingClientRect();
    if (left + pickerRect.width > window.innerWidth) {
      left = rect.left + window.scrollX - pickerRect.width - 10;
    }
    if (top + pickerRect.height > window.innerHeight + window.scrollY) {
      top = window.innerHeight + window.scrollY - pickerRect.height - 10;
    }

    currentPicker.style.top = `${top}px`;
    currentPicker.style.left = `${left}px`;

    // Show with animation
    setTimeout(() => currentPicker?.classList.add("visible"), 10);

    // Add event listeners
    currentPicker
      .querySelectorAll<HTMLButtonElement>(".jee-estimate-picker-btn")
      .forEach((btn) => {
        btn.addEventListener("click", async () => {
          const value = parseFloat(btn.dataset.value || "0");
          await setEstimate(issueKey, value);
          closePicker();
        });
      });

    const customInput = currentPicker.querySelector<HTMLInputElement>(
      ".jee-estimate-picker-input"
    );
    const setBtn = currentPicker.querySelector<HTMLButtonElement>(
      ".jee-estimate-picker-set"
    );

    setBtn?.addEventListener("click", async () => {
      const value = parseFloat(customInput?.value || "0");
      if (!isNaN(value) && value >= 0) {
        await setEstimate(issueKey, value);
        closePicker();
      }
    });

    customInput?.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        setBtn?.click();
      }
    });

    // Close on outside click
    setTimeout(() => {
      document.addEventListener("click", closePickerOnOutsideClick);
    }, 100);
  }

  function closePickerOnOutsideClick(e: MouseEvent): void {
    if (currentPicker && !currentPicker.contains(e.target as Node)) {
      closePicker();
    }
  }

  function closePicker(): void {
    if (currentPicker) {
      currentPicker.remove();
      currentPicker = null;
      document.removeEventListener("click", closePickerOnOutsideClick);
    }
  }

  // ============================================
  // ESTIMATE UPDATE
  // ============================================

  async function setEstimate(
    issueKey: string,
    value: number
  ): Promise<boolean> {
    console.log("😸 Setting estimate for", issueKey, "to", value);

    const success = await updateEstimateViaAPI(issueKey, value);

    if (success) {
      // Update local data
      const data = ticketData.get(issueKey);
      if (data) {
        data.estimate = value;

        // Update badge
        const badge = data.element.querySelector<HTMLElement>(
          ".jee-card-estimate-badge"
        );
        if (badge) {
          badge.textContent = `${value}d`;
          badge.classList.remove("no-value");
          badge.classList.add("has-value");
        }
      }

      updateStatusBar();
      showToast(`✓ ${issueKey} → ${value}d`, "success");
    } else {
      showToast(`✗ Failed to update ${issueKey}`, "error");
    }

    return success;
  }

  async function updateEstimateViaAPI(
    issueKey: string,
    value: number
  ): Promise<boolean> {
    const baseUrl = window.location.origin;

    try {
      const issueResponse = await fetch(
        `${baseUrl}/rest/api/2/issue/${issueKey}?expand=editmeta`,
        {
          credentials: "include",
          headers: { "Content-Type": "application/json" },
        }
      );

      if (!issueResponse.ok) {
        throw new Error(`Failed to fetch issue: ${issueResponse.status}`);
      }

      const issueData: IssueData = await issueResponse.json();
      const storyPointsFieldId = findStoryPointsField(issueData);

      if (!storyPointsFieldId) {
        throw new Error("Could not find story points field");
      }

      const updateResponse = await fetch(
        `${baseUrl}/rest/api/2/issue/${issueKey}`,
        {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fields: { [storyPointsFieldId]: value },
          }),
        }
      );

      if (!updateResponse.ok) {
        throw new Error(`Update failed: ${updateResponse.status}`);
      }

      return true;
    } catch (error) {
      console.log("😿 Error updating estimate:", error);
      return false;
    }
  }

  function findStoryPointsField(issueData: IssueData): string | null {
    // Check edit metadata
    if (issueData.editmeta?.fields) {
      for (const [fieldId, fieldMeta] of Object.entries(
        issueData.editmeta.fields
      )) {
        const name = fieldMeta.name?.toLowerCase() || "";
        if (
          name.includes("story point") ||
          name.includes("estimate") ||
          name.includes("points")
        ) {
          return fieldId;
        }
      }
    }

    // Common field IDs
    const commonFieldIds: string[] = [
      "customfield_10016",
      "customfield_10004",
      "customfield_10006",
      "customfield_10026",
      "customfield_10002",
      "customfield_10014",
      "customfield_10034",
    ];

    const fields = issueData.fields || {};
    for (const fieldId of commonFieldIds) {
      if (fieldId in fields) return fieldId;
    }

    // Look for any numeric custom field
    for (const [key, value] of Object.entries(fields)) {
      if (key.startsWith("customfield_") && typeof value === "number") {
        return key;
      }
    }

    return "customfield_10016";
  }

  // ============================================
  // STATUS BAR UPDATE
  // ============================================

  function updateStatusBar(): void {
    if (!statusBar) return;

    let total = 0;
    let estimated = 0;
    let count = ticketData.size;

    ticketData.forEach((data) => {
      if (data.estimate !== null && data.estimate !== undefined) {
        total += data.estimate;
        estimated++;
      }
    });

    const unestimated = count - estimated;

    const ticketCountEl = document.getElementById("jee-ticket-count");
    const totalEstimateEl = document.getElementById("jee-total-estimate");
    const unestimatedCountEl = document.getElementById("jee-unestimated-count");

    if (ticketCountEl) {
      ticketCountEl.textContent = `${count} ticket${count !== 1 ? "s" : ""}`;
    }
    if (totalEstimateEl) {
      totalEstimateEl.textContent = `${total}d`;
    }
    if (unestimatedCountEl) {
      unestimatedCountEl.textContent = `${unestimated} unestimated`;
    }
  }

  // ============================================
  // TOAST NOTIFICATIONS
  // ============================================

  function showToast(message: string, type: string = ""): void {
    const existing = document.querySelector(".jee-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.className = "jee-toast" + (type ? ` ${type}` : "");
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => toast.remove(), 2000);
  }

  // ============================================
  // KEYBOARD SHORTCUTS
  // ============================================

  document.addEventListener("keydown", (e: KeyboardEvent) => {
    // Alt+E: Toggle estimate mode
    if (e.altKey && e.key === "e") {
      e.preventDefault();
      toggleEstimateMode();
    }

    // Escape: Close picker or exit mode
    if (e.key === "Escape") {
      if (currentPicker) {
        closePicker();
      } else if (estimateModeActive) {
        toggleEstimateMode(false);
      }
    }
  });

  // ============================================
  // MESSAGE LISTENERS (for popup integration)
  // ============================================

  chrome.runtime.onMessage.addListener(
    (
      message: Message,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response: MessageResponse) => void
    ) => {
      if (message.type === "GET_TICKETS") {
        scanTickets();
        const tickets: TicketInfo[] = [];
        ticketData.forEach((data, key) => {
          tickets.push({
            key,
            estimate: data.estimate,
            summary: findSummary(data.element),
            issueType: findIssueType(data.element),
          });
        });
        sendResponse({ tickets });
        return true;
      }

      if (
        message.type === "UPDATE_ESTIMATE" &&
        message.issueKey &&
        message.value !== undefined
      ) {
        setEstimate(message.issueKey, message.value)
          .then(() => sendResponse({ success: true }))
          .catch((err: Error) =>
            sendResponse({ success: false, error: err.message })
          );
        return true;
      }
    }
  );

  function findSummary(element: Element): string {
    const summarySelectors: string[] = [
      ".ghx-summary",
      ".ghx-inner",
      '[data-testid*="summary"]',
    ];
    for (const sel of summarySelectors) {
      const el = element.querySelector<HTMLElement>(sel);
      if (el) return el.textContent?.trim().substring(0, 100) || "";
    }
    return element.textContent?.trim().substring(0, 100) || "";
  }

  function findIssueType(element: Element): string {
    const typeImg = element.querySelector<HTMLImageElement>("img[alt]");
    if (typeImg) {
      const alt = typeImg.alt.toLowerCase();
      if (alt.includes("story")) return "story";
      if (alt.includes("bug")) return "bug";
      if (alt.includes("epic")) return "epic";
      if (alt.includes("subtask")) return "subtask";
    }
    return "task";
  }

  // ============================================
  // START
  // ============================================

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
