// ==UserScript==
// @name        Jira Auto-Recovery Signal
// @namespace   Violentmonkey Scripts
// @match       https://*.atlassian.net/*
// @grant       none
// @version     1.1.0
// @author      oggmancuc
// @description Adds a pulsing green indicator if the 'recovered' label is present on the issue.
// ==/UserScript==

;(function () {
    'use strict'

    const TARGET_LABEL = 'recovered'
    const SIGNAL_ID = 'gm-recovery-dot'

    // Jira's official success green color
    const SUCCESS_GREEN = 'var(--ds-icon-success, #6A9A23)'

    function addRecoverySignal() {
        // 1. Find all label links
        const labels = document.querySelectorAll('a[href*="labels"]')
        let hasRecovered = false

        labels.forEach((label) => {
            if (label.textContent.trim().toLowerCase() === TARGET_LABEL) {
                hasRecovered = true
            }
        })

        // 2. Find the Status container target
        const statusContainer = document.querySelector('[data-testid="ref-spotlight-target-status-and-approval-spotlight"]')

        if (!statusContainer) return

        // Clean up existing signal if the label was removed or we switched tickets
        const existingSignal = document.getElementById(SIGNAL_ID)

        if (hasRecovered) {
            if (!existingSignal) {
                const dot = document.createElement('div')
                dot.id = SIGNAL_ID
                dot.title = "This issue has a 'recovered' label."

                // Styling the pulsing dot
                dot.style.cssText = `
                    width: 10px;
                    height: 10px;
                    background-color: ${SUCCESS_GREEN};
                    border-radius: 50%;
                    margin-left: 10px;
                    display: inline-block;
                    vertical-align: middle;
                    box-shadow: 0 0 0 0 ${SUCCESS_GREEN};
                    animation: gm-pulse 2s infinite;
                    cursor: help;
                `

                // Add pulse animation to the page
                if (!document.getElementById('gm-pulse-style')) {
                    const style = document.createElement('style')
                    style.id = 'gm-pulse-style'
                    style.innerHTML = `
                        @keyframes gm-pulse {
                            0% { box-shadow: 0 0 0 0 rgba(106, 154, 35, 0.7); }
                            70% { box-shadow: 0 0 0 10px rgba(106, 154, 35, 0); }
                            100% { box-shadow: 0 0 0 0 rgba(106, 154, 35, 0); }
                        }
                    `
                    document.head.appendChild(style)
                }

                // Append it to the status bar (flex container)
                const wrapper = statusContainer.querySelector('div[role="presentation"]') || statusContainer
                statusContainer.style.display = 'flex'
                statusContainer.style.alignItems = 'center'
                statusContainer.appendChild(dot)
            }
        } else if (existingSignal) {
            existingSignal.remove()
        }
    }

    // Observe changes for SPA navigation
    const observer = new MutationObserver(addRecoverySignal)
    observer.observe(document.body, { childList: true, subtree: true })

    addRecoverySignal()
})()
