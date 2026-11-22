// ==UserScript==
// @name        Jira Quick Worklog Helper
// @namespace   Violentmonkey Scripts
// @match       https://*.atlassian.net/*
// @grant       none
// @version     1.5.1
// @author      oggmancuc
// @description Auto-expands the 'Log Work' modal, adds quick time buttons to it, and adds one-click log buttons under the status button.
// ==/UserScript==

; (function () {
    'use strict'

    const TIME_OPTIONS = ['7m', '15m', '30m']
    // Atlassian design tokens (--ds-*) follow the site's light/dark theme; the status button's own classes are hashed per build and change color per status, so they aren't reused.
    const BTN_CLASS = 'gm-quick-log-btn'
    const style = document.createElement('style')
    style.textContent = `
        .${BTN_CLASS} {
            background: var(--ds-background-neutral-bold, #44546F);
            color: var(--ds-text-inverse, #FFFFFF);
            border: none;
            border-radius: var(--ds-border-radius, 3px);
            padding: 4px 12px;
            cursor: pointer;
            font: var(--ds-font-body-small, 600 12px/16px sans-serif);
            font-weight: 600;
        }
        .${BTN_CLASS}:hover { background: var(--ds-background-neutral-bold-hovered, #2C3E5D); }
        .${BTN_CLASS}:active { background: var(--ds-background-neutral-bold-pressed, #172B4D); }
        .${BTN_CLASS}:disabled { cursor: default; opacity: 0.7; }
    `
    document.head.appendChild(style)
    const EXPAND_BTN_SELECTOR = 'button[data-testid*="log-work.next-button"]'
    const TIME_SPENT_SELECTORS = [
        '[data-testid="issue-transition.ui.modal.field-renderer.field.log-work-time-spent"]',
        '[data-testid="issue.common.component.log-time-modal.modal.form.time-spent"]',
    ]

    /**
     * This is the "Secret Sauce" for React apps.
     * It forces the value into the input in a way that React's internal state managers can't ignore.
     */
    function setReactInputValue(input, value) {

        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        nativeInputValueSetter.call(input, value)

        // Trigger the input event so React knows it needs to update
        const inputEvent = new Event('input', { bubbles: true })
        input.dispatchEvent(inputEvent)

        // Trigger a change event for good measure
        const changeEvent = new Event('change', { bubbles: true })
        input.dispatchEvent(changeEvent)

    }

    function injectButtons(container) {
        const parentRow = container.parentElement
        const targetWrapper = (parentRow && parentRow.querySelector('[data-testid*="time-remaining"]'))
            ? parentRow
            : container

        if (targetWrapper.querySelector('.gm-quick-log-container') || targetWrapper.parentElement?.querySelector('.gm-quick-log-container')) {
            return true
        }

        const input = container.querySelector('input[type="text"]') || container.querySelector('input')
        if (!input) {
            return false
        }


        const btnWrapper = document.createElement('div')
        btnWrapper.className = 'gm-quick-log-container'
        btnWrapper.style.cssText = 'display: flex; gap: 6px; margin: 8px 0;'

        TIME_OPTIONS.forEach((time) => {
            const btn = document.createElement('button')
            btn.textContent = time
            btn.type = 'button'
            btn.className = BTN_CLASS

            btn.addEventListener('click', (e) => {
                e.preventDefault()
                e.stopPropagation()
                setReactInputValue(input, time)

                // Visual feedback: briefly highlight the input
                input.style.backgroundColor = '#E3F2FD'
                setTimeout(() => (input.style.backgroundColor = ''), 300)
            })

            btnWrapper.appendChild(btn)
        })

        if (targetWrapper !== container) {
            targetWrapper.before(btnWrapper)
        } else {
            const label = container.querySelector('label')
            if (label) {
                label.after(btnWrapper)
            } else {
                container.prepend(btnWrapper)
            }
        }

        return true
    }

    function runLogic() {

        // 1. Expansion
        const expandBtn = document.querySelector(EXPAND_BTN_SELECTOR)
        if (expandBtn) {
            const isExpanded = expandBtn.getAttribute('aria-expanded') === 'true'

            if (!isExpanded) {
                expandBtn.click()
            }
        }

        // 2. Button Injection (with retry)
        let attempts = 0
        const interval = setInterval(() => {
            attempts++
            const selectorStr = TIME_SPENT_SELECTORS.join(',')
            const containers = document.querySelectorAll(selectorStr)

            let injectedAll = containers.length > 0
            containers.forEach((container) => {
                if (!injectButtons(container)) {
                    injectedAll = false
                }
            })

            if (injectedAll || attempts > 30) {
                clearInterval(interval)
            }
        }, 100)
    }

    const MATCH_SELECTOR = `${EXPAND_BTN_SELECTOR}, ${TIME_SPENT_SELECTORS.join(',')}`

    // Observe body for the modal appearing
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.addedNodes.length) {
                // Look for either the expand button or any time-spent container
                if (document.querySelector(MATCH_SELECTOR)) {
                    // Disconnect briefly to avoid infinite loops if we modify the DOM
                    observer.disconnect()
                    runLogic()
                    // Re-observe
                    setTimeout(() => {
                        observer.observe(document.body, { childList: true, subtree: true })
                    }, 500)
                    break
                }
            }
        }
    })

    observer.observe(document.body, { childList: true, subtree: true })

    // --- One-click worklog buttons under the status (workflow) button, via REST API ---
    const STATUS_ANCHOR_SELECTOR = '[data-testid="ref-spotlight-target-status-and-approval-spotlight"]'

    function getIssueKey() {
        const url = location.href
        const m = url.match(/\/browse\/([A-Z][A-Z0-9_]*-\d+)/)
            || url.match(/\/projects\/[A-Z][A-Z0-9_]*\/queues\/.*\/([A-Z][A-Z0-9_]*-\d+)/)
            || url.match(/[?&]selectedIssue=([A-Z][A-Z0-9_]*-\d+)/)
        return m && m[1]
    }

    async function logWork(btn, time) {
        const key = getIssueKey()
        if (!key) return
        const label = btn.textContent
        btn.disabled = true // prevents double-logging on double click
        btn.textContent = '…'
        try {
            const res = await fetch(`/rest/api/3/issue/${key}/worklog`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ timeSpent: time }),
            })
            if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
            btn.textContent = '✓'
            btn.title = `Logged ${time} on ${key}`
        } catch (err) {
            console.error('[Worklog Helper] Failed to log work:', err)
            btn.textContent = '✗'
            btn.title = String(err)
        }
        setTimeout(() => { btn.textContent = label; btn.disabled = false }, 1500)
    }

    function injectStatusButtons() {
        const anchor = document.querySelector(STATUS_ANCHOR_SELECTOR)
        if (!anchor || anchor.nextElementSibling?.classList.contains('gm-quick-worklog-row') || !getIssueKey()) return

        const row = document.createElement('div')
        row.className = 'gm-quick-worklog-row'
        row.style.cssText = 'display: flex; gap: 6px; margin: 8px 0;'
        TIME_OPTIONS.forEach((time) => {
            const btn = document.createElement('button')
            btn.type = 'button'
            btn.textContent = time
            btn.title = `Log ${time} now`
            btn.className = BTN_CLASS
            btn.addEventListener('click', () => logWork(btn, time))
            row.appendChild(btn)
        })
        anchor.after(row)
    }

    let statusScanQueued = false
    new MutationObserver(() => {
        if (statusScanQueued) return
        statusScanQueued = true
        requestAnimationFrame(() => { statusScanQueued = false; injectStatusButtons() })
    }).observe(document.body, { childList: true, subtree: true })
})()

