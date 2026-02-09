# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Chrome extension (Manifest V3) for viewing and editing story point estimates directly on Jira pages. Features a floating action button (FAB) toggle-based estimate mode and a popup for batch editing.

## Architecture

### Content Script (`content.js`)
- Injects into Jira pages (Atlassian Cloud + self-hosted)
- Creates FAB (bottom-right), status bar (bottom-center), and keyboard hint
- Scans DOM for tickets using multiple selectors (classic + new Jira UI)
- Maintains `ticketData` Map (issueKey → {estimate, element})
- Toggle "estimate mode" adds clickable badges to cards, opens picker popup
- Updates estimates via Jira REST API (`/rest/api/2/issue/{key}`)
- Communicates with popup via `chrome.runtime.onMessage`

### Popup (`popup.js`, `popup.html`)
- Standalone ticket list view accessible from extension icon
- Uses `chrome.scripting.executeScript` to extract tickets from active tab
- Allows inline estimate editing with visual feedback states (saving/saved/error)
- Quick-set buttons for batch estimation of unestimated tickets

### Styles
- `content.css`: Atlassian design system colors, FAB, status bar, picker, toast notifications
- `popup.css`: Popup-specific styling with issue type color coding

### Key Data Flow
1. Content script scans for tickets on page load and DOM mutations
2. Popup requests tickets via `GET_TICKETS` message
3. Estimate changes trigger `UPDATE_ESTIMATE` message or direct API calls
4. Story points field ID auto-detected from issue `editmeta` or common customfield IDs

## Development

### Load Extension
```bash
# Open chrome://extensions
# Enable "Developer mode"
# Click "Load unpacked" and select this directory
```

### Testing
- Navigate to any Jira board/backlog page
- Click FAB (⏱) or press Alt+E to toggle estimate mode
- Click any card to edit its estimate
- Use popup for batch viewing/editing

### Supported Jira Selectors
- Classic: `.ghx-issue`, `.ghx-key`, `.ghx-estimate`
- New UI: `[data-testid*="card"]`, `[data-rbd-draggable-id]`
- Links: `a[href*="/browse/"]` with issue key pattern `[A-Z][A-Z0-9]+-\d+`

### Default Estimate Values
`[0.1, 0.2, 0.5, 1, 1.5, 2, 3]` days - configurable in `ESTIMATE_VALUES` constant

## Keyboard Shortcuts
- `Alt+E`: Toggle estimate mode
- `Escape`: Close picker or exit estimate mode
- `Enter`: Confirm custom estimate input
