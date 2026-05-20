// ==UserScript==
// @name        Jira Ticket List Highlighter
// @namespace   Violentmonkey Scripts
// @match       https://*.atlassian.net/*
// @grant       none
// @version     1.2.0
// @author      oggmancuc
// @description Dynamically highlights rows in the Jira issue list when their status is "In Progress".
// ==/UserScript==

;(function () {
    'use strict'

    // CONFIGURATION
    const STATUS_STYLES = {
        'In Progress': {
            bg: 'var(--ds-background-information-subtle, rgba(0, 82, 204, 0.15))',
            border: 'var(--ds-border-information, #579DFF)'
        },
        'Pending': {
            bg: '',
            border: 'var(--ds-border-neutral, #DFE1E6)' // Gray border
        },
        'Approval': {
            bg: '',
            border: 'var(--ds-border-warning, #F6C343)' // Yellowish gray border
        }
    }

    function highlightRows() {
        const statusCells = document.querySelectorAll('div[data-testid*="-status"]')

        statusCells.forEach((cell) => {
            const row = cell.closest('div._1fjgglyw')
            if (!row) return

            const status = cell.textContent.trim()
            const targetStyle = STATUS_STYLES[status]

            if (targetStyle) {
                // Apply highlight if it's not already there for THIS status
                if (row.dataset.gmHighlighted !== status) {
                    row.style.backgroundColor = targetStyle.bg || ''
                    row.style.borderLeft = targetStyle.border ? `4px solid ${targetStyle.border}` : ''
                    row.dataset.gmHighlighted = status
                }
            } else {
                // If the status is not a target, remove the highlight if it exists.
                if (row.dataset.gmHighlighted) {
                    row.style.backgroundColor = ''
                    row.style.borderLeft = ''
                    delete row.dataset.gmHighlighted
                }
            }
        })
    }

    // Since Jira is a single-page app with virtual scrolling,
    // we observe the body for changes to catch new rows.
    const observer = new MutationObserver((mutations) => {
        highlightRows()
    })

    observer.observe(document.body, {
        childList: true,
        subtree: true,
    })

    // Run once on load
    highlightRows()
})()
