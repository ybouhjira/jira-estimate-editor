"use strict";
// Jira Estimate Editor - Content Script con TypeScript
// Clean UI design: No permanent icons, toggle-based estimate mode
(function () {
    console.log("😾 Jira Estimate Editor loaded");
    // ============================================
    // CONSTANTS
    // ============================================
    const ESTIMATE_VALUES = [0.1, 0.2, 0.5, 1, 1.5, 2, 3];
    // ============================================
    // STATE
    // ============================================
    let estimateModeActive = false;
    let currentPicker = null;
    let fab = null;
    let statusBar = null;
    let keyboardHint = null;
    let ticketData = new Map(); // issueKey -> {estimate, element}
    // ============================================
    // INITIALIZATION
    // ============================================
    function init() {
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
    function createFAB() {
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
                setTimeout(() => keyboardHint === null || keyboardHint === void 0 ? void 0 : keyboardHint.classList.remove("visible"), 3000);
            }
        });
        document.body.appendChild(fab);
    }
    function createStatusBar() {
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
        closeBtn === null || closeBtn === void 0 ? void 0 : closeBtn.addEventListener("click", () => {
            toggleEstimateMode(false);
        });
        document.body.appendChild(statusBar);
    }
    function createKeyboardHint() {
        keyboardHint = document.createElement("div");
        keyboardHint.className = "jee-keyboard-hint";
        keyboardHint.innerHTML = "Press <kbd>Alt</kbd>+<kbd>E</kbd> to toggle";
        document.body.appendChild(keyboardHint);
    }
    // ============================================
    // ESTIMATE MODE TOGGLE
    // ============================================
    function toggleEstimateMode(active) {
        if (active === undefined) {
            active = !estimateModeActive;
        }
        estimateModeActive = active;
        if (estimateModeActive) {
            enterEstimateMode();
        }
        else {
            exitEstimateMode();
        }
    }
    function enterEstimateMode() {
        console.log("😺 Entering estimate mode");
        document.body.classList.add("jee-estimate-mode-active");
        fab === null || fab === void 0 ? void 0 : fab.classList.add("active");
        statusBar === null || statusBar === void 0 ? void 0 : statusBar.classList.add("visible");
        scanTickets();
        addCardBadges();
        attachCardListeners();
        updateStatusBar();
    }
    function exitEstimateMode() {
        console.log("😺 Exiting estimate mode");
        document.body.classList.remove("jee-estimate-mode-active");
        fab === null || fab === void 0 ? void 0 : fab.classList.remove("active");
        statusBar === null || statusBar === void 0 ? void 0 : statusBar.classList.remove("visible");
        removeCardBadges();
        removeCardListeners();
        closePicker();
    }
    // ============================================
    // TICKET SCANNING
    // ============================================
    function scanTickets() {
        const cardSelectors = [
            ".ghx-issue",
            '[data-testid*="card"]',
            "[data-rbd-draggable-id]",
        ];
        const cards = document.querySelectorAll(cardSelectors.join(", "));
        console.log("😺 Found", cards.length, "cards");
        cards.forEach((card) => {
            const issueKey = findIssueKey(card);
            if (!issueKey)
                return;
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
    function findIssueKey(card) {
        var _a, _b;
        const keyAttr = card.getAttribute("data-issue-key");
        if (keyAttr)
            return keyAttr;
        const link = card.querySelector('a[href*="/browse/"]');
        if (link) {
            const match = link.href.match(/([A-Z][A-Z0-9]+-\d+)/);
            if (match)
                return match[1];
        }
        const keyEl = card.querySelector('.ghx-key a, [data-testid*="issue-key"]');
        if (keyEl) {
            const text = (_a = keyEl.textContent) === null || _a === void 0 ? void 0 : _a.trim();
            if (text && /^[A-Z][A-Z0-9]+-\d+$/.test(text))
                return text;
        }
        const textMatch = (_b = card.textContent) === null || _b === void 0 ? void 0 : _b.match(/([A-Z][A-Z0-9]+-\d+)/);
        return textMatch ? textMatch[1] : null;
    }
    function findEstimateOnCard(card) {
        var _a, _b;
        const estimateSelectors = [
            ".ghx-estimate",
            ".ghx-statistic-badge",
            '[data-tooltip*="Story Points"]',
            ".aui-badge",
            '[class*="storypoint"]',
            '[class*="estimate"]',
        ];
        for (const sel of estimateSelectors) {
            const el = card.querySelector(sel);
            if (el) {
                const val = parseFloat(((_a = el.textContent) === null || _a === void 0 ? void 0 : _a.trim()) || "");
                if (!isNaN(val) && val >= 0 && val <= 100) {
                    return val;
                }
            }
        }
        // Look for leaf nodes with numbers
        const allElements = card.querySelectorAll("*");
        for (const el of allElements) {
            if (el.children.length === 0) {
                const text = (_b = el.textContent) === null || _b === void 0 ? void 0 : _b.trim();
                if (text && /^[0-9]+\.?[0-9]*$/.test(text)) {
                    const val = parseFloat(text);
                    if (!isNaN(val) && val >= 0 && val <= 21) {
                        const parent = el.parentElement;
                        if (parent &&
                            (parent.classList.contains("ghx-stat-1") ||
                                parent.classList.contains("ghx-estimate") ||
                                parent.className.includes("statistic"))) {
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
    function addCardBadges() {
        ticketData.forEach((data, issueKey) => {
            if (data.element.querySelector(".jee-card-estimate-badge"))
                return;
            const badge = document.createElement("div");
            badge.className = "jee-card-estimate-badge";
            if (data.estimate !== null) {
                badge.textContent = `${data.estimate}d`;
                badge.classList.add("has-value");
            }
            else {
                badge.textContent = "-";
                badge.classList.add("no-value");
            }
            badge.dataset.issueKey = issueKey;
            const container = data.element.querySelector(".ghx-issue-content") ||
                data.element;
            container.appendChild(badge);
        });
    }
    function removeCardBadges() {
        document.querySelectorAll(".jee-card-estimate-badge").forEach((badge) => {
            badge.remove();
        });
    }
    function attachCardListeners() {
        ticketData.forEach((data, issueKey) => {
            const el = data.element;
            el.addEventListener("click", handleCardClick);
            el.dataset.jeeIssueKey = issueKey;
        });
    }
    function removeCardListeners() {
        ticketData.forEach((data) => {
            const el = data.element;
            el.removeEventListener("click", handleCardClick);
            delete el.dataset.jeeIssueKey;
        });
    }
    function handleCardClick(e) {
        // Don't intercept if clicking on a link or button
        if (e.target.closest("a, button, input, textarea"))
            return;
        e.preventDefault();
        e.stopPropagation();
        const issueKey = this.dataset.jeeIssueKey;
        if (!issueKey)
            return;
        const data = ticketData.get(issueKey);
        if (!data)
            return;
        showEstimatePicker(issueKey, data.estimate, e);
    }
    // ============================================
    // ESTIMATE PICKER
    // ============================================
    function showEstimatePicker(issueKey, currentEstimate, clickEvent) {
        closePicker();
        currentPicker = document.createElement("div");
        currentPicker.className = "jee-estimate-picker";
        currentPicker.innerHTML = `
      <div class="jee-estimate-picker-header">
        <span class="jee-estimate-picker-title">Estimate (days)</span>
        <span class="jee-estimate-picker-key">${issueKey}</span>
      </div>
      <div class="jee-estimate-picker-buttons">
        ${ESTIMATE_VALUES.map((val) => `
          <button class="jee-estimate-picker-btn${currentEstimate === val ? " active" : ""}"
                  data-value="${val}">${val}</button>
        `).join("")}
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
        const target = clickEvent.target;
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
        setTimeout(() => currentPicker === null || currentPicker === void 0 ? void 0 : currentPicker.classList.add("visible"), 10);
        // Add event listeners
        currentPicker
            .querySelectorAll(".jee-estimate-picker-btn")
            .forEach((btn) => {
            btn.addEventListener("click", async () => {
                const value = parseFloat(btn.dataset.value || "0");
                await setEstimate(issueKey, value);
                closePicker();
            });
        });
        const customInput = currentPicker.querySelector(".jee-estimate-picker-input");
        const setBtn = currentPicker.querySelector(".jee-estimate-picker-set");
        setBtn === null || setBtn === void 0 ? void 0 : setBtn.addEventListener("click", async () => {
            const value = parseFloat((customInput === null || customInput === void 0 ? void 0 : customInput.value) || "0");
            if (!isNaN(value) && value >= 0) {
                await setEstimate(issueKey, value);
                closePicker();
            }
        });
        customInput === null || customInput === void 0 ? void 0 : customInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                setBtn === null || setBtn === void 0 ? void 0 : setBtn.click();
            }
        });
        // Close on outside click
        setTimeout(() => {
            document.addEventListener("click", closePickerOnOutsideClick);
        }, 100);
    }
    function closePickerOnOutsideClick(e) {
        if (currentPicker && !currentPicker.contains(e.target)) {
            closePicker();
        }
    }
    function closePicker() {
        if (currentPicker) {
            currentPicker.remove();
            currentPicker = null;
            document.removeEventListener("click", closePickerOnOutsideClick);
        }
    }
    // ============================================
    // ESTIMATE UPDATE
    // ============================================
    async function setEstimate(issueKey, value) {
        console.log("😸 Setting estimate for", issueKey, "to", value);
        const success = await updateEstimateViaAPI(issueKey, value);
        if (success) {
            // Update local data
            const data = ticketData.get(issueKey);
            if (data) {
                data.estimate = value;
                // Update badge
                const badge = data.element.querySelector(".jee-card-estimate-badge");
                if (badge) {
                    badge.textContent = `${value}d`;
                    badge.classList.remove("no-value");
                    badge.classList.add("has-value");
                }
            }
            updateStatusBar();
            showToast(`✓ ${issueKey} → ${value}d`, "success");
        }
        else {
            showToast(`✗ Failed to update ${issueKey}`, "error");
        }
        return success;
    }
    async function updateEstimateViaAPI(issueKey, value) {
        const baseUrl = window.location.origin;
        try {
            const issueResponse = await fetch(`${baseUrl}/rest/api/2/issue/${issueKey}?expand=editmeta`, {
                credentials: "include",
                headers: { "Content-Type": "application/json" },
            });
            if (!issueResponse.ok) {
                throw new Error(`Failed to fetch issue: ${issueResponse.status}`);
            }
            const issueData = await issueResponse.json();
            const storyPointsFieldId = findStoryPointsField(issueData);
            if (!storyPointsFieldId) {
                throw new Error("Could not find story points field");
            }
            const updateResponse = await fetch(`${baseUrl}/rest/api/2/issue/${issueKey}`, {
                method: "PUT",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    fields: { [storyPointsFieldId]: value },
                }),
            });
            if (!updateResponse.ok) {
                throw new Error(`Update failed: ${updateResponse.status}`);
            }
            return true;
        }
        catch (error) {
            console.log("😿 Error updating estimate:", error);
            return false;
        }
    }
    function findStoryPointsField(issueData) {
        var _a, _b;
        // Check edit metadata
        if ((_a = issueData.editmeta) === null || _a === void 0 ? void 0 : _a.fields) {
            for (const [fieldId, fieldMeta] of Object.entries(issueData.editmeta.fields)) {
                const name = ((_b = fieldMeta.name) === null || _b === void 0 ? void 0 : _b.toLowerCase()) || "";
                if (name.includes("story point") ||
                    name.includes("estimate") ||
                    name.includes("points")) {
                    return fieldId;
                }
            }
        }
        // Common field IDs
        const commonFieldIds = [
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
            if (fieldId in fields)
                return fieldId;
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
    function updateStatusBar() {
        if (!statusBar)
            return;
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
    function showToast(message, type = "") {
        const existing = document.querySelector(".jee-toast");
        if (existing)
            existing.remove();
        const toast = document.createElement("div");
        toast.className = "jee-toast" + (type ? ` ${type}` : "");
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2000);
    }
    // ============================================
    // KEYBOARD SHORTCUTS
    // ============================================
    document.addEventListener("keydown", (e) => {
        // Alt+E: Toggle estimate mode
        if (e.altKey && e.key === "e") {
            e.preventDefault();
            toggleEstimateMode();
        }
        // Escape: Close picker or exit mode
        if (e.key === "Escape") {
            if (currentPicker) {
                closePicker();
            }
            else if (estimateModeActive) {
                toggleEstimateMode(false);
            }
        }
    });
    // ============================================
    // MESSAGE LISTENERS (for popup integration)
    // ============================================
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === "GET_TICKETS") {
            scanTickets();
            const tickets = [];
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
        if (message.type === "UPDATE_ESTIMATE" &&
            message.issueKey &&
            message.value !== undefined) {
            setEstimate(message.issueKey, message.value)
                .then(() => sendResponse({ success: true }))
                .catch((err) => sendResponse({ success: false, error: err.message }));
            return true;
        }
    });
    function findSummary(element) {
        var _a, _b;
        const summarySelectors = [
            ".ghx-summary",
            ".ghx-inner",
            '[data-testid*="summary"]',
        ];
        for (const sel of summarySelectors) {
            const el = element.querySelector(sel);
            if (el)
                return ((_a = el.textContent) === null || _a === void 0 ? void 0 : _a.trim().substring(0, 100)) || "";
        }
        return ((_b = element.textContent) === null || _b === void 0 ? void 0 : _b.trim().substring(0, 100)) || "";
    }
    function findIssueType(element) {
        const typeImg = element.querySelector("img[alt]");
        if (typeImg) {
            const alt = typeImg.alt.toLowerCase();
            if (alt.includes("story"))
                return "story";
            if (alt.includes("bug"))
                return "bug";
            if (alt.includes("epic"))
                return "epic";
            if (alt.includes("subtask"))
                return "subtask";
        }
        return "task";
    }
    // ============================================
    // START
    // ============================================
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    }
    else {
        init();
    }
})();
