// ==UserScript==
// @name        Jira Quick Worklog Helper
// @namespace   Violentmonkey Scripts
// @match       https://*.atlassian.net/*
// @grant       none
// @version     1.4.0
// @author      oggmancuc
// @description Auto-expands the 'Log Work' modal and adds quick time buttons for logging.
// ==/UserScript==

; (function () {
    'use strict'

    const TIME_OPTIONS = ['7m', '15m', '30m']
    const EXPAND_BTN_SELECTOR = 'button[data-testid*="log-work.next-button"]'
    const TIME_SPENT_SELECTORS = [
        '[data-testid="issue-transition.ui.modal.field-renderer.field.log-work-time-spent"]',
        '[data-testid="issue.common.component.log-time-modal.modal.form.time-spent"]',
    ]

    function log(msg, obj = '') {
        // Debug logs removed for production
    }

    /**
     * This is the "Secret Sauce" for React apps.
     * It forces the value into the input in a way that React's internal state managers can't ignore.
     */
    function setReactInputValue(input, value) {
        // log(`Attempting to set value "${value}" on input:`, input);

        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        nativeInputValueSetter.call(input, value)

        // Trigger the input event so React knows it needs to update
        const inputEvent = new Event('input', { bubbles: true })
        input.dispatchEvent(inputEvent)

        // Trigger a change event for good measure
        const changeEvent = new Event('change', { bubbles: true })
        input.dispatchEvent(changeEvent)

        // log(`Value set. Current input value is: ${input.value}`);
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
            log("Container found, but couldn't find the <input> inside it yet.")
            return false
        }

        // log('Target input found. Injecting buttons...');

        const btnWrapper = document.createElement('div')
        btnWrapper.className = 'gm-quick-log-container'
        btnWrapper.style.cssText = 'display: flex; gap: 6px; margin: 8px 0;'

        TIME_OPTIONS.forEach((time) => {
            const btn = document.createElement('button')
            btn.textContent = time
            btn.type = 'button'
            btn.style.cssText = `
                background: #F4F5F7;
                border: 1px solid #DFE1E6;
                border-radius: 3px;
                padding: 4px 12px;
                cursor: pointer;
                font-size: 12px;
                font-weight: 600;
                color: #42526E;
            `

            btn.addEventListener('click', (e) => {
                log(`Button ${time} clicked.`)
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
        // log('Modal detection triggered.');

        // 1. Expansion
        const expandBtn = document.querySelector(EXPAND_BTN_SELECTOR)
        if (expandBtn) {
            const isExpanded = expandBtn.getAttribute('aria-expanded') === 'true'
            // log(`Expand button state: ${isExpanded ? 'Already Expanded' : 'Collapsed'}`);

            if (!isExpanded) {
                // log('Clicking expand button...');
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

    log('Script started. Watching for Jira modals...')
    observer.observe(document.body, { childList: true, subtree: true })
})()

