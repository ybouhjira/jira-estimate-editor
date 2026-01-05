// Jira Estimate Editor - Popup Script with TypeScript

// ============================================
// CHROME API TYPES (remove if using @types/chrome)
// ============================================

// ============================================
// TYPES
// ============================================

interface TicketDataPopup {
  key: string;
  summary: string;
  estimate: number | null;
  issueType: string;
  element?: Element | null;
}

interface PostMessageData {
  type: string;
  issueKey: string;
  value: number | null;
}

// ============================================
// DOM ELEMENTS
// ============================================

const loading = document.getElementById("loading") as HTMLDivElement | null;
const notJiraPage = document.getElementById(
  "notJiraPage"
) as HTMLDivElement | null;
const noTickets = document.getElementById("noTickets") as HTMLDivElement | null;
const ticketList = document.getElementById(
  "ticketList"
) as HTMLDivElement | null;
const ticketsContainer = document.getElementById(
  "tickets"
) as HTMLDivElement | null;
const ticketCount = document.getElementById(
  "ticketCount"
) as HTMLSpanElement | null;
const totalEstimate = document.getElementById(
  "totalEstimate"
) as HTMLSpanElement | null;
const refreshBtn = document.getElementById(
  "refreshBtn"
) as HTMLButtonElement | null;
const quickActions = document.getElementById(
  "quickActions"
) as HTMLDivElement | null;

// ============================================
// STATE
// ============================================

let currentTickets: TicketDataPopup[] = [];

// ============================================
// HELPER FUNCTIONS
// ============================================

async function getCurrentTab(): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  return tab;
}

async function isJiraPage(tab: chrome.tabs.Tab): Promise<boolean> {
  if (!tab.url) return false;
  // Check for Jira Cloud
  if (tab.url.includes("atlassian.net")) return true;
  // Check for on-premise/self-hosted Jira (classic URLs)
  if (tab.url.includes("/secure/RapidBoard.jspa")) return true;
  if (tab.url.includes("/browse/")) return true;
  if (tab.url.includes("/projects/")) return true;
  if (tab.url.includes("/jira/")) return true;
  // Check for Jira in subdomain
  if (tab.url.includes("jira.")) return true;
  return false;
}

// ============================================
// TICKET SCANNING
// ============================================

async function scanForTickets(): Promise<void> {
  loading?.classList.remove("hidden");
  notJiraPage?.classList.add("hidden");
  noTickets?.classList.add("hidden");
  ticketList?.classList.add("hidden");
  quickActions?.classList.add("hidden");

  const tab = await getCurrentTab();

  if (!(await isJiraPage(tab))) {
    loading?.classList.add("hidden");
    notJiraPage?.classList.remove("hidden");
    return;
  }

  try {
    if (!tab.id) {
      throw new Error("Tab ID not found");
    }

    const results = await chrome.scripting.executeScript<[], TicketDataPopup[]>(
      {
        target: { tabId: tab.id },
        func: extractTickets,
      }
    );

    const tickets = results[0]?.result || [];
    currentTickets = tickets;

    loading?.classList.add("hidden");

    if (tickets.length === 0) {
      noTickets?.classList.remove("hidden");
      return;
    }

    renderTickets(tickets);
    ticketList?.classList.remove("hidden");
    quickActions?.classList.remove("hidden");
  } catch (error) {
    console.log("😾 Error scanning for tickets:", error);
    loading?.classList.add("hidden");
    notJiraPage?.classList.remove("hidden");
  }
}

// ============================================
// TICKET EXTRACTION (runs in page context)
// ============================================

function extractTickets(): TicketDataPopup[] {
  const tickets: TicketDataPopup[] = [];

  // Try multiple selectors for different Jira views
  const selectors: string[] = [
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
  const issueLinks = document.querySelectorAll<HTMLAnchorElement>(
    'a[href*="/browse/"]'
  );

  issueLinks.forEach((link) => {
    const href = link.getAttribute("href");
    const match = href?.match(issueKeyPattern);
    if (match) {
      const key = match[0];
      if (!tickets.find((t) => t.key === key)) {
        const container =
          link.closest("[data-testid], .ghx-issue, [data-rbd-draggable-id]") ||
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

  function extractTicketData(element: Element): TicketDataPopup | null {
    // Find issue key
    const keyEl = element.querySelector<HTMLElement>(
      '[data-testid*="issue-key"], .ghx-key, [data-issue-key]'
    );
    const keyLink = element.querySelector<HTMLAnchorElement>(
      'a[href*="/browse/"]'
    );
    let key =
      keyEl?.textContent?.trim() || keyEl?.getAttribute("data-issue-key");

    if (!key && keyLink) {
      const match = keyLink.href?.match(/[A-Z][A-Z0-9]+-\d+/);
      key = match?.[0];
    }

    if (!key) {
      const textMatch = element.textContent?.match(/[A-Z][A-Z0-9]+-\d+/);
      key = textMatch?.[0];
    }

    if (!key) return null;

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

  function findSummary(
    element: Element | null,
    excludeEl: Element | null = null
  ): string | null {
    if (!element) return null;

    const summarySelectors: string[] = [
      '[data-testid*="summary"]',
      ".ghx-summary",
      ".ghx-inner",
      '[data-testid*="issue-field-summary"]',
    ];

    for (const sel of summarySelectors) {
      const el = element.querySelector<HTMLElement>(sel);
      if (el && el !== excludeEl) {
        return el.textContent?.trim() || null;
      }
    }

    // Get text content excluding the key
    const clone = element.cloneNode(true) as Element;
    const keyEls = clone.querySelectorAll(
      'a[href*="/browse/"], [data-testid*="issue-key"]'
    );
    keyEls.forEach((el) => el.remove());
    const text = clone.textContent?.trim().substring(0, 100);
    return text || null;
  }

  function findEstimate(element: Element | null): number | null {
    if (!element) return null;

    // Look for story points field
    const estimateSelectors: string[] = [
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
      const el = element.querySelector<HTMLElement>(sel);
      if (el) {
        const val = parseFloat(el.textContent?.trim() || "");
        if (!isNaN(val) && val >= 0 && val <= 100) return val;
      }
    }

    // Look for leaf nodes with just numbers that could be estimates
    const allElements = Array.from(element.querySelectorAll<HTMLElement>("*"));
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

  function findIssueType(element: Element | null): string {
    if (!element) return "task";

    const typeEl = element.querySelector<HTMLElement>(
      '[data-testid*="issue-type"], .ghx-type, [class*="issue-type"]'
    );
    const typeImg = element.querySelector<HTMLImageElement>(
      'img[alt*="Story"], img[alt*="Bug"], img[alt*="Task"], img[alt*="Epic"]'
    );

    if (typeImg) {
      const alt = typeImg.alt.toLowerCase();
      if (alt.includes("story")) return "story";
      if (alt.includes("bug")) return "bug";
      if (alt.includes("task")) return "task";
      if (alt.includes("epic")) return "epic";
      if (alt.includes("subtask")) return "subtask";
    }

    const typeText =
      typeEl?.textContent?.toLowerCase() || element.className.toLowerCase();
    if (typeText.includes("story")) return "story";
    if (typeText.includes("bug")) return "bug";
    if (typeText.includes("task")) return "task";
    if (typeText.includes("epic")) return "epic";
    if (typeText.includes("subtask")) return "subtask";

    return "task";
  }
}

// ============================================
// RENDERING
// ============================================

function renderTickets(tickets: TicketDataPopup[]): void {
  if (!ticketsContainer) return;

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
      <span class="issue-type ${ticket.issueType}">${getTypeIcon(
      ticket.issueType
    )}</span>
      <a href="#" class="ticket-key" data-key="${ticket.key}">${ticket.key}</a>
      <span class="ticket-summary" title="${escapeHtml(
        ticket.summary
      )}">${escapeHtml(ticket.summary)}</span>
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
    .querySelectorAll<HTMLInputElement>(".estimate-input")
    .forEach((input) => {
      input.addEventListener("change", handleEstimateChange);
      input.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter") {
          input.blur();
        }
      });
    });

  ticketsContainer
    .querySelectorAll<HTMLAnchorElement>(".ticket-key")
    .forEach((link) => {
      link.addEventListener("click", async (e: MouseEvent) => {
        e.preventDefault();
        const key = link.dataset.key;
        if (!key) return;

        const tab = await getCurrentTab();
        if (!tab.url) return;

        const baseUrl = new URL(tab.url).origin;
        chrome.tabs.create({ url: `${baseUrl}/browse/${key}` });
      });
    });
}

function getTypeIcon(type: string): string {
  const icons: Record<string, string> = {
    story: "📖",
    bug: "🐛",
    task: "✓",
    epic: "⚡",
    subtask: "◇",
  };
  return icons[type] || "•";
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// ============================================
// ESTIMATE UPDATE
// ============================================

async function handleEstimateChange(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const key = input.dataset.key;
  if (!key) return;

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
    await chrome.scripting.executeScript<[string, number | null], boolean>({
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
  } catch (error) {
    console.log("😾 Error updating estimate:", error);
    input.classList.remove("saving");
    input.classList.add("error");
  }
}

function updateEstimateInJira(issueKey: string, value: number | null): boolean {
  // This function runs in the context of the Jira page
  console.log("😾 Updating estimate for", issueKey, "to", value);

  // Find the issue on the page and try to update it
  // This is a simplified version - full implementation would use Jira's API

  // For board view, try to find and click the card to open quick edit
  const selectors: string[] = [
    `[data-issue-key="${issueKey}"]`,
    `a[href*="/browse/${issueKey}"]`,
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) {
      // Store the update request - the content script will handle it
      window.postMessage(
        {
          type: "JIRA_ESTIMATE_UPDATE",
          issueKey,
          value,
        } as PostMessageData,
        "*"
      );
      return true;
    }
  }

  return false;
}

function updateTotals(): void {
  if (!ticketsContainer || !ticketCount || !totalEstimate) return;

  const inputs =
    ticketsContainer.querySelectorAll<HTMLInputElement>(".estimate-input");
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

document.querySelectorAll<HTMLButtonElement>(".estimate-btn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const valueStr = btn.dataset.value;
    if (!valueStr || !ticketsContainer) return;

    const value = parseFloat(valueStr);
    const inputs =
      ticketsContainer.querySelectorAll<HTMLInputElement>(".estimate-input");

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

refreshBtn?.addEventListener("click", scanForTickets);

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener("DOMContentLoaded", async () => {
  await scanForTickets();
});
