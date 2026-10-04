// ==UserScript==
// @name        Jira Queue Auto Refresh
// @namespace   Violentmonkey Scripts
// @match       https://*.atlassian.net/*
// @grant       none
// @version     1.1.0
// @author      oggmancuc
// @description Automatically forces data refresh every minute on the "Waiting for Triage" queue. Compact icon button with an interactive dropdown for toggling, choosing Soft SPA or Hard Reload modes, and manual refresh.
// ==/UserScript==

; (function () {
    'use strict'

    const QUEUE_NAME = 'Waiting for Triage'
    const REFRESH_INTERVAL_SECONDS = 60
    const IDLE_GRACE_PERIOD_SECONDS = 15
    const IDLE_GRACE_PERIOD_MS = IDLE_GRACE_PERIOD_SECONDS * 1000

    const STORAGE_KEY = 'gm-queue-refresh-enabled'
    const MODE_STORAGE_KEY = 'gm-queue-refresh-mode' // 'soft' or 'reload'
    const WRAPPER_ID = 'gm-queue-refresh-wrapper'
    const BUTTON_ID = 'gm-queue-refresh-toggle'
    const POPOVER_ID = 'gm-queue-refresh-popover'
    const STYLE_ID = 'gm-queue-refresh-style'

    let refreshEnabled = localStorage.getItem(STORAGE_KEY) !== 'false' // default ON
    let refreshMode = localStorage.getItem(MODE_STORAGE_KEY) || 'soft' // default 'soft' (SPA re-navigation)
    let isRefreshing = false
    let timerId = null
    let nextRefreshTime = Date.now() + REFRESH_INTERVAL_SECONDS * 1000
    let lastActivityTime = Date.now()

    // ── Target Queue Detection (mirrors queue_alert.js) ──────────────────
    /**
     * Returns the queue heading element if we're on the target queue page.
     * Strategy: find the h1 whose trimmed text matches the queue name.
     */
    function getQueueHeading() {
        const headings = document.querySelectorAll('h1')
        for (const h of headings) {
            if (h.textContent.trim() === QUEUE_NAME) return h
        }
        return null
    }

    function isOnTargetQueue() {
        return !!getQueueHeading()
    }

    // ── User Activity & Interaction Tracking ────────────────────────────
    function registerActivity() {
        lastActivityTime = Date.now()
    }

    const activityEvents = ['mousedown', 'mouseup', 'keydown', 'keyup', 'touchstart', 'wheel']
    activityEvents.forEach(evt => {
        window.addEventListener(evt, registerActivity, { passive: true })
    })

    // Throttle mousemove to avoid continuous event firing
    let mouseThrottleTimer = null
    window.addEventListener('mousemove', () => {
        if (mouseThrottleTimer) return
        mouseThrottleTimer = setTimeout(() => {
            mouseThrottleTimer = null
            registerActivity()
        }, 1000)
    }, { passive: true })

    window.addEventListener('scroll', registerActivity, { passive: true, capture: true })

    /**
     * Checks if an issue detail / split view or modal is open.
     */
    function isIssueOrModalOpen() {
        if (window.location.search.includes('issueKey=')) return true

        if (document.querySelector('[role="dialog"], .atlaskit-portal-container [role="dialog"], [data-testid*="modal"]')) {
            return true
        }

        if (document.querySelector('[data-testid*="issue.views.issue-details"], [data-component-selector="jira-issue-view"], #jira-issue-header')) {
            return true
        }

        return false
    }

    /**
     * Checks if the user is currently editing text.
     */
    function isEditingText() {
        const active = document.activeElement
        if (!active) return false
        const tag = active.tagName.toLowerCase()
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
        if (active.isContentEditable || active.getAttribute('contenteditable') === 'true' || active.closest('[contenteditable="true"]')) return true
        return false
    }

    /**
     * Checks if the user is actively interacting with the page.
     */
    function isUserInteracting() {
        if (document.hidden) return false
        if (Date.now() - lastActivityTime < IDLE_GRACE_PERIOD_MS) return true
        if (isEditingText()) return true
        if (isIssueOrModalOpen()) return true
        if (document.querySelector('input[type="checkbox"]:checked')) return true

        const sel = window.getSelection()
        if (sel && sel.toString().trim().length > 0) return true

        return false
    }

    function getActivityStatusText() {
        if (!refreshEnabled) return 'Auto refresh is disabled'
        if (document.hidden) return 'Background tab: active'
        if (isEditingText()) return 'Paused: typing / editing'
        if (isIssueOrModalOpen()) return 'Paused: viewing issue details'
        if (document.querySelector('input[type="checkbox"]:checked')) return 'Paused: tickets selected'
        if (Date.now() - lastActivityTime < IDLE_GRACE_PERIOD_MS) {
            const idleSec = Math.ceil((IDLE_GRACE_PERIOD_MS - (Date.now() - lastActivityTime)) / 1000)
            return `Paused: user active (${idleSec}s grace)`
        }
        return 'Idle: refresh ready'
    }

    // ── Queue Navigation Helpers for Soft SPA Refresh ───────────────────
    function getNormalizedPath(href) {
        if (!href) return ''
        try {
            const url = new URL(href, window.location.origin)
            return url.pathname.replace(/\/+$/, '')
        } catch (_) {
            return href.split('?')[0].split('#')[0].replace(/\/+$/, '')
        }
    }

    function findOtherQueueLink() {
        const currentPath = getNormalizedPath(window.location.href)

        // 1. Check Starred Queues Bar chips
        const chips = Array.from(document.querySelectorAll('#gm-starred-queues-bar a.gm-queue-chip'))
        for (const chip of chips) {
            const p = getNormalizedPath(chip.getAttribute('href') || chip.dataset.href)
            if (p && p !== currentPath && chip.textContent.trim() !== QUEUE_NAME) {
                return chip
            }
        }

        // 2. Check sidebar queue items
        const sidebarLinks = Array.from(document.querySelectorAll('a[href*="/queues/"]'))
        for (const a of sidebarLinks) {
            const p = getNormalizedPath(a.getAttribute('href'))
            if (p && p !== currentPath && a.textContent.trim() !== QUEUE_NAME) {
                return a
            }
        }

        return null
    }

    function findTargetQueueLink() {
        const currentPath = getNormalizedPath(window.location.href)

        // 1. Starred Queues Bar chip
        const chips = Array.from(document.querySelectorAll('#gm-starred-queues-bar a.gm-queue-chip'))
        for (const chip of chips) {
            const p = getNormalizedPath(chip.getAttribute('href') || chip.dataset.href)
            if (chip.textContent.trim() === QUEUE_NAME || (currentPath && p === currentPath)) {
                return chip
            }
        }

        // 2. Sidebar links
        const sidebarLinks = Array.from(document.querySelectorAll('a[href*="/queues/"]'))
        for (const a of sidebarLinks) {
            const p = getNormalizedPath(a.getAttribute('href'))
            if (a.textContent.trim() === QUEUE_NAME || (currentPath && p === currentPath)) {
                return a
            }
        }

        return null
    }

    function performSoftRefresh() {
        return new Promise((resolve) => {
            const otherLink = findOtherQueueLink()
            const targetLink = findTargetQueueLink()

            if (!otherLink || !targetLink) {
                resolve(false)
                return
            }

            const originalUrl = window.location.href

            // Step 1: Navigate away to another queue
            otherLink.click()

            // Step 2: Navigate back to Waiting for Triage after route transition begins
            setTimeout(() => {
                if (window.location.href !== originalUrl) {
                    window.history.back()
                    resolve(true)
                } else {
                    const freshTargetLink = findTargetQueueLink() || targetLink
                    if (freshTargetLink && document.body.contains(freshTargetLink)) {
                        freshTargetLink.click()
                        resolve(true)
                    } else {
                        resolve(false)
                    }
                }
            }, 300)
        })
    }

    // ── Refresh Execution ───────────────────────────────────────────────
    async function executeRefresh(overrideMode = null) {
        if (isRefreshing) return
        isRefreshing = true
        updateButtonState(true)

        const activeMode = overrideMode || refreshMode

        try {
            if (activeMode === 'soft') {
                const success = await performSoftRefresh()
                if (!success) {
                    window.location.reload()
                    return
                }
            } else {
                window.location.reload()
                return
            }
        } catch (e) {
            console.warn('[Queue Auto Refresh] Refresh error, falling back to reload:', e)
            window.location.reload()
            return
        } finally {
            setTimeout(() => {
                isRefreshing = false
                resetTimer()
            }, 1000)
        }
    }

    // ── Timer Logic ─────────────────────────────────────────────────────
    function resetTimer() {
        nextRefreshTime = Date.now() + REFRESH_INTERVAL_SECONDS * 1000
        updateButtonState()
    }

    function tick() {
        if (!refreshEnabled) {
            updateButtonState()
            return
        }

        if (!isOnTargetQueue()) {
            removeButtons()
            stopTimer()
            return
        }

        if (isRefreshing) return

        if (isUserInteracting()) {
            nextRefreshTime = Math.max(nextRefreshTime, Date.now() + IDLE_GRACE_PERIOD_MS)
            updateButtonState()
            return
        }

        const now = Date.now()
        if (now >= nextRefreshTime) {
            executeRefresh()
        } else {
            updateButtonState()
        }
    }

    function startTimer() {
        if (timerId !== null) return
        resetTimer()
        timerId = setInterval(tick, 1000)
    }

    function stopTimer() {
        if (timerId !== null) {
            clearInterval(timerId)
            timerId = null
        }
    }

    // ── UI Injection & Dropdown Popover ──────────────────────────────────
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return

        const style = document.createElement('style')
        style.id = STYLE_ID
        style.innerHTML = `
            #${WRAPPER_ID} {
                position: relative;
                display: inline-flex;
                align-items: center;
                vertical-align: middle;
            }
            #${BUTTON_ID} {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 28px;
                height: 28px;
                border: none;
                border-radius: 4px;
                padding: 0;
                cursor: pointer;
                font-size: 14px;
                line-height: 1;
                transition: background 0.15s, color 0.15s, box-shadow 0.15s, transform 0.1s;
                user-select: none;
                box-sizing: border-box;
            }
            #${BUTTON_ID}.gm-refresh-active {
                background: var(--ds-background-information, #E9F2FF);
                color: var(--ds-text-information, #0C66E4);
            }
            #${BUTTON_ID}.gm-refresh-paused {
                background: var(--ds-background-warning, #FFF3CD);
                color: var(--ds-text-warning, #A54800);
            }
            #${BUTTON_ID}.gm-refresh-off {
                background: var(--ds-background-neutral, #091E420F);
                color: var(--ds-text-subtlest, #6B6E76);
            }
            #${BUTTON_ID}:hover {
                box-shadow: 0 0 0 2px var(--ds-border-focused, #388BFF);
            }
            #${BUTTON_ID}:active {
                transform: scale(0.95);
            }
            .gm-refresh-spin {
                animation: gm-refresh-rotate 0.8s linear infinite;
                display: inline-block;
            }
            @keyframes gm-refresh-rotate {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }

            /* Dropdown Popover */
            #${POPOVER_ID} {
                position: absolute;
                top: calc(100% + 6px);
                right: 0;
                z-index: 10000;
                width: 260px;
                background: var(--ds-surface-overlay, #FFFFFF);
                border: 1px solid var(--ds-border, rgba(9, 30, 66, 0.14));
                border-radius: 8px;
                box-shadow: 0 8px 24px -4px rgba(9, 30, 66, 0.2), 0 0 1px rgba(9, 30, 66, 0.3);
                padding: 12px;
                box-sizing: border-box;
                display: flex;
                flex-direction: column;
                gap: 12px;
                font: var(--ds-font-body-UNSAFE_small, normal 400 12px/16px ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Ubuntu, system-ui, sans-serif);
                color: var(--ds-text, #172B4D);
                animation: gm-refresh-fade-in 0.15s cubic-bezier(0.2, 0, 0, 1);
            }
            @keyframes gm-refresh-fade-in {
                from { opacity: 0; transform: translateY(-4px); }
                to { opacity: 1; transform: translateY(0); }
            }

            /* Popover Header */
            .gm-pop-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding-bottom: 8px;
                border-bottom: 1px solid var(--ds-border, rgba(9, 30, 66, 0.1));
            }
            .gm-pop-title {
                font-weight: 700;
                font-size: 13px;
                color: var(--ds-text, #172B4D);
            }
            .gm-pop-badge {
                padding: 2px 6px;
                border-radius: 10px;
                font-size: 10px;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .gm-badge-info {
                background: var(--ds-background-information, #E9F2FF);
                color: var(--ds-text-information, #0C66E4);
            }
            .gm-badge-warning {
                background: var(--ds-background-warning, #FFF3CD);
                color: var(--ds-text-warning, #A54800);
            }
            .gm-badge-neutral {
                background: var(--ds-background-neutral, #091E420F);
                color: var(--ds-text-subtlest, #6B6E76);
            }

            /* Switch Toggle Row */
            .gm-switch-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                cursor: pointer;
                user-select: none;
            }
            .gm-switch-text {
                display: flex;
                flex-direction: column;
                gap: 2px;
            }
            .gm-switch-title {
                font-weight: 600;
                font-size: 12px;
                color: var(--ds-text, #172B4D);
            }
            .gm-switch-sub {
                font-size: 11px;
                color: var(--ds-text-subtle, #626F86);
            }

            /* Toggle Switch */
            .gm-toggle-switch {
                position: relative;
                width: 34px;
                height: 18px;
                flex-shrink: 0;
            }
            .gm-toggle-switch input {
                opacity: 0;
                width: 0;
                height: 0;
            }
            .gm-toggle-slider {
                position: absolute;
                cursor: pointer;
                top: 0; left: 0; right: 0; bottom: 0;
                background-color: var(--ds-background-neutral, rgba(9, 30, 66, 0.14));
                transition: 0.2s;
                border-radius: 18px;
            }
            .gm-toggle-slider:before {
                position: absolute;
                content: "";
                height: 14px;
                width: 14px;
                left: 2px;
                bottom: 2px;
                background-color: white;
                transition: 0.2s;
                border-radius: 50%;
                box-shadow: 0 1px 3px rgba(0,0,0,0.2);
            }
            .gm-toggle-switch input:checked + .gm-toggle-slider {
                background-color: var(--ds-background-selected-bold, #0C66E4);
            }
            .gm-toggle-switch input:checked + .gm-toggle-slider:before {
                transform: translateX(16px);
            }

            /* Refresh Mode Cards */
            .gm-mode-group {
                display: flex;
                flex-direction: column;
                gap: 6px;
            }
            .gm-mode-group-title {
                font-size: 11px;
                font-weight: 600;
                color: var(--ds-text-subtle, #626F86);
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .gm-mode-card {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 6px 10px;
                border-radius: 6px;
                border: 1px solid var(--ds-border, rgba(9, 30, 66, 0.12));
                background: var(--ds-surface, #FFFFFF);
                cursor: pointer;
                transition: background 0.15s, border-color 0.15s;
                user-select: none;
            }
            .gm-mode-card:hover {
                background: var(--ds-background-neutral-subtle, rgba(9, 30, 66, 0.04));
                border-color: var(--ds-border-focused, #388BFF);
            }
            .gm-mode-card.gm-selected {
                background: var(--ds-background-selected, #E9F2FF);
                border-color: var(--ds-border-focused, #388BFF);
            }
            .gm-card-icon {
                font-size: 15px;
            }
            .gm-card-label {
                font-weight: 600;
                font-size: 12px;
                color: var(--ds-text, #172B4D);
            }
            .gm-card-timing {
                font-size: 11px;
                color: var(--ds-text-subtle, #626F86);
            }

            /* Footer & Action Button */
            .gm-pop-footer {
                display: flex;
                flex-direction: column;
                gap: 8px;
                padding-top: 8px;
                border-top: 1px solid var(--ds-border, rgba(9, 30, 66, 0.08));
            }
            .gm-guard-status {
                display: flex;
                align-items: center;
                gap: 6px;
                font-size: 11px;
                color: var(--ds-text-subtle, #626F86);
            }
            .gm-guard-dot {
                width: 7px;
                height: 7px;
                border-radius: 50%;
                flex-shrink: 0;
            }
            .gm-dot-green {
                background-color: #22A06B;
            }
            .gm-dot-amber {
                background-color: #E2B203;
            }
            .gm-dot-gray {
                background-color: #8993A4;
            }
            .gm-now-btn {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                width: 100%;
                padding: 6px 12px;
                border: none;
                border-radius: 4px;
                background: var(--ds-background-neutral, rgba(9, 30, 66, 0.08));
                color: var(--ds-text, #172B4D);
                font-weight: 600;
                font-size: 12px;
                cursor: pointer;
                transition: background 0.15s, transform 0.1s;
                user-select: none;
            }
            .gm-now-btn:hover {
                background: var(--ds-background-neutral-hovered, rgba(9, 30, 66, 0.16));
            }
            .gm-now-btn:active {
                transform: scale(0.97);
            }
        `
        document.head.appendChild(style)
    }

    function updateButtonState(forceRefreshing = false) {
        const btn = document.getElementById(BUTTON_ID)
        if (!btn) return

        if (forceRefreshing || isRefreshing) {
            btn.className = 'gm-refresh-active'
            btn.innerHTML = '<span class="gm-refresh-spin">🔄</span>'
            btn.title = 'Queue Auto Refresh: Refreshing now...'
            updatePopoverContent()
            return
        }

        if (!refreshEnabled) {
            btn.className = 'gm-refresh-off'
            btn.setAttribute('aria-pressed', 'false')
            btn.title = 'Queue Auto Refresh: OFF • Click to open settings'
            btn.innerHTML = '<span>⚪</span>'
        } else {
            const interacting = isUserInteracting()
            const remainingMs = Math.max(0, nextRefreshTime - Date.now())
            const remainingSec = Math.ceil(remainingMs / 1000)

            if (interacting) {
                btn.className = 'gm-refresh-paused'
                btn.setAttribute('aria-pressed', 'true')
                btn.title = `Queue Auto Refresh: Paused (user active) • Next in ${remainingSec}s\nClick to open settings`
                btn.innerHTML = '<span>⏸️</span>'
            } else {
                btn.className = 'gm-refresh-active'
                btn.setAttribute('aria-pressed', 'true')
                btn.title = `Queue Auto Refresh: Next in ${remainingSec}s (${refreshMode.toUpperCase()})\nClick to open settings`
                btn.innerHTML = '<span>🔄</span>'
            }
        }

        updatePopoverContent()
    }

    function updatePopoverContent() {
        const popover = document.getElementById(POPOVER_ID)
        if (!popover) return

        let badgeClass = 'gm-badge-neutral'
        let badgeText = 'OFF'
        let dotClass = 'gm-dot-gray'

        if (isRefreshing) {
            badgeClass = 'gm-badge-info'
            badgeText = 'REFRESHING'
            dotClass = 'gm-dot-green'
        } else if (refreshEnabled) {
            const remainingMs = Math.max(0, nextRefreshTime - Date.now())
            const remainingSec = Math.ceil(remainingMs / 1000)

            if (isUserInteracting()) {
                badgeClass = 'gm-badge-warning'
                badgeText = `PAUSED (${remainingSec}s)`
                dotClass = 'gm-dot-amber'
            } else {
                badgeClass = 'gm-badge-info'
                badgeText = `${remainingSec}s REMAINING`
                dotClass = 'gm-dot-green'
            }
        }

        const statusText = getActivityStatusText()

        popover.innerHTML = `
            <div class="gm-pop-header">
                <span class="gm-pop-title">Auto Refresh</span>
                <span class="gm-pop-badge ${badgeClass}">${badgeText}</span>
            </div>

            <label class="gm-switch-row" id="gm-refresh-switch-row">
                <div class="gm-switch-text">
                    <span class="gm-switch-title">Auto Refresh</span>
                    <span class="gm-switch-sub">Forces queue data retrieval every 60s</span>
                </div>
                <div class="gm-toggle-switch">
                    <input type="checkbox" id="gm-refresh-checkbox" ${refreshEnabled ? 'checked' : ''}>
                    <span class="gm-toggle-slider"></span>
                </div>
            </label>

            <div class="gm-mode-group">
                <div class="gm-mode-group-title">Refresh Method</div>

                <div class="gm-mode-card ${refreshMode === 'soft' ? 'gm-selected' : ''}" data-mode="soft">
                    <span class="gm-card-icon">⚡</span>
                    <div>
                        <div class="gm-card-label">Soft SPA (Recommended)</div>
                        <div class="gm-card-timing">Fast, no reload, keeps sound alerts alive</div>
                    </div>
                </div>

                <div class="gm-mode-card ${refreshMode === 'reload' ? 'gm-selected' : ''}" data-mode="reload">
                    <span class="gm-card-icon">🔁</span>
                    <div>
                        <div class="gm-card-label">Hard Page Reload</div>
                        <div class="gm-card-timing">Full browser reload, clears memory</div>
                    </div>
                </div>
            </div>

            <div class="gm-pop-footer">
                <div class="gm-guard-status">
                    <span class="gm-guard-dot ${dotClass}"></span>
                    <span>${statusText}</span>
                </div>
                <button type="button" class="gm-now-btn" id="gm-pop-refresh-now" title="Force refresh right now (Shift-click to alternate mode)">
                    <span>↻</span>
                    <span>Refresh Now</span>
                </button>
            </div>
        `

        // Attach event listeners
        const checkbox = popover.querySelector('#gm-refresh-checkbox')
        if (checkbox) {
            checkbox.addEventListener('change', () => {
                handleToggle()
            })
        }

        const modeCards = popover.querySelectorAll('.gm-mode-card')
        modeCards.forEach(card => {
            card.addEventListener('click', () => {
                const mode = card.dataset.mode
                if (mode && mode !== refreshMode) {
                    handleModeToggle(mode)
                }
            })
        })

        const nowBtn = popover.querySelector('#gm-pop-refresh-now')
        if (nowBtn) {
            nowBtn.addEventListener('click', (e) => {
                if (e.shiftKey) {
                    executeRefresh(refreshMode === 'soft' ? 'reload' : 'soft')
                } else {
                    executeRefresh()
                }
            })
        }
    }

    function handleToggle() {
        refreshEnabled = !refreshEnabled
        localStorage.setItem(STORAGE_KEY, refreshEnabled ? 'true' : 'false')
        if (refreshEnabled) {
            resetTimer()
            startTimer()
        } else {
            updateButtonState()
        }
    }

    function handleModeToggle(newMode) {
        refreshMode = newMode
        localStorage.setItem(MODE_STORAGE_KEY, refreshMode)
        updateButtonState()
    }

    function togglePopover() {
        const popover = document.getElementById(POPOVER_ID)
        const btn = document.getElementById(BUTTON_ID)
        if (!popover) return

        const isOpen = popover.style.display !== 'none'
        if (isOpen) {
            popover.style.display = 'none'
            btn?.setAttribute('aria-expanded', 'false')
        } else {
            // Close other popovers (e.g. alert script)
            document.getElementById('gm-queue-alert-popover')?.style.setProperty('display', 'none')
            document.getElementById('gm-queue-alert-toggle')?.setAttribute('aria-expanded', 'false')

            updatePopoverContent()
            popover.style.display = 'flex'
            btn?.setAttribute('aria-expanded', 'true')
        }
    }

    function closePopover() {
        const popover = document.getElementById(POPOVER_ID)
        if (popover && popover.style.display !== 'none') {
            popover.style.display = 'none'
            document.getElementById(BUTTON_ID)?.setAttribute('aria-expanded', 'false')
        }
    }

    // Close on click outside or Escape key
    document.addEventListener('click', (e) => {
        const wrapper = document.getElementById(WRAPPER_ID)
        if (wrapper && !wrapper.contains(e.target)) {
            closePopover()
        }
    })

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closePopover()
    })

    function removeButtons() {
        document.getElementById(WRAPPER_ID)?.remove()
    }

    function injectButtons() {
        if (!isOnTargetQueue()) {
            removeButtons()
            return
        }

        if (document.getElementById(WRAPPER_ID)) {
            updateButtonState()
            return
        }

        const heading = getQueueHeading()
        if (!heading) return

        const h1Wrapper = heading.parentElement
        if (!h1Wrapper) return

        const rowContainer = h1Wrapper.parentElement
        if (!rowContainer) return

        let toolbar = null
        for (const child of rowContainer.children) {
            if (child === h1Wrapper) continue
            if (child.querySelector('[data-testid*="favorite-button"], [aria-label="Star"], #gm-queue-alert-toggle, #gm-queue-alert-wrapper')) {
                toolbar = child
                break
            }
        }

        if (!toolbar && h1Wrapper.nextElementSibling) {
            toolbar = h1Wrapper.nextElementSibling
        }

        if (!toolbar) return

        const flexRow = toolbar.querySelector('[data-testid*="favorite-button"], [aria-label="Star"], #gm-queue-alert-toggle, #gm-queue-alert-wrapper')
            ?.closest('div[class]')?.parentElement || toolbar

        // Create container wrapper
        const wrapper = document.createElement('div')
        wrapper.id = WRAPPER_ID

        // Icon Trigger button
        const btn = document.createElement('button')
        btn.id = BUTTON_ID
        btn.type = 'button'
        btn.setAttribute('aria-haspopup', 'true')
        btn.setAttribute('aria-expanded', 'false')
        btn.setAttribute('aria-label', 'Queue auto-refresh settings')
        btn.addEventListener('click', (e) => {
            e.stopPropagation()
            togglePopover()
        })
        wrapper.appendChild(btn)

        // Dropdown Popover
        const popover = document.createElement('div')
        popover.id = POPOVER_ID
        popover.style.display = 'none'
        wrapper.appendChild(popover)

        flexRow.appendChild(wrapper)
        updateButtonState()
    }

    // ── Initialization ──────────────────────────────────────────────────
    function init() {
        injectStyles()
        if (isOnTargetQueue()) {
            injectButtons()
            if (refreshEnabled) {
                startTimer()
            }
        }
    }

    // DOM Mutation Observer for SPA navigation & dynamic rendering
    let observerTimer = null
    const observer = new MutationObserver(() => {
        if (observerTimer) return
        observerTimer = setTimeout(() => {
            observerTimer = null

            if (isOnTargetQueue()) {
                injectStyles()
                injectButtons()
                if (refreshEnabled && timerId === null) {
                    startTimer()
                }
            } else {
                removeButtons()
                stopTimer()
            }
        }, 500)
    })

    observer.observe(document.body, { childList: true, subtree: true })

    // Listen for SPA navigation events
    window.addEventListener('popstate', () => {
        setTimeout(() => {
            if (isOnTargetQueue()) {
                injectStyles()
                injectButtons()
                if (refreshEnabled && timerId === null) startTimer()
            } else {
                removeButtons()
                stopTimer()
            }
        }, 200)
    })

    init()
})()
