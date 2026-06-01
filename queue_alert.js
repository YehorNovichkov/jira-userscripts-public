// ==UserScript==
// @name        Jira Queue Alert
// @namespace   Violentmonkey Scripts
// @match       https://*.atlassian.net/*
// @grant       none
// @version     1.0.1
// @author      oggmancuc
// @description Plays an alert sound when tickets appear in the "Waiting for Triage" queue. Repeats every 30/5 seconds while tickets remain, with a toggle button and two modes (normal/aggressive).
// ==/UserScript==

; (function () {
    'use strict'

    const QUEUE_NAME = 'Waiting for Triage'
    const NORMAL_INTERVAL_MS = 30000   // 30 seconds
    const AGGRESSIVE_INTERVAL_MS = 5000 // 5 seconds
    const STORAGE_KEY = 'gm-queue-alert-enabled'
    const MODE_STORAGE_KEY = 'gm-queue-alert-mode' // 'normal' or 'aggressive'
    const BUTTON_ID = 'gm-queue-alert-toggle'
    const MODE_BUTTON_ID = 'gm-queue-alert-mode-toggle'
    const STYLE_ID = 'gm-queue-alert-style'

    let alertEnabled = localStorage.getItem(STORAGE_KEY) !== 'false' // default ON
    let aggressiveMode = localStorage.getItem(MODE_STORAGE_KEY) === 'aggressive' // default normal
    let previousCount = null
    let intervalId = null
    let audioCtx = null // persistent AudioContext — created once, reused forever

    // ── Resilient DOM helpers ────────────────────────────────────────────
    // Prefer text content / aria / data-testid checks over brittle class names.

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
     * Extracts the ticket count from the live-region counter.
     * The element contains text like "3 work items" or "1 work item".
     * Falls back to counting rendered table rows.
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

        return null // unable to determine
    }

    // ── Sound generation (Web Audio API — no external files) ────────────
    // Uses a persistent AudioContext so that once the user unlocks audio
    // (via any click on the page), interval-triggered playback works too.

    function getAudioContext() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)()
        }
        // Resume if suspended (browser autoplay policy)
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

    // Aggressive mode: rapid alarm beeps — sawtooth wave, higher volume, repeating pattern
    function playAggressiveSound() {
        try {
            const ctx = getAudioContext()
            const now = ctx.currentTime

            // 6 rapid beeps: alternating high/low for urgency
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

    // Unlock the AudioContext on the first user interaction anywhere on the page.
    // This ensures the interval-triggered sounds can play.
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
            // Ticket just appeared in an empty queue — play immediately
            playAlertSound()
        }

        previousCount = count
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
        }, interval)
    }


    // ── Toggle button ───────────────────────────────────────────────────
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return

        const style = document.createElement('style')
        style.id = STYLE_ID
        style.innerHTML = `
            #${BUTTON_ID},
            #${MODE_BUTTON_ID} {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 4px;
                border: none;
                border-radius: 3px;
                padding: 4px 8px;
                cursor: pointer;
                font: var(--ds-font-body-UNSAFE_small, normal 400 12px/16px ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Ubuntu, system-ui, sans-serif);
                transition: background 0.15s, color 0.15s, box-shadow 0.15s;
                vertical-align: middle;
                white-space: nowrap;
                user-select: none;
            }
            #${BUTTON_ID}.gm-alert-on {
                background: var(--ds-background-success, #DCFFF1);
                color: var(--ds-text-success, #206E4E);
            }
            #${BUTTON_ID}.gm-alert-off {
                background: var(--ds-background-neutral, #091E420F);
                color: var(--ds-text-subtlest, #6B6E76);
            }
            #${MODE_BUTTON_ID}.gm-mode-normal {
                background: var(--ds-background-neutral, #091E420F);
                color: var(--ds-text-subtlest, #6B6E76);
            }
            #${MODE_BUTTON_ID}.gm-mode-aggressive {
                background: var(--ds-background-warning, #FFF3CD);
                color: var(--ds-text-warning, #A54800);
            }
            #${BUTTON_ID}:hover,
            #${MODE_BUTTON_ID}:hover {
                box-shadow: 0 0 0 2px var(--ds-border-focused, #388BFF);
            }
            #${BUTTON_ID} .gm-alert-icon,
            #${MODE_BUTTON_ID} .gm-alert-icon {
                font-size: 14px;
                line-height: 1;
            }
        `
        document.head.appendChild(style)
    }

    function updateButtonState() {
        const btn = document.getElementById(BUTTON_ID)
        if (btn) {
            if (alertEnabled) {
                btn.className = 'gm-alert-on'
                btn.setAttribute('aria-pressed', 'true')
                btn.title = 'Queue alert is ON — click to mute'
                btn.innerHTML = '<span class="gm-alert-icon">🔔</span><span>Alert ON</span>'
            } else {
                btn.className = 'gm-alert-off'
                btn.setAttribute('aria-pressed', 'false')
                btn.title = 'Queue alert is OFF — click to enable'
                btn.innerHTML = '<span class="gm-alert-icon">🔕</span><span>Alert OFF</span>'
            }
        }

        const modeBtn = document.getElementById(MODE_BUTTON_ID)
        if (modeBtn) {
            if (aggressiveMode) {
                modeBtn.className = 'gm-mode-aggressive'
                modeBtn.setAttribute('aria-pressed', 'true')
                modeBtn.title = 'Aggressive alarm — click for normal chime'
                modeBtn.innerHTML = '<span class="gm-alert-icon">⏰</span><span>Alarm</span>'
            } else {
                modeBtn.className = 'gm-mode-normal'
                modeBtn.setAttribute('aria-pressed', 'false')
                modeBtn.title = 'Normal chime — click for aggressive alarm'
                modeBtn.innerHTML = '<span class="gm-alert-icon">🔔</span><span>Chime</span>'
            }
        }
    }

    function handleToggle() {
        alertEnabled = !alertEnabled
        localStorage.setItem(STORAGE_KEY, alertEnabled)
        updateButtonState()

        if (alertEnabled) {
            previousCount = null
            checkQueue()
            startInterval()
        } else {
            stopInterval()
        }
    }

    function handleModeToggle() {
        aggressiveMode = !aggressiveMode
        localStorage.setItem(MODE_STORAGE_KEY, aggressiveMode ? 'aggressive' : 'normal')
        updateButtonState()
        // Play a preview so the user hears what they selected
        playAlertSound()
        // Restart the interval with the new timing
        if (alertEnabled) startInterval()
    }

    /**
     * Finds the toolbar area next to the queue heading and injects our toggle.
     *
     * Page structure (simplified):
     *   div (row: h1 + toolbar)
     *     ├── div (wraps h1)
     *     │     └── h1 "Waiting for Triage"
     *     └── div (toolbar: Star, Share, ...)
     *           └── div
     *                 └── div (flex row with buttons)  ← we inject here
     *
     * Strategy: start from the h1, walk up to the row container, then find the
     * sibling div that contains the Star/Share buttons.
     */
    function injectButton() {
        if (document.getElementById(BUTTON_ID) && document.getElementById(MODE_BUTTON_ID)) {
            updateButtonState()
            return
        }

        const heading = getQueueHeading()
        if (!heading) return

        // Walk up from h1 to its wrapping div, then to the row container
        const h1Wrapper = heading.parentElement
        if (!h1Wrapper) return

        const rowContainer = h1Wrapper.parentElement
        if (!rowContainer) return

        // The toolbar is the sibling div of the h1 wrapper
        let toolbar = null

        // Strategy 1: find sibling that contains the Star button (most reliable)
        for (const child of rowContainer.children) {
            if (child === h1Wrapper) continue
            if (child.querySelector('[data-testid*="favorite-button"], [aria-label="Star"]')) {
                toolbar = child
                break
            }
        }

        // Strategy 2: just use the next sibling of the h1 wrapper
        if (!toolbar && h1Wrapper.nextElementSibling) {
            toolbar = h1Wrapper.nextElementSibling
        }

        if (!toolbar) return

        // Drill into the flex row that directly holds the buttons
        // (look for the innermost div that has the Star/Share as direct or near children)
        const flexRow = toolbar.querySelector('[data-testid*="favorite-button"], [aria-label="Star"]')
            ?.closest('div[class]')?.parentElement || toolbar

        // Alert on/off toggle
        if (!document.getElementById(BUTTON_ID)) {
            const btn = document.createElement('button')
            btn.id = BUTTON_ID
            btn.type = 'button'
            btn.setAttribute('aria-label', 'Toggle queue alert sound')
            btn.addEventListener('click', handleToggle)
            flexRow.appendChild(btn)
        }

        // Sound mode toggle (normal / aggressive)
        if (!document.getElementById(MODE_BUTTON_ID)) {
            const modeBtn = document.createElement('button')
            modeBtn.id = MODE_BUTTON_ID
            modeBtn.type = 'button'
            modeBtn.setAttribute('aria-label', 'Toggle alert sound mode')
            modeBtn.addEventListener('click', handleModeToggle)
            flexRow.appendChild(modeBtn)
        }

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

    // Observe DOM changes for SPA navigation & dynamic rendering.
    // Debounced to avoid restarting the interval on every single mutation.
    let observerTimer = null
    const observer = new MutationObserver(() => {
        if (observerTimer) return
        observerTimer = setTimeout(() => {
            observerTimer = null

            // Re-inject button if it was removed (SPA navigation)
            if (!document.getElementById(BUTTON_ID)) {
                previousCount = null
                injectButton()
            }

            // Ensure the interval is running when it should be
            if (isOnTargetQueue() && alertEnabled && intervalId === null) {
                checkQueue()
                startInterval()
            }

            // Stop the interval if we navigated away from the target queue
            if (!isOnTargetQueue() && intervalId !== null) {
                stopInterval()
            }
        }, 500)
    })

    observer.observe(document.body, { childList: true, subtree: true })

    init()
})()
