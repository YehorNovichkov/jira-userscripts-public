// ==UserScript==
// @name        Jira Queue Auto Refresh
// @namespace   Violentmonkey Scripts
// @match       https://*.atlassian.net/*
// @grant       none
// @version     1.0.0
// @author      oggmancuc
// @description Automatically forces data refresh every minute on the "Waiting for Triage" queue. Pauses during user activity and supports soft SPA re-navigation or full page reload.
// ==/UserScript==

; (function () {
    'use strict'

    const QUEUE_NAME = 'Waiting for Triage'
    const REFRESH_INTERVAL_SECONDS = 60
    const IDLE_GRACE_PERIOD_SECONDS = 15
    const IDLE_GRACE_PERIOD_MS = IDLE_GRACE_PERIOD_SECONDS * 1000

    const STORAGE_KEY = 'gm-queue-refresh-enabled'
    const MODE_STORAGE_KEY = 'gm-queue-refresh-mode' // 'soft' or 'reload'
    const BUTTON_ID = 'gm-queue-refresh-toggle'
    const MODE_BUTTON_ID = 'gm-queue-refresh-mode-toggle'
    const NOW_BUTTON_ID = 'gm-queue-refresh-now'
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
        // Check URL for open issue in split view
        if (window.location.search.includes('issueKey=')) return true

        // Check for modal dialogs, drawers, or issue details container
        if (document.querySelector('[role="dialog"], .atlaskit-portal-container [role="dialog"], [data-testid*="modal"]')) {
            return true
        }

        if (document.querySelector('[data-testid*="issue.views.issue-details"], [data-component-selector="jira-issue-view"], #jira-issue-header')) {
            return true
        }

        return false
    }

    /**
     * Checks if the user is currently actively interacting with the page.
     * Refresh will be paused if:
     * 1. The tab is visible AND user interacted within the last IDLE_GRACE_PERIOD_MS (15s)
     * 2. An input, textarea, or contenteditable editor is focused
     * 3. An issue detail panel, split view, or modal dialog is open
     * 4. Text is actively selected by the user
     * 5. Any table row checkboxes are currently checked (bulk action in progress)
     *
     * Note: In a background/hidden tab, user is NOT interacting, so refresh proceeds promptly!
     */
    function isUserInteracting() {
        if (document.hidden) return false

        // Recent user input/mouse/scroll interaction
        if (Date.now() - lastActivityTime < IDLE_GRACE_PERIOD_MS) return true

        // User actively focusing or typing in an input/textarea/editor
        const active = document.activeElement
        if (active) {
            const tag = active.tagName.toLowerCase()
            if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
            if (active.isContentEditable || active.getAttribute('contenteditable') === 'true' || active.closest('[contenteditable="true"]')) return true
        }

        // Issue detail view or modal open
        if (isIssueOrModalOpen()) return true

        // Checkboxes checked in ticket table
        if (document.querySelector('input[type="checkbox"]:checked')) return true

        // Text actively selected
        const sel = window.getSelection()
        if (sel && sel.toString().trim().length > 0) return true

        return false
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

        // 1. Check Starred Queues Bar chips (if starred_queues_bar.js is installed)
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

    /**
     * Soft SPA Re-Navigation:
     * Switches briefly to an adjacent queue and immediately back.
     * Benefits:
     * - Forces Jira's React queue component to remount and fetch fresh data
     * - Keeps AudioContext active (unbroken user-gesture permission for queue_alert.js)
     * - Avoids page reload flicker and retains fast PWA response
     *
     * Falls back to false if no alternate queue link is found.
     */
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
                // If history moved forward to the other queue, history.back() restores state cleanly
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
                    // If soft re-navigation couldn't find an alternate queue, fallback to full reload
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
            // Postpone refresh while user is interacting
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

    // ── UI Injection & Styling ──────────────────────────────────────────
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return

        const style = document.createElement('style')
        style.id = STYLE_ID
        style.innerHTML = `
            #${BUTTON_ID},
            #${MODE_BUTTON_ID},
            #${NOW_BUTTON_ID} {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 4px;
                border: none;
                border-radius: 3px;
                padding: 4px 8px;
                cursor: pointer;
                font: var(--ds-font-body-UNSAFE_small, normal 400 12px/16px ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Ubuntu, system-ui, sans-serif);
                transition: background 0.15s, color 0.15s, box-shadow 0.15s, transform 0.1s;
                vertical-align: middle;
                white-space: nowrap;
                user-select: none;
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
            #${MODE_BUTTON_ID},
            #${NOW_BUTTON_ID} {
                background: var(--ds-background-neutral, #091E420F);
                color: var(--ds-text-subtle, #44546F);
            }
            #${BUTTON_ID}:hover,
            #${MODE_BUTTON_ID}:hover,
            #${NOW_BUTTON_ID}:hover {
                box-shadow: 0 0 0 2px var(--ds-border-focused, #388BFF);
                background: var(--ds-background-neutral-hovered, #091E4224);
            }
            #${NOW_BUTTON_ID}:active {
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
        `
        document.head.appendChild(style)
    }

    function updateButtonState(forceRefreshing = false) {
        const btn = document.getElementById(BUTTON_ID)
        const modeBtn = document.getElementById(MODE_BUTTON_ID)
        const nowBtn = document.getElementById(NOW_BUTTON_ID)

        if (!btn) return

        if (forceRefreshing || isRefreshing) {
            btn.className = 'gm-refresh-active'
            btn.innerHTML = '<span class="gm-refresh-spin">🔄</span><span>Refreshing...</span>'
            btn.title = 'Forcing data refresh...'
            return
        }

        if (!refreshEnabled) {
            btn.className = 'gm-refresh-off'
            btn.setAttribute('aria-pressed', 'false')
            btn.title = 'Queue auto-refresh is OFF — click to enable (every 60s)'
            btn.innerHTML = '<span>⚪</span><span>Refresh OFF</span>'
        } else {
            const interacting = isUserInteracting()
            const remainingMs = Math.max(0, nextRefreshTime - Date.now())
            const remainingSec = Math.ceil(remainingMs / 1000)

            if (interacting) {
                btn.className = 'gm-refresh-paused'
                btn.setAttribute('aria-pressed', 'true')
                btn.title = `Auto-refresh paused (user active / modal open) • Will resume when idle for ${IDLE_GRACE_PERIOD_SECONDS}s or in background tab\nClick to turn OFF`
                btn.innerHTML = `<span>⏸️</span><span>Paused (${remainingSec}s)</span>`
            } else {
                btn.className = 'gm-refresh-active'
                btn.setAttribute('aria-pressed', 'true')
                btn.title = `Auto-refresh is ON (every ${REFRESH_INTERVAL_SECONDS}s) • Mode: ${refreshMode.toUpperCase()}\nNext refresh in ${remainingSec}s\nClick to pause/turn OFF`
                btn.innerHTML = `<span>🔄</span><span>${remainingSec}s</span>`
            }
        }

        if (modeBtn) {
            if (refreshMode === 'soft') {
                modeBtn.className = 'gm-mode-soft'
                modeBtn.title = 'Mode: Soft SPA Re-Navigation (switches away & back instantly without page reload)\nKeeps sound alert active • Click to switch to Hard Reload'
                modeBtn.innerHTML = '<span>⚡ Soft</span>'
            } else {
                modeBtn.className = 'gm-mode-reload'
                modeBtn.title = 'Mode: Hard Page Reload (full location.reload())\nClick to switch to Soft SPA'
                modeBtn.innerHTML = '<span>🔁 Reload</span>'
            }
        }

        if (nowBtn) {
            nowBtn.title = `Force refresh right now (${refreshMode === 'soft' ? 'Soft SPA' : 'Full Reload'})\nShift-click to alternate mode`
            nowBtn.innerHTML = '<span>↻ Refresh</span>'
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

    function handleModeToggle() {
        refreshMode = refreshMode === 'soft' ? 'reload' : 'soft'
        localStorage.setItem(MODE_STORAGE_KEY, refreshMode)
        updateButtonState()
    }

    function removeButtons() {
        document.getElementById(BUTTON_ID)?.remove()
        document.getElementById(MODE_BUTTON_ID)?.remove()
        document.getElementById(NOW_BUTTON_ID)?.remove()
    }

    function injectButtons() {
        if (!isOnTargetQueue()) {
            removeButtons()
            return
        }

        if (document.getElementById(BUTTON_ID) && document.getElementById(MODE_BUTTON_ID) && document.getElementById(NOW_BUTTON_ID)) {
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
            if (child.querySelector('[data-testid*="favorite-button"], [aria-label="Star"], #gm-queue-alert-toggle')) {
                toolbar = child
                break
            }
        }

        if (!toolbar && h1Wrapper.nextElementSibling) {
            toolbar = h1Wrapper.nextElementSibling
        }

        if (!toolbar) return

        const flexRow = toolbar.querySelector('[data-testid*="favorite-button"], [aria-label="Star"], #gm-queue-alert-toggle')
            ?.closest('div[class]')?.parentElement || toolbar

        // 1. Countdown & Toggle button
        if (!document.getElementById(BUTTON_ID)) {
            const btn = document.createElement('button')
            btn.id = BUTTON_ID
            btn.type = 'button'
            btn.setAttribute('aria-label', 'Toggle queue auto-refresh')
            btn.addEventListener('click', handleToggle)
            flexRow.appendChild(btn)
        }

        // 2. Mode button (Soft vs Reload)
        if (!document.getElementById(MODE_BUTTON_ID)) {
            const modeBtn = document.createElement('button')
            modeBtn.id = MODE_BUTTON_ID
            modeBtn.type = 'button'
            modeBtn.setAttribute('aria-label', 'Toggle refresh mode (Soft SPA vs Hard Reload)')
            modeBtn.addEventListener('click', handleModeToggle)
            flexRow.appendChild(modeBtn)
        }

        // 3. Manual "Refresh Now" button
        if (!document.getElementById(NOW_BUTTON_ID)) {
            const nowBtn = document.createElement('button')
            nowBtn.id = NOW_BUTTON_ID
            nowBtn.type = 'button'
            nowBtn.setAttribute('aria-label', 'Force refresh queue now')
            nowBtn.addEventListener('click', (e) => {
                if (e.shiftKey) {
                    executeRefresh(refreshMode === 'soft' ? 'reload' : 'soft')
                } else {
                    executeRefresh()
                }
            })
            flexRow.appendChild(nowBtn)
        }

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
