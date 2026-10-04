// ==UserScript==
// @name        Jira Queue Alert
// @namespace   Violentmonkey Scripts
// @match       https://*.atlassian.net/*
// @grant       none
// @version     1.1.0
// @author      oggmancuc
// @description Plays an alert sound when tickets appear in the "Waiting for Triage" queue. Compact icon button with an interactive settings dropdown to configure chime/alarm modes and preview sounds.
// ==/UserScript==

; (function () {
    'use strict'

    const QUEUE_NAME = 'Waiting for Triage'
    const NORMAL_INTERVAL_MS = 30000   // 30 seconds
    const AGGRESSIVE_INTERVAL_MS = 5000 // 5 seconds
    const STORAGE_KEY = 'gm-queue-alert-enabled'
    const MODE_STORAGE_KEY = 'gm-queue-alert-mode' // 'normal' or 'aggressive'
    const WRAPPER_ID = 'gm-queue-alert-wrapper'
    const BUTTON_ID = 'gm-queue-alert-toggle' // Kept for compatibility with other scripts
    const POPOVER_ID = 'gm-queue-alert-popover'
    const STYLE_ID = 'gm-queue-alert-style'

    let alertEnabled = localStorage.getItem(STORAGE_KEY) !== 'false' // default ON
    let aggressiveMode = localStorage.getItem(MODE_STORAGE_KEY) === 'aggressive' // default normal
    let previousCount = null
    let intervalId = null
    let audioCtx = null // persistent AudioContext — created once, reused forever

    // ── Resilient DOM helpers ────────────────────────────────────────────
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

    /**
     * Extracts the ticket count from the live-region counter or table.
     */
    function getTicketCount() {
        // Strategy 1: aria-live counter with "work item" text
        const liveRegions = document.querySelectorAll('span[aria-live="polite"]')
        for (const el of liveRegions) {
            const text = el.textContent.trim()
            const match = text.match(/^(\d+)\s+work\s+items?$/i)
            if (match) return parseInt(match[1], 10)
        }

        // Strategy 2: search count wrapper (data-vc based)
        const countWrappers = document.querySelectorAll('[data-vc*="issue-search-count"], [data-vc*="search-count"]')
        for (const el of countWrappers) {
            const match = el.textContent.trim().match(/(\d+)/)
            if (match) return parseInt(match[1], 10)
        }

        // Strategy 3: count rendered issue rows via data-testid on cells
        const issueKeys = document.querySelectorAll('[data-testid*="cell-wrapper"][data-testid*="issuekey"]')
        if (issueKeys.length > 0) return issueKeys.length

        return null
    }

    // ── Sound generation (Web Audio API — no external files) ────────────
    function getAudioContext() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)()
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume()
        }
        return audioCtx
    }

    function playAlertSound() {
        if (aggressiveMode) {
            playAggressiveSound()
        } else {
            playNormalSound()
        }
    }

    // Normal mode: gentle two-tone chime (C5 → E5)
    function playNormalSound() {
        try {
            const ctx = getAudioContext()
            const now = ctx.currentTime

            const frequencies = [523.25, 659.25]
            frequencies.forEach((freq, i) => {
                const osc = ctx.createOscillator()
                const gain = ctx.createGain()
                osc.type = 'sine'
                osc.frequency.value = freq
                gain.gain.setValueAtTime(0.25, now + i * 0.18)
                gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.18 + 0.5)
                osc.connect(gain)
                gain.connect(ctx.destination)
                osc.start(now + i * 0.18)
                osc.stop(now + i * 0.18 + 0.5)
            })
        } catch (e) {
            console.warn('[Queue Alert] Could not play normal sound:', e)
        }
    }

    // Aggressive mode: rapid alarm beeps
    function playAggressiveSound() {
        try {
            const ctx = getAudioContext()
            const now = ctx.currentTime

            const pattern = [
                { freq: 880, start: 0.00 },   // A5
                { freq: 700, start: 0.12 },
                { freq: 880, start: 0.24 },
                { freq: 700, start: 0.36 },
                { freq: 880, start: 0.48 },
                { freq: 700, start: 0.60 },
                // brief pause, then repeat louder
                { freq: 988, start: 0.85 },   // B5
                { freq: 784, start: 0.97 },
                { freq: 988, start: 1.09 },
                { freq: 784, start: 1.21 },
            ]

            pattern.forEach(({ freq, start }) => {
                const osc = ctx.createOscillator()
                const gain = ctx.createGain()
                osc.type = 'sawtooth'
                osc.frequency.value = freq
                gain.gain.setValueAtTime(0.35, now + start)
                gain.gain.exponentialRampToValueAtTime(0.001, now + start + 0.10)
                osc.connect(gain)
                gain.connect(ctx.destination)
                osc.start(now + start)
                osc.stop(now + start + 0.10)
            })
        } catch (e) {
            console.warn('[Queue Alert] Could not play aggressive sound:', e)
        }
    }

    // Unlock AudioContext on user interaction
    function unlockAudio() {
        getAudioContext()
        document.removeEventListener('click', unlockAudio)
        document.removeEventListener('keydown', unlockAudio)
    }
    document.addEventListener('click', unlockAudio)
    document.addEventListener('keydown', unlockAudio)

    // ── Core check logic ────────────────────────────────────────────────
    function checkQueue() {
        if (!alertEnabled) return
        if (!isOnTargetQueue()) return

        const count = getTicketCount()
        if (count === null) return

        const wasEmpty = previousCount === 0 || previousCount === null
        const hasTickets = count > 0

        if (hasTickets && wasEmpty) {
            playAlertSound()
        }

        previousCount = count
        updatePopoverContent()
    }

    function stopInterval() {
        if (intervalId !== null) {
            clearInterval(intervalId)
            intervalId = null
        }
    }

    function startInterval() {
        stopInterval()
        const interval = aggressiveMode ? AGGRESSIVE_INTERVAL_MS : NORMAL_INTERVAL_MS
        intervalId = setInterval(() => {
            if (!alertEnabled) return
            if (!isOnTargetQueue()) return

            const count = getTicketCount()
            if (count === null) return

            if (count > 0) playAlertSound()
            previousCount = count
            updatePopoverContent()
        }, interval)
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
            #${BUTTON_ID}.gm-alert-on {
                background: var(--ds-background-success, #DCFFF1);
                color: var(--ds-text-success, #206E4E);
            }
            #${BUTTON_ID}.gm-alert-alarm {
                background: var(--ds-background-warning, #FFF3CD);
                color: var(--ds-text-warning, #A54800);
            }
            #${BUTTON_ID}.gm-alert-off {
                background: var(--ds-background-neutral, #091E420F);
                color: var(--ds-text-subtlest, #6B6E76);
            }
            #${BUTTON_ID}:hover {
                box-shadow: 0 0 0 2px var(--ds-border-focused, #388BFF);
            }
            #${BUTTON_ID}:active {
                transform: scale(0.95);
            }

            /* Dropdown Popover */
            #${POPOVER_ID} {
                position: absolute;
                top: calc(100% + 6px);
                right: 0;
                z-index: 10000;
                width: 250px;
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
                animation: gm-alert-fade-in 0.15s cubic-bezier(0.2, 0, 0, 1);
            }
            @keyframes gm-alert-fade-in {
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
            .gm-badge-success {
                background: var(--ds-background-success, #DCFFF1);
                color: var(--ds-text-success, #206E4E);
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

            /* Sound Mode Cards */
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
            .gm-sound-card {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 6px 10px;
                border-radius: 6px;
                border: 1px solid var(--ds-border, rgba(9, 30, 66, 0.12));
                background: var(--ds-surface, #FFFFFF);
                cursor: pointer;
                transition: background 0.15s, border-color 0.15s;
                user-select: none;
            }
            .gm-sound-card:hover {
                background: var(--ds-background-neutral-subtle, rgba(9, 30, 66, 0.04));
                border-color: var(--ds-border-focused, #388BFF);
            }
            .gm-sound-card.gm-selected {
                background: var(--ds-background-selected, #E9F2FF);
                border-color: var(--ds-border-focused, #388BFF);
            }
            .gm-card-left {
                display: flex;
                align-items: center;
                gap: 8px;
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
            .gm-play-btn {
                border: none;
                background: var(--ds-background-neutral, rgba(9, 30, 66, 0.08));
                color: var(--ds-text, #172B4D);
                border-radius: 3px;
                padding: 3px 7px;
                font-size: 10px;
                cursor: pointer;
                transition: background 0.15s, transform 0.1s;
            }
            .gm-play-btn:hover {
                background: var(--ds-background-neutral-hovered, rgba(9, 30, 66, 0.16));
            }
            .gm-play-btn:active {
                transform: scale(0.92);
            }

            /* Popover Footer Info */
            .gm-pop-footer {
                display: flex;
                align-items: center;
                justify-content: space-between;
                font-size: 11px;
                color: var(--ds-text-subtle, #626F86);
                padding-top: 6px;
                border-top: 1px solid var(--ds-border, rgba(9, 30, 66, 0.08));
            }
        `
        document.head.appendChild(style)
    }

    function updateButtonState() {
        const btn = document.getElementById(BUTTON_ID)
        if (!btn) return

        if (alertEnabled) {
            if (aggressiveMode) {
                btn.className = 'gm-alert-alarm'
                btn.title = 'Queue Alert: ON (Alarm Mode) • Click to open settings'
                btn.innerHTML = '<span>⏰</span>'
            } else {
                btn.className = 'gm-alert-on'
                btn.title = 'Queue Alert: ON (Chime Mode) • Click to open settings'
                btn.innerHTML = '<span>🔔</span>'
            }
            btn.setAttribute('aria-pressed', 'true')
        } else {
            btn.className = 'gm-alert-off'
            btn.title = 'Queue Alert: OFF • Click to open settings'
            btn.innerHTML = '<span>🔕</span>'
            btn.setAttribute('aria-pressed', 'false')
        }

        updatePopoverContent()
    }

    function updatePopoverContent() {
        const popover = document.getElementById(POPOVER_ID)
        if (!popover) return

        let badgeClass = 'gm-badge-neutral'
        let badgeText = 'MUTED'
        if (alertEnabled) {
            badgeClass = aggressiveMode ? 'gm-badge-warning' : 'gm-badge-success'
            badgeText = aggressiveMode ? 'ALARM ON' : 'ALERT ON'
        }

        const count = getTicketCount()
        const countText = count !== null ? `${count} ${count === 1 ? 'ticket' : 'tickets'} in queue` : 'Queue monitoring ready'

        popover.innerHTML = `
            <div class="gm-pop-header">
                <span class="gm-pop-title">Queue Alert</span>
                <span class="gm-pop-badge ${badgeClass}">${badgeText}</span>
            </div>

            <label class="gm-switch-row" id="gm-alert-switch-row">
                <div class="gm-switch-text">
                    <span class="gm-switch-title">Sound Alert</span>
                    <span class="gm-switch-sub">Play sound when tickets arrive</span>
                </div>
                <div class="gm-toggle-switch">
                    <input type="checkbox" id="gm-alert-checkbox" ${alertEnabled ? 'checked' : ''}>
                    <span class="gm-toggle-slider"></span>
                </div>
            </label>

            <div class="gm-mode-group">
                <div class="gm-mode-group-title">Sound Mode</div>
                
                <div class="gm-sound-card ${!aggressiveMode ? 'gm-selected' : ''}" data-mode="normal">
                    <div class="gm-card-left">
                        <span class="gm-card-icon">🔔</span>
                        <div>
                            <div class="gm-card-label">Gentle Chime</div>
                            <div class="gm-card-timing">Two tones, repeats every 30s</div>
                        </div>
                    </div>
                    <button type="button" class="gm-play-btn" data-preview="normal" title="Preview chime">▶ Play</button>
                </div>

                <div class="gm-sound-card ${aggressiveMode ? 'gm-selected' : ''}" data-mode="aggressive">
                    <div class="gm-card-left">
                        <span class="gm-card-icon">⏰</span>
                        <div>
                            <div class="gm-card-label">Urgent Alarm</div>
                            <div class="gm-card-timing">Rapid beeps, repeats every 5s</div>
                        </div>
                    </div>
                    <button type="button" class="gm-play-btn" data-preview="aggressive" title="Preview alarm">▶ Play</button>
                </div>
            </div>

            <div class="gm-pop-footer">
                <span>Waiting for Triage</span>
                <span>${countText}</span>
            </div>
        `

        // Attach event listeners inside popover
        const checkbox = popover.querySelector('#gm-alert-checkbox')
        if (checkbox) {
            checkbox.addEventListener('change', () => {
                handleToggle()
            })
        }

        const cards = popover.querySelectorAll('.gm-sound-card')
        cards.forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('.gm-play-btn')) return
                const mode = card.dataset.mode
                if (mode === 'aggressive' && !aggressiveMode) {
                    handleModeToggle(true)
                } else if (mode === 'normal' && aggressiveMode) {
                    handleModeToggle(false)
                }
            })
        })

        const playBtns = popover.querySelectorAll('.gm-play-btn')
        playBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation()
                const previewType = btn.dataset.preview
                if (previewType === 'aggressive') {
                    playAggressiveSound()
                } else {
                    playNormalSound()
                }
            })
        })
    }

    function handleToggle() {
        alertEnabled = !alertEnabled
        localStorage.setItem(STORAGE_KEY, alertEnabled ? 'true' : 'false')
        updateButtonState()

        if (alertEnabled) {
            previousCount = null
            checkQueue()
            startInterval()
        } else {
            stopInterval()
        }
    }

    function handleModeToggle(isAggressive) {
        aggressiveMode = isAggressive
        localStorage.setItem(MODE_STORAGE_KEY, aggressiveMode ? 'aggressive' : 'normal')
        updateButtonState()
        playAlertSound()
        if (alertEnabled) startInterval()
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
            // Close other popovers (e.g. refresh script)
            document.getElementById('gm-queue-refresh-popover')?.style.setProperty('display', 'none')
            document.getElementById('gm-queue-refresh-toggle')?.setAttribute('aria-expanded', 'false')

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

    /**
     * Injects the compact icon button and its dropdown popover into the toolbar.
     */
    function injectButton() {
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
            if (child.querySelector('[data-testid*="favorite-button"], [aria-label="Star"], #gm-queue-refresh-toggle')) {
                toolbar = child
                break
            }
        }

        if (!toolbar && h1Wrapper.nextElementSibling) {
            toolbar = h1Wrapper.nextElementSibling
        }

        if (!toolbar) return

        const flexRow = toolbar.querySelector('[data-testid*="favorite-button"], [aria-label="Star"], #gm-queue-refresh-toggle')
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
        btn.setAttribute('aria-label', 'Queue alert settings')
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
        injectButton()
        checkQueue()

        if (alertEnabled) {
            startInterval()
        }
    }

    // Observe DOM changes for SPA navigation & dynamic rendering
    let observerTimer = null
    const observer = new MutationObserver(() => {
        if (observerTimer) return
        observerTimer = setTimeout(() => {
            observerTimer = null

            if (!document.getElementById(WRAPPER_ID) && isOnTargetQueue()) {
                previousCount = null
                injectButton()
            }

            if (isOnTargetQueue() && alertEnabled && intervalId === null) {
                checkQueue()
                startInterval()
            }

            if (!isOnTargetQueue() && intervalId !== null) {
                stopInterval()
                document.getElementById(WRAPPER_ID)?.remove()
            }
        }, 500)
    })

    observer.observe(document.body, { childList: true, subtree: true })

    init()
})()
