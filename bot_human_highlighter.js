// ==UserScript==
// @name        Jira Human vs Bot Highlighter
// @namespace   Violentmonkey Scripts
// @match       https://*.atlassian.net/*
// @grant       none
// @version     1.2.0
// @author      oggmancuc
// @description Visually separates monitoring alerts from human requests, and cleans up long subject lines.
// ==/UserScript==

; (function () {
    'use strict'

    // --- CONFIGURATION ---
    const BOT_NAMES = ['System', 'graylog']
    const BOT_KEYWORDS = ['Checkmk', 'PROBLEM', 'Alert:', 'Critical:', 'OMS', 'Track time for meetings', 'Communication and collaboration with other teams']


    // --- PATTERNS TO STRIP ---
    const PATTERNS_TO_STRIP = [
        /\[Checkmk\] PROBLEM (Service|Host) Alert:(.*?\/MSSQL SP:)?/g,
        / is CRITICAL/g,
    ]

    // --- CSS INJECTION ---
    // Using CSS colors instead of 'opacity'.
    // 'opacity' creates a new CSS stacking context, which causes dropdown menus to fall behind other elements.
    const style = document.createElement('style')
    style.id = 'gm-bot-style'
    style.innerHTML = `
        .gm-bot-row [data-testid*="-summary"],
        .gm-bot-row [data-testid*="-summary"] a,
        .gm-bot-row [data-testid*="-reporter"],
        .gm-bot-row [data-issue-key] {
            color: var(--ds-text-subtlest, #9cafb7) !important;
        }
    `
    document.head.appendChild(style)

    function processQueue() {
        const rows = document.querySelectorAll('div._1fjgglyw')

        rows.forEach((row) => {
            if (row.dataset.gmCategorized) return

            const summaryEl = row.querySelector('div[data-testid*="-summary"]')
            const reporterEl = row.querySelector('div[data-testid*="-reporter"]')

            if (!summaryEl || !reporterEl) return

            const summaryText = summaryEl.textContent.trim()
            const reporterText = reporterEl.textContent.trim()

            // Logic: Is it a bot?
            const isBotReporter = BOT_NAMES.some((name) => reporterText.toLowerCase().includes(name.toLowerCase()))
            const isBotSummary = BOT_KEYWORDS.some((word) => summaryText.includes(word))

            const isBot = isBotReporter || isBotSummary

            // Apply Styling
            if (isBot) {
                row.classList.add('gm-bot-row')
            }

            // Clean up the summary text by stripping any matching patterns
            const textTarget = summaryEl.querySelector('a') || summaryEl
            const originalText = textTarget.textContent
            let newText = originalText
            for (const pattern of PATTERNS_TO_STRIP) {
                newText = newText.replace(pattern, '')
            }
            if (newText !== originalText) {
                textTarget.textContent = newText.trim()
            }

            row.dataset.gmCategorized = 'true'
        })
    }

    // Handle virtual scrolling
    const observer = new MutationObserver(processQueue)
    observer.observe(document.body, { childList: true, subtree: true })

    processQueue()
})()
