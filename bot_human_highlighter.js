// ==UserScript==
// @name        Jira Human vs Bot Highlighter
// @namespace   Violentmonkey Scripts
// @match       https://*.atlassian.net/*
// @grant       none
// @version     1.2.5
// @author      oggmancuc
// @description Visually separates monitoring alerts from human requests, and cleans up long subject lines.
// ==/UserScript==

; (function () {
    'use strict'

    // --- CONFIGURATION ---
    const BOT_NAMES = ['System', 'graylog']
    const BOT_KEYWORDS = ['Checkmk', 'PROBLEM', 'Alert:', 'Critical:', 'OMS', 'Track time for meetings', 'Communication and collaboration with other teams', 'Monitoring and Dispatching', 'Servers maintenance']


    // --- PATTERNS TO STRIP ---
    const PATTERNS_TO_STRIP = [
        /\[Checkmk\] PROBLEM (Service|Host) Alert:(.*?\/MSSQL SP:)?/g,
        / is CRITICAL/g,
        /^\s*\[Prometheus\]:\s*/,
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
        const summaryCells = document.querySelectorAll('div[data-testid*="-summary"]')

        summaryCells.forEach((summaryEl) => {
            const row = summaryEl.closest('div[role="row"]') ||
                summaryEl.closest('.virtual-table-row') ||
                summaryEl.closest('[data-vc*="row"]') ||
                summaryEl.closest('div._1fjgglyw')
            if (!row) return

            // Keyed on the text we left behind, so a summary React updates later gets processed again
            if (row.dataset.gmCategorized === summaryEl.textContent) return

            const reporterEl = row.querySelector('div[data-testid*="-reporter"]')

            const summaryText = summaryEl.textContent.trim()
            const reporterText = reporterEl ? reporterEl.textContent.trim() : ''

            // Logic: Is it a bot?
            const isBotReporter = reporterEl ? BOT_NAMES.some((name) => reporterText.toLowerCase().includes(name.toLowerCase())) : false
            const isBotSummary = BOT_KEYWORDS.some((word) => summaryText.includes(word))

            const isBot = isBotReporter || isBotSummary

            // Apply Styling
            if (isBot) {
                row.classList.add('gm-bot-row')
            }

            // Strip patterns by editing the existing text nodes in place. Setting textContent would
            // swap in a new node, and React's later updates would go to the detached old one.
            const textTarget = summaryEl.querySelector('a') || summaryEl
            const walker = document.createTreeWalker(textTarget, NodeFilter.SHOW_TEXT)
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                let newText = node.nodeValue
                for (const pattern of PATTERNS_TO_STRIP) {
                    newText = newText.replace(pattern, '')
                }
                if (newText !== node.nodeValue) node.nodeValue = newText.trim()
            }

            row.dataset.gmCategorized = summaryEl.textContent
        })
    }

    // Handle virtual scrolling
    // Run at most once per frame: Jira mutates the DOM constantly
    let scheduled = false
    const schedule = () => {
        if (scheduled) return
        scheduled = true
        requestAnimationFrame(() => { scheduled = false; processQueue() })
    }
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true })

    processQueue()
})()
