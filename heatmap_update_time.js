// ==UserScript==
// @name        Jira Ticket Heat-Map & Unread Indicator
// @namespace   Violentmonkey Scripts
// @match       https://*.atlassian.net/*
// @grant       none
// @version     1.8.0
// @author      oggmancuc
// @description Colors tickets by update age, adds unread dot, and auto-cleans old view data.
// ==/UserScript==

; (function () {
    'use strict'

    // --- CONFIGURATION ---
    const MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000 // Gradient ends at 2 days
    const GRADIENT_BIAS = 0.5 // 0.5 makes it turn gray fast. 1.0 is linear.
    const COLOR_FRESH = { r: 255, g: 171, b: 0 } // Orange
    const COLOR_OLD = { r: 107, g: 119, b: 140 } // Gray
    const STORAGE_KEY = 'gm_jira_last_viewed'
    const RETENTION_DAYS = 30 // How many days to remember a ticket was viewed.

    // --- LOCALSTORAGE HELPERS ---
    function getLastViewedTimes() {
        try {
            const data = localStorage.getItem(STORAGE_KEY)
            return data ? JSON.parse(data) : {}
        } catch (e) {
            console.error('[JiraHeatMap] Error reading from localStorage', e)
            return {}
        }
    }

    function setLastViewedTime(ticketId) {
        const times = getLastViewedTimes()
        times[ticketId] = new Date().getTime()
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(times))
        } catch (e) {
            console.error('[JiraHeatMap] Error writing to localStorage', e)
        }
    }

    function cleanupOldViewedTimes() {
        const times = getLastViewedTimes()
        const retentionPeriodMs = RETENTION_DAYS * 24 * 60 * 60 * 1000
        const now = new Date().getTime()
        let changed = false

        for (const ticketId in times) {
            if (now - times[ticketId] > retentionPeriodMs) {
                delete times[ticketId]
                changed = true
            }
        }

        if (changed) {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(times))
            } catch (e) {
                console.error('[JiraHeatMap] Error writing cleaned data to localStorage', e)
            }
        }
    }

    // --- CORE LOGIC ---
    function interpolateColor(p) {
        // Apply the bias to the percentage
        const biasedP = Math.pow(p, GRADIENT_BIAS)

        const r = Math.round(COLOR_FRESH.r + (COLOR_OLD.r - COLOR_FRESH.r) * biasedP)
        const g = Math.round(COLOR_FRESH.g + (COLOR_OLD.g - COLOR_FRESH.g) * biasedP)
        const b = Math.round(COLOR_FRESH.b + (COLOR_OLD.b - COLOR_FRESH.b) * biasedP)
        return `rgb(${r}, ${g}, ${b})`
    }

    function parseJiraDate(dateStr) {
        // Handles format like "21/Apr/26 10:48" (assuming GMT+2 time)
        const monthMap = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 }
        const parts = dateStr.split(/[\s/:]+/) // e.g., ["21", "Apr", "26", "10", "48"]
        if (parts.length < 5) return null

        const day = parseInt(parts[0], 10)
        const monthIndex = monthMap[parts[1]]
        const year = parseInt('20' + parts[2], 10)
        const hour = parseInt(parts[3], 10)
        const minute = parseInt(parts[4], 10)

        if (monthIndex === undefined) return null

        // 1. Treat the parsed time as if it were UTC
        const dateAsUtc = new Date(Date.UTC(year, monthIndex, day, hour, minute))

        // 2. Calculate offset at this specific date/time
        const tzStr = dateAsUtc.toLocaleString('en-US', { timeZone: 'Etc/GMT-2' })
        const utcStr = dateAsUtc.toLocaleString('en-US', { timeZone: 'UTC' })
        const tzOffsetMs = new Date(tzStr).getTime() - new Date(utcStr).getTime()

        // 3. Shift the time backwards by the offset to get the true absolute timestamp
        return new Date(dateAsUtc.getTime() - tzOffsetMs)
    }

    function getRelativeTimeString(diffMs) {
        const totalMinutes = Math.floor(diffMs / (1000 * 60))
        const totalHours = Math.floor(totalMinutes / 60)
        const days = Math.floor(totalHours / 24)
        const remainingHours = totalHours % 24
        const remainingMinutes = totalMinutes % 60

        if (days === 0) return `${totalHours}h ${remainingMinutes}m`
        return `${days}d ${remainingHours}h`
    }

    function processTimestamps() {
        const lastViewedTimes = getLastViewedTimes()
        // Target the container cells for both "updated" and "resolutiondate" fields.
        const updatedCells = document.querySelectorAll('[data-testid*="-updated"], [data-testid*="-resolutiondate"]')

        updatedCells.forEach((cell) => {
            const isResolution = cell.getAttribute('data-testid').includes('-resolutiondate')

            // Find the native Jira time element which contains the absolute date string.
            const nativeTimeEl = cell.querySelector('div[title]')
            if (!nativeTimeEl) return

            // Find or create our custom span
            let customTimeEl = cell.querySelector('.gm-heatmap-time')
            if (!customTimeEl) {
                customTimeEl = document.createElement('span')
                customTimeEl.className = 'gm-heatmap-time'
                nativeTimeEl.style.display = 'none'
                    ; (nativeTimeEl.parentElement || cell).appendChild(customTimeEl)
            }

            // --- Data Extraction ---
            let ticketId = null
            const testId = cell.getAttribute('data-testid') || ''
            const ticketIdMatch = testId.match(/row([A-Z]+-\d+)-/)

            if (ticketIdMatch && ticketIdMatch[1]) {
                ticketId = ticketIdMatch[1]
            } else {
                const row = cell.closest('div._1fjgglyw')
                if (row) {
                    const issueLink = row.querySelector('[data-issue-key]')
                    if (issueLink) {
                        ticketId = issueLink.getAttribute('data-issue-key')
                    }
                }
            }
            if (!ticketId) return

            const lastViewedTime = lastViewedTimes[ticketId] || 0
            const timestampStr = nativeTimeEl.textContent.trim()
            if (!timestampStr) return
            const dateObj = parseJiraDate(timestampStr)
            if (!dateObj) return

            // --- Calculation ---
            const updateTime = dateObj.getTime()
            const diff = new Date().getTime() - updateTime
            if (isNaN(diff)) return
            const rawP = Math.min(Math.max(diff / MAX_AGE_MS, 0), 1)
            const displayColor = interpolateColor(rawP)
            const relativeTimeString = getRelativeTimeString(diff)
            const showDot = !isResolution && updateTime > lastViewedTime

            // --- Check if update is needed to prevent infinite loops ---
            // We save the state in a data attribute. If nothing changed, we skip the DOM update.
            const stateHash = `${relativeTimeString}|${displayColor}|${showDot}`
            if (customTimeEl.dataset.gmState === stateHash) return
            customTimeEl.dataset.gmState = stateHash

            // --- Render/Update ---
            customTimeEl.style.fontWeight = '600'
            customTimeEl.style.color = displayColor

            const actionText = isResolution ? 'Resolved' : 'Updated'
            customTimeEl.title =
                `${actionText} on ${dateObj.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })}` +
                (showDot ? ' (after you last viewed this ticket)' : '')

            // Rebuild content to handle updates cleanly
            customTimeEl.innerHTML = '' // Clear old text and dot
            customTimeEl.appendChild(document.createTextNode(relativeTimeString))

            if (showDot) {
                const dot = document.createElement('span')
                dot.style.cssText = `
                    display: inline-block; width: 6px; height: 6px;
                    background-color: ${displayColor};
                    border-radius: 50%; margin-left: 6px;
                    box-shadow: 0 0 8px ${displayColor};
                    cursor: pointer;
                `
                dot.title = 'Click to mark as read'
                dot.addEventListener('click', (e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setLastViewedTime(ticketId)
                    processTimestamps() // Force immediate re-evaluation
                })
                customTimeEl.appendChild(dot)
            }
        })
    }

    // --- TICKET VIEW TRACKER ---
    // This part of the script detects when you are viewing a ticket and saves the timestamp.
    let lastProcessedTicketUrl = ''
    function trackTicketView() {
        const currentUrl = window.location.href
        if (currentUrl === lastProcessedTicketUrl) return

        // Regex to find a ticket ID like PROJ-123 in the URL
        const ticketMatch = currentUrl.match(/\/browse\/([A-Z]+-\d+)/) || currentUrl.match(/\/projects\/[A-Z]+\/queues\/.*\/([A-Z]+-\d+)/)

        if (ticketMatch && ticketMatch[1]) {
            const ticketId = ticketMatch[1]
            setLastViewedTime(ticketId)
        }
        lastProcessedTicketUrl = currentUrl
    }

    // --- INITIALIZATION ---
    cleanupOldViewedTimes() // Run cleanup on script start.

    const listObserver = new MutationObserver(processTimestamps)
    listObserver.observe(document.body, { childList: true, subtree: true })

    // Periodically update the relative time display
    setInterval(processTimestamps, 3000) // Update times every 3 seconds

    // Check for ticket views periodically
    setInterval(trackTicketView, 1000)

    processTimestamps()
    trackTicketView() // Run once on load
})()
