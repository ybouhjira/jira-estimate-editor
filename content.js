// Jira Estimate Editor - Content Script
// This script runs on Jira pages and handles estimate updates

(function() {
  console.log('😾 Jira Estimate Editor loaded');

  const ESTIMATE_VALUES = [0.1, 0.2, 0.5, 1, 1.5, 2, 3];
  let iconsAdded = false;

  // Listen for messages from the popup
  window.addEventListener('message', async (event) => {
    if (event.data.type === 'JIRA_ESTIMATE_UPDATE') {
      const { issueKey, value } = event.data;
      console.log('😸 Received estimate update request:', issueKey, value);
      await updateEstimate(issueKey, value);
    }
  });

  // Also listen for chrome runtime messages
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'UPDATE_ESTIMATE') {
      updateEstimate(message.issueKey, message.value)
        .then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (message.type === 'GET_TICKETS') {
      const tickets = extractAllTickets();
      sendResponse({ tickets });
      return true;
    }
  });

  // Initialize: add icons to cards
  function init() {
    console.log('😺 Initializing estimate icons');
    addEstimateIconsToCards();

    // Re-add icons when DOM changes (Jira is very dynamic)
    const observer = new MutationObserver((mutations) => {
      let shouldUpdate = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          shouldUpdate = true;
          break;
        }
      }
      if (shouldUpdate) {
        setTimeout(addEstimateIconsToCards, 100);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function addEstimateIconsToCards() {
    // Find all Jira cards (on-premise uses ghx-issue class)
    const cardSelectors = [
      '.ghx-issue',
      '.ghx-issue-content',
      '[data-testid*="card"]',
      '[data-rbd-draggable-id]'
    ];

    const cards = document.querySelectorAll(cardSelectors.join(', '));
    console.log('😺 Found', cards.length, 'cards');

    cards.forEach(card => {
      // Skip if already has our icon
      if (card.querySelector('.jee-estimate-icon')) return;

      // Find the issue key
      const issueKey = findIssueKey(card);
      if (!issueKey) return;

      // Find current estimate
      const currentEstimate = findEstimateOnCard(card);

      // Create the icon with popup
      const icon = createEstimateIcon(issueKey, currentEstimate);

      // Add to card - find the best container
      const container = card.querySelector('.ghx-issue-content') || card;
      container.style.position = 'relative';
      container.appendChild(icon);
    });
  }

  function findIssueKey(card) {
    // Try data attribute
    const keyAttr = card.getAttribute('data-issue-key');
    if (keyAttr) return keyAttr;

    // Try link
    const link = card.querySelector('a[href*="/browse/"]');
    if (link) {
      const match = link.href.match(/([A-Z][A-Z0-9]+-\d+)/);
      if (match) return match[1];
    }

    // Try key element
    const keyEl = card.querySelector('.ghx-key a, [data-testid*="issue-key"]');
    if (keyEl) {
      const text = keyEl.textContent?.trim();
      if (text && /^[A-Z][A-Z0-9]+-\d+$/.test(text)) return text;
    }

    // Try text content
    const textMatch = card.textContent?.match(/([A-Z][A-Z0-9]+-\d+)/);
    return textMatch ? textMatch[1] : null;
  }

  function findEstimateOnCard(card) {
    // On-premise Jira often shows estimates in specific elements
    const estimateSelectors = [
      '.ghx-estimate',                    // Classic board estimate
      '.ghx-statistic-badge',             // Statistic badge
      '[data-tooltip*="Story Points"]',   // Story points tooltip
      '.aui-badge',                        // AUI badge
      '[class*="storypoint"]',            // Story point class
      '[class*="estimate"]'               // Estimate class
    ];

    for (const sel of estimateSelectors) {
      const el = card.querySelector(sel);
      if (el) {
        const text = el.textContent?.trim();
        const val = parseFloat(text);
        if (!isNaN(val) && val >= 0 && val <= 100) {
          console.log('😺 Found estimate', val, 'for card using selector', sel);
          return val;
        }
      }
    }

    // Look for any element with just a number that could be an estimate
    const allElements = card.querySelectorAll('*');
    for (const el of allElements) {
      if (el.children.length === 0) { // Leaf nodes only
        const text = el.textContent?.trim();
        // Match numbers like 0.5, 1, 2, 3, etc.
        if (/^[0-9]+\.?[0-9]*$/.test(text)) {
          const val = parseFloat(text);
          if (!isNaN(val) && val >= 0 && val <= 21) {
            // Check if this looks like an estimate (small number in a badge-like element)
            const styles = window.getComputedStyle(el);
            const parent = el.parentElement;
            if (parent && (
              parent.classList.contains('ghx-stat-1') ||
              parent.classList.contains('ghx-estimate') ||
              styles.fontWeight === '700' ||
              styles.fontWeight === 'bold'
            )) {
              console.log('😺 Found estimate', val, 'in leaf node');
              return val;
            }
          }
        }
      }
    }

    return null;
  }

  function createEstimateIcon(issueKey, currentEstimate) {
    const icon = document.createElement('div');
    icon.className = 'jee-estimate-icon' + (currentEstimate !== null ? ' has-value' : '');
    icon.textContent = currentEstimate !== null ? currentEstimate : '⏱';
    icon.dataset.issueKey = issueKey;

    // Create popup
    const popup = document.createElement('div');
    popup.className = 'jee-estimate-popup';
    popup.innerHTML = `
      <div class="jee-estimate-popup-title">Days</div>
      <div class="jee-estimate-popup-buttons">
        ${ESTIMATE_VALUES.map(val => `
          <button class="jee-estimate-popup-btn${currentEstimate === val ? ' active' : ''}"
                  data-value="${val}">${val}</button>
        `).join('')}
      </div>
    `;

    // Add click handlers to buttons
    popup.querySelectorAll('.jee-estimate-popup-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        e.preventDefault();

        const value = parseFloat(btn.dataset.value);
        console.log('😸 Setting estimate for', issueKey, 'to', value);

        icon.classList.add('loading');
        icon.textContent = '...';

        const success = await updateEstimate(issueKey, value);

        icon.classList.remove('loading');

        if (success) {
          icon.textContent = value;
          icon.classList.add('has-value');

          // Update active state
          popup.querySelectorAll('.jee-estimate-popup-btn').forEach(b => {
            b.classList.toggle('active', parseFloat(b.dataset.value) === value);
          });

          showToast(`✓ ${issueKey} → ${value}d`, 'success');
        } else {
          icon.textContent = currentEstimate !== null ? currentEstimate : '⏱';
          showToast(`✗ Failed to update ${issueKey}`, 'error');
        }
      });
    });

    icon.appendChild(popup);
    return icon;
  }

  async function updateEstimate(issueKey, value) {
    console.log('😼 Attempting to update estimate for', issueKey, 'to', value);

    const baseUrl = window.location.origin;

    try {
      // First, get the issue to find the story points field ID
      const issueResponse = await fetch(`${baseUrl}/rest/api/2/issue/${issueKey}?expand=editmeta`, {
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!issueResponse.ok) {
        console.log('😿 Failed to fetch issue:', issueResponse.status);
        throw new Error(`Failed to fetch issue: ${issueResponse.status}`);
      }

      const issueData = await issueResponse.json();
      console.log('😺 Got issue data:', issueKey);

      // Find the story points field
      const storyPointsFieldId = findStoryPointsField(issueData);

      if (!storyPointsFieldId) {
        console.log('😿 Could not find story points field');
        throw new Error('Could not find story points field');
      }

      console.log('😸 Found story points field:', storyPointsFieldId);

      // Update the estimate
      const updatePayload = {
        fields: {
          [storyPointsFieldId]: value
        }
      };

      const updateResponse = await fetch(`${baseUrl}/rest/api/2/issue/${issueKey}`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(updatePayload)
      });

      if (!updateResponse.ok) {
        const errorText = await updateResponse.text();
        console.log('😿 Update failed:', errorText);
        throw new Error(`Update failed: ${updateResponse.status}`);
      }

      console.log('😻 Successfully updated estimate for', issueKey);
      return true;
    } catch (error) {
      console.log('😿 Error updating estimate:', error);
      return false;
    }
  }

  function findStoryPointsField(issueData) {
    // Check edit metadata first
    if (issueData.editmeta?.fields) {
      for (const [fieldId, fieldMeta] of Object.entries(issueData.editmeta.fields)) {
        const name = fieldMeta.name?.toLowerCase() || '';
        if (name.includes('story point') ||
            name.includes('estimate') ||
            name.includes('points')) {
          return fieldId;
        }
      }
    }

    // Check actual fields
    const fields = issueData.fields || {};

    // Common story points field IDs
    const commonFieldIds = [
      'customfield_10016',
      'customfield_10004',
      'customfield_10006',
      'customfield_10026',
      'customfield_10002',
      'customfield_10014',
      'customfield_10034'
    ];

    for (const fieldId of commonFieldIds) {
      if (fieldId in fields) {
        return fieldId;
      }
    }

    // Look for any numeric custom field
    for (const [key, value] of Object.entries(fields)) {
      if (key.startsWith('customfield_') && typeof value === 'number') {
        return key;
      }
    }

    return 'customfield_10016'; // Default fallback
  }

  function showToast(message, type = '') {
    const existing = document.querySelector('.jee-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'jee-toast' + (type ? ` ${type}` : '');
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => toast.remove(), 3000);
  }

  function extractAllTickets() {
    const tickets = [];
    const seen = new Set();

    // Find all cards
    const cardSelectors = [
      '.ghx-issue',
      '[data-testid*="card"]',
      '[data-rbd-draggable-id]'
    ];

    document.querySelectorAll(cardSelectors.join(', ')).forEach(card => {
      const key = findIssueKey(card);
      if (key && !seen.has(key)) {
        seen.add(key);
        tickets.push({
          key,
          summary: findSummary(card),
          estimate: findEstimateOnCard(card),
          issueType: findIssueType(card)
        });
      }
    });

    // Also find via links
    const issueLinks = document.querySelectorAll('a[href*="/browse/"]');
    issueLinks.forEach(link => {
      const match = link.href?.match(/([A-Z][A-Z0-9]+-\d+)/);
      if (match && !seen.has(match[1])) {
        seen.add(match[1]);
        const container = link.closest('.ghx-issue, [data-testid*="card"], [data-rbd-draggable-id]') || link.parentElement;
        tickets.push({
          key: match[1],
          summary: findSummary(container),
          estimate: findEstimateOnCard(container),
          issueType: findIssueType(container)
        });
      }
    });

    console.log('😺 Extracted', tickets.length, 'tickets');
    return tickets;
  }

  function findSummary(element) {
    if (!element) return '';

    const summarySelectors = [
      '.ghx-summary',
      '.ghx-inner',
      '[data-testid*="summary"]'
    ];

    for (const sel of summarySelectors) {
      const el = element.querySelector(sel);
      if (el) {
        return el.textContent?.trim().substring(0, 100) || '';
      }
    }

    return element.textContent?.trim().substring(0, 100) || '';
  }

  function findIssueType(element) {
    if (!element) return 'task';

    const typeImg = element.querySelector('img[alt]');
    if (typeImg) {
      const alt = typeImg.alt.toLowerCase();
      if (alt.includes('story')) return 'story';
      if (alt.includes('bug')) return 'bug';
      if (alt.includes('epic')) return 'epic';
      if (alt.includes('subtask')) return 'subtask';
    }

    return 'task';
  }

  // Add keyboard shortcut
  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.key === 'e') {
      e.preventDefault();
      toggleEstimateOverlay();
    }
  });

  let overlayVisible = false;

  function toggleEstimateOverlay() {
    if (overlayVisible) {
      removeEstimateOverlay();
      return;
    }

    const tickets = extractAllTickets();
    if (tickets.length === 0) {
      console.log('😿 No tickets found on page');
      return;
    }

    createEstimateOverlay(tickets);
    overlayVisible = true;
  }

  function createEstimateOverlay(tickets) {
    const overlay = document.createElement('div');
    overlay.id = 'jira-estimate-overlay';
    overlay.innerHTML = `
      <div class="jee-overlay-content">
        <div class="jee-header">
          <h2>📊 Quick Estimate Editor</h2>
          <button class="jee-close">&times;</button>
        </div>
        <div class="jee-tickets">
          ${tickets.map(t => `
            <div class="jee-ticket">
              <span class="jee-key">${t.key}</span>
              <span class="jee-summary">${escapeHtml(t.summary)}</span>
              <input type="number" class="jee-input" data-key="${t.key}"
                     value="${t.estimate !== null ? t.estimate : ''}"
                     placeholder="-" min="0" step="0.1">
            </div>
          `).join('')}
        </div>
        <div class="jee-footer">
          <span>Press Esc to close or Alt+E to toggle</span>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const style = document.createElement('style');
    style.id = 'jira-estimate-overlay-styles';
    style.textContent = `
      #jira-estimate-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.5);
        z-index: 100000;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      .jee-overlay-content {
        background: white;
        border-radius: 12px;
        width: 90%;
        max-width: 600px;
        max-height: 80vh;
        display: flex;
        flex-direction: column;
        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      }
      .jee-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 16px 20px;
        border-bottom: 1px solid #dfe1e6;
      }
      .jee-header h2 { margin: 0; font-size: 18px; color: #172b4d; }
      .jee-close {
        background: none; border: none; font-size: 24px;
        cursor: pointer; color: #5e6c84; padding: 4px 8px;
      }
      .jee-tickets { overflow-y: auto; padding: 12px; flex: 1; }
      .jee-ticket {
        display: flex; align-items: center; gap: 12px;
        padding: 10px 12px; border-radius: 6px;
        margin-bottom: 8px; background: #f4f5f7;
      }
      .jee-key { font-weight: 600; color: #0052cc; min-width: 100px; font-size: 13px; }
      .jee-summary {
        flex: 1; font-size: 13px; color: #172b4d;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .jee-input {
        width: 60px; padding: 8px; border: 2px solid #dfe1e6;
        border-radius: 6px; font-size: 14px; font-weight: 600; text-align: center;
      }
      .jee-input:focus { outline: none; border-color: #0052cc; }
      .jee-input.saving { border-color: #ff991f; background: #fffae6; }
      .jee-input.saved { border-color: #36b37e; background: #e3fcef; }
      .jee-footer {
        padding: 12px 20px; border-top: 1px solid #dfe1e6;
        text-align: center; font-size: 12px; color: #5e6c84;
      }
    `;
    document.head.appendChild(style);

    overlay.querySelector('.jee-close').addEventListener('click', removeEstimateOverlay);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) removeEstimateOverlay();
    });
    document.addEventListener('keydown', handleOverlayKeydown);

    overlay.querySelectorAll('.jee-input').forEach(input => {
      input.addEventListener('change', async () => {
        const key = input.dataset.key;
        const value = input.value ? parseFloat(input.value) : null;
        input.classList.add('saving');
        const success = await updateEstimate(key, value);
        input.classList.remove('saving');
        input.classList.add(success ? 'saved' : 'error');
        setTimeout(() => input.classList.remove('saved', 'error'), 2000);
      });
    });
  }

  function handleOverlayKeydown(e) {
    if (e.key === 'Escape') removeEstimateOverlay();
  }

  function removeEstimateOverlay() {
    document.getElementById('jira-estimate-overlay')?.remove();
    document.getElementById('jira-estimate-overlay-styles')?.remove();
    document.removeEventListener('keydown', handleOverlayKeydown);
    overlayVisible = false;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
