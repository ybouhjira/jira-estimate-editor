"use strict";
// Jira Estimate Editor - Popup Script with TypeScript
// ============================================
// DOM ELEMENTS
// ============================================
const loading = document.getElementById("loading");
const notJiraPage = document.getElementById("notJiraPage");
const noTickets = document.getElementById("noTickets");
const ticketList = document.getElementById("ticketList");
const ticketsContainer = document.getElementById("tickets");
const ticketCount = document.getElementById("ticketCount");
const totalEstimate = document.getElementById("totalEstimate");
const refreshBtn = document.getElementById("refreshBtn");
const quickActions = document.getElementById("quickActions");
// ============================================
// STATE
// ============================================
let currentTickets = [];
// ============================================
// HELPER FUNCTIONS
// ============================================
async function getCurrentTab() {
    const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
    });
    return tab;
}
async function isJiraPage(tab) {
    if (!tab.url)
        return false;
    // Check for Jira Cloud
    if (tab.url.includes("atlassian.net"))
        return true;
    // Check for on-premise/self-hosted Jira (classic URLs)
    if (tab.url.includes("/secure/RapidBoard.jspa"))
        return true;
    if (tab.url.includes("/browse/"))
        return true;
    if (tab.url.includes("/projects/"))
        return true;
    if (tab.url.includes("/jira/"))
        return true;
    // Check for Jira in subdomain
    if (tab.url.includes("jira."))
        return true;
    return false;
}
// ============================================
// TICKET SCANNING
// ============================================
async function scanForTickets() {
    var _a;
    loading === null || loading === void 0 ? void 0 : loading.classList.remove("hidden");
    notJiraPage === null || notJiraPage === void 0 ? void 0 : notJiraPage.classList.add("hidden");
    noTickets === null || noTickets === void 0 ? void 0 : noTickets.classList.add("hidden");
    ticketList === null || ticketList === void 0 ? void 0 : ticketList.classList.add("hidden");
    quickActions === null || quickActions === void 0 ? void 0 : quickActions.classList.add("hidden");
    const tab = await getCurrentTab();
    if (!(await isJiraPage(tab))) {
        loading === null || loading === void 0 ? void 0 : loading.classList.add("hidden");
        notJiraPage === null || notJiraPage === void 0 ? void 0 : notJiraPage.classList.remove("hidden");
        return;
    }
    try {
        if (!tab.id) {
            throw new Error("Tab ID not found");
        }
        const results = await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: extractTickets,
        });
        const tickets = ((_a = results[0]) === null || _a === void 0 ? void 0 : _a.result) || [];
        currentTickets = tickets;
        loading === null || loading === void 0 ? void 0 : loading.classList.add("hidden");
        if (tickets.length === 0) {
            noTickets === null || noTickets === void 0 ? void 0 : noTickets.classList.remove("hidden");
            return;
        }
        renderTickets(tickets);
        ticketList === null || ticketList === void 0 ? void 0 : ticketList.classList.remove("hidden");
        quickActions === null || quickActions === void 0 ? void 0 : quickActions.classList.remove("hidden");
    }
    catch (error) {
        console.log("😾 Error scanning for tickets:", error);
        loading === null || loading === void 0 ? void 0 : loading.classList.add("hidden");
        notJiraPage === null || notJiraPage === void 0 ? void 0 : notJiraPage.classList.remove("hidden");
    }
}
// ============================================
// TICKET EXTRACTION (runs in page context)
// ============================================
function extractTickets() {
    const tickets = [];
    // Try multiple selectors for different Jira views
    const selectors = [
        // Board view cards
        '[data-testid="platform-board-kit.ui.card.card"]',
        '[data-testid="software-board.board-container.board.card-container.card"]',
        // Backlog items
        '[data-testid="software-backlog.backlog-content.backlog-list-row"]',
        '[data-testid="platform-board-kit.ui.swimlane.swimlane-content"] [data-testid*="card"]',
        // List view
        ".ghx-issue",
        ".js-issue",
        // New Jira UI
        '[data-testid*="issue-line-card"]',
        "[data-rbd-draggable-id]",
        // Generic issue containers
        "[data-issue-key]",
    ];
    for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        elements.forEach((el) => {
            const ticketData = extractTicketData(el);
            if (ticketData && !tickets.find((t) => t.key === ticketData.key)) {
                tickets.push(ticketData);
            }
        });
    }
    // Also try to find issue keys directly
    const issueKeyPattern = /[A-Z][A-Z0-9]+-\d+/g;
    const issueLinks = document.querySelectorAll('a[href*="/browse/"]');
    issueLinks.forEach((link) => {
        const href = link.getAttribute("href");
        const match = href === null || href === void 0 ? void 0 : href.match(issueKeyPattern);
        if (match) {
            const key = match[0];
            if (!tickets.find((t) => t.key === key)) {
                const container = link.closest("[data-testid], .ghx-issue, [data-rbd-draggable-id]") ||
                    link.parentElement;
                const summary = findSummary(container, link);
                const estimate = findEstimate(container);
                const issueType = findIssueType(container);
                tickets.push({
                    key,
                    summary: summary || key,
                    estimate: estimate,
                    issueType: issueType,
                    element: null,
                });
            }
        }
    });
    return tickets;
    function extractTicketData(element) {
        var _a, _b, _c;
        // Find issue key
        const keyEl = element.querySelector('[data-testid*="issue-key"], .ghx-key, [data-issue-key]');
        const keyLink = element.querySelector('a[href*="/browse/"]');
        let key = ((_a = keyEl === null || keyEl === void 0 ? void 0 : keyEl.textContent) === null || _a === void 0 ? void 0 : _a.trim()) || (keyEl === null || keyEl === void 0 ? void 0 : keyEl.getAttribute("data-issue-key"));
        if (!key && keyLink) {
            const match = (_b = keyLink.href) === null || _b === void 0 ? void 0 : _b.match(/[A-Z][A-Z0-9]+-\d+/);
            key = match === null || match === void 0 ? void 0 : match[0];
        }
        if (!key) {
            const textMatch = (_c = element.textContent) === null || _c === void 0 ? void 0 : _c.match(/[A-Z][A-Z0-9]+-\d+/);
            key = textMatch === null || textMatch === void 0 ? void 0 : textMatch[0];
        }
        if (!key)
            return null;
        const summary = findSummary(element);
        const estimate = findEstimate(element);
        const issueType = findIssueType(element);
        return {
            key,
            summary: summary || key,
            estimate,
            issueType,
        };
    }
    function findSummary(element, excludeEl = null) {
        var _a, _b;
        if (!element)
            return null;
        const summarySelectors = [
            '[data-testid*="summary"]',
            ".ghx-summary",
            ".ghx-inner",
            '[data-testid*="issue-field-summary"]',
        ];
        for (const sel of summarySelectors) {
            const el = element.querySelector(sel);
            if (el && el !== excludeEl) {
                return ((_a = el.textContent) === null || _a === void 0 ? void 0 : _a.trim()) || null;
            }
        }
        // Get text content excluding the key
        const clone = element.cloneNode(true);
        const keyEls = clone.querySelectorAll('a[href*="/browse/"], [data-testid*="issue-key"]');
        keyEls.forEach((el) => el.remove());
        const text = (_b = clone.textContent) === null || _b === void 0 ? void 0 : _b.trim().substring(0, 100);
        return text || null;
    }
    function findEstimate(element) {
        var _a, _b;
        if (!element)
            return null;
        // Look for story points field
        const estimateSelectors = [
            ".ghx-estimate", // Classic board estimate
            ".ghx-statistic-badge", // Statistic badge
            '[data-testid*="story-point"]',
            '[data-testid*="estimate"]',
            '[data-field-id*="customfield"]',
            ".aui-badge",
            '[class*="storypoint"]',
            '[class*="estimate"]',
        ];
        for (const sel of estimateSelectors) {
            const el = element.querySelector(sel);
            if (el) {
                const val = parseFloat(((_a = el.textContent) === null || _a === void 0 ? void 0 : _a.trim()) || "");
                if (!isNaN(val) && val >= 0 && val <= 100)
                    return val;
            }
        }
        // Look for leaf nodes with just numbers that could be estimates
        const allElements = Array.from(element.querySelectorAll("*"));
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
    function findIssueType(element) {
        var _a;
        if (!element)
            return "task";
        const typeEl = element.querySelector('[data-testid*="issue-type"], .ghx-type, [class*="issue-type"]');
        const typeImg = element.querySelector('img[alt*="Story"], img[alt*="Bug"], img[alt*="Task"], img[alt*="Epic"]');
        if (typeImg) {
            const alt = typeImg.alt.toLowerCase();
            if (alt.includes("story"))
                return "story";
            if (alt.includes("bug"))
                return "bug";
            if (alt.includes("task"))
                return "task";
            if (alt.includes("epic"))
                return "epic";
            if (alt.includes("subtask"))
                return "subtask";
        }
        const typeText = ((_a = typeEl === null || typeEl === void 0 ? void 0 : typeEl.textContent) === null || _a === void 0 ? void 0 : _a.toLowerCase()) || element.className.toLowerCase();
        if (typeText.includes("story"))
            return "story";
        if (typeText.includes("bug"))
            return "bug";
        if (typeText.includes("task"))
            return "task";
        if (typeText.includes("epic"))
            return "epic";
        if (typeText.includes("subtask"))
            return "subtask";
        return "task";
    }
}
// ============================================
// RENDERING
// ============================================
function renderTickets(tickets) {
    if (!ticketsContainer)
        return;
    ticketsContainer.innerHTML = "";
    let total = 0;
    let estimated = 0;
    tickets.forEach((ticket) => {
        if (ticket.estimate !== null) {
            total += ticket.estimate;
            estimated++;
        }
        const div = document.createElement("div");
        div.className = "ticket-item";
        div.innerHTML = `
      <span class="issue-type ${ticket.issueType}">${getTypeIcon(ticket.issueType)}</span>
      <a href="#" class="ticket-key" data-key="${ticket.key}">${ticket.key}</a>
      <span class="ticket-summary" title="${escapeHtml(ticket.summary)}">${escapeHtml(ticket.summary)}</span>
      <div class="estimate-input-wrapper">
        <input type="number"
               class="estimate-input"
               data-key="${ticket.key}"
               value="${ticket.estimate !== null ? ticket.estimate : ""}"
               placeholder="-"
               min="0"
               step="0.5">
      </div>
    `;
        ticketsContainer.appendChild(div);
    });
    if (!ticketCount || !totalEstimate) {
        console.error("Missing ticketCount or totalEstimate elements");
        return;
    }
    ticketCount.textContent = `${tickets.length} tickets (${estimated} estimated)`;
    totalEstimate.textContent = `Total: ${total} pts`;
    // Add event listeners
    ticketsContainer
        .querySelectorAll(".estimate-input")
        .forEach((input) => {
        input.addEventListener("change", handleEstimateChange);
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                input.blur();
            }
        });
    });
    ticketsContainer
        .querySelectorAll(".ticket-key")
        .forEach((link) => {
        link.addEventListener("click", async (e) => {
            e.preventDefault();
            const key = link.dataset.key;
            if (!key)
                return;
            const tab = await getCurrentTab();
            if (!tab.url)
                return;
            const baseUrl = new URL(tab.url).origin;
            chrome.tabs.create({ url: `${baseUrl}/browse/${key}` });
        });
    });
}
function getTypeIcon(type) {
    const icons = {
        story: "📖",
        bug: "🐛",
        task: "✓",
        epic: "⚡",
        subtask: "◇",
    };
    return icons[type] || "•";
}
function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}
// ============================================
// ESTIMATE UPDATE
// ============================================
async function handleEstimateChange(e) {
    const input = e.target;
    const key = input.dataset.key;
    if (!key)
        return;
    const value = input.value ? parseFloat(input.value) : null;
    input.classList.remove("saved", "error");
    input.classList.add("saving");
    const tab = await getCurrentTab();
    if (!tab.id) {
        input.classList.remove("saving");
        input.classList.add("error");
        return;
    }
    try {
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: updateEstimateInJira,
            args: [key, value],
        });
        input.classList.remove("saving");
        input.classList.add("saved");
        // Update totals
        updateTotals();
        setTimeout(() => {
            input.classList.remove("saved");
        }, 2000);
    }
    catch (error) {
        console.log("😾 Error updating estimate:", error);
        input.classList.remove("saving");
        input.classList.add("error");
    }
}
function updateEstimateInJira(issueKey, value) {
    // This function runs in the context of the Jira page
    console.log("😾 Updating estimate for", issueKey, "to", value);
    // Find the issue on the page and try to update it
    // This is a simplified version - full implementation would use Jira's API
    // For board view, try to find and click the card to open quick edit
    const selectors = [
        `[data-issue-key="${issueKey}"]`,
        `a[href*="/browse/${issueKey}"]`,
    ];
    for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) {
            // Store the update request - the content script will handle it
            window.postMessage({
                type: "JIRA_ESTIMATE_UPDATE",
                issueKey,
                value,
            }, "*");
            return true;
        }
    }
    return false;
}
function updateTotals() {
    if (!ticketsContainer || !ticketCount || !totalEstimate)
        return;
    const inputs = ticketsContainer.querySelectorAll(".estimate-input");
    let total = 0;
    let estimated = 0;
    inputs.forEach((input) => {
        const val = parseFloat(input.value);
        if (!isNaN(val)) {
            total += val;
            estimated++;
        }
    });
    ticketCount.textContent = `${inputs.length} tickets (${estimated} estimated)`;
    totalEstimate.textContent = `Total: ${total} pts`;
}
// ============================================
// QUICK ACTIONS
// ============================================
document.querySelectorAll(".estimate-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
        const valueStr = btn.dataset.value;
        if (!valueStr || !ticketsContainer)
            return;
        const value = parseFloat(valueStr);
        const inputs = ticketsContainer.querySelectorAll(".estimate-input");
        for (const input of Array.from(inputs)) {
            if (!input.value) {
                input.value = value.toString();
                input.dispatchEvent(new Event("change"));
                await new Promise((r) => setTimeout(r, 100));
            }
        }
    });
});
// ============================================
// EVENT LISTENERS
// ============================================
refreshBtn === null || refreshBtn === void 0 ? void 0 : refreshBtn.addEventListener("click", scanForTickets);
// ============================================
// INITIALIZATION
// ============================================
document.addEventListener("DOMContentLoaded", async () => {
    await scanForTickets();
});
