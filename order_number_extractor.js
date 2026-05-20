// ==UserScript==
// @name        Jira Order Number Extractor
// @namespace   Violentmonkey Scripts
// @match       https://*.atlassian.net/*
// @grant       none
// @version     1.2.0
// @author      oggmancuc
// @description Extracts 10xx/30xx orders from the issue description and lists them for quick copying.
// ==/UserScript==

;(function () {
    'use strict'

    // Regex: 9 or 10 digits starting with 10 or 30
    const ORDER_REGEX = /\b(10|30)\d{7,8}\b/g

    // Stable selectors from your provided HTML
    const CONTENT_CONTAINER = '[data-testid="issue.views.issue-details.issue-layout.left-most-column"]'
    const ANCHOR_ELEMENT = '[data-testid="ref-spotlight-target-reporter-spotlight"]'

    function copyToClipboard(text, element) {
        navigator.clipboard.writeText(text).then(() => {
            const originalText = element.textContent
            const originalColor = element.style.color

            element.style.color = '#36B37E' // Success Green
            element.textContent = 'Copied!'

            setTimeout(() => {
                element.style.color = originalColor
                element.textContent = originalText
            }, 800)
        })
    }

    function findAndDisplayOrders() {
        const anchor = document.querySelector(ANCHOR_ELEMENT)
        const source = document.querySelector(CONTENT_CONTAINER)

        // Prevent running if anchor/source missing, or if we already added the list to THIS anchor
        if (!anchor || !source || anchor.nextElementSibling?.classList.contains('gm-order-wrapper')) return

        // Get all text from the left column
        const textContent = source.innerText
        const matches = textContent.match(ORDER_REGEX)

        if (!matches) return

        // Filter for unique order numbers
        const uniqueOrders = [...new Set(matches)]

        const wrapper = document.createElement('div')
        wrapper.className = 'gm-order-wrapper'
        wrapper.style.cssText = `
            margin: 12px 0;
            padding: 10px;
            background: var(--ds-background-neutral-subtle, #2C2E33);
            border: 1px solid var(--ds-border, #444);
            border-left: 4px solid #36B37E;
            border-radius: 4px;
        `

        const titleContainer = document.createElement('div')
        titleContainer.style.cssText = 'display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;'

        const title = document.createElement('div')
        title.textContent = `Found Orders (${uniqueOrders.length}):`
        title.style.cssText = `
            font-size: 11px;
            font-weight: bold;
            color: var(--ds-text-subtlest, #888);
            text-transform: uppercase;
        `
        
        const copyAllBtn = document.createElement('button')
        copyAllBtn.textContent = 'Copy All'
        copyAllBtn.style.cssText = `
            background: #36B37E; color: white; border: none; border-radius: 3px;
            padding: 2px 8px; font-size: 11px; cursor: pointer; font-weight: bold;
        `
        copyAllBtn.onclick = () => {
            navigator.clipboard.writeText(uniqueOrders.join(', ')).then(() => {
                const orig = copyAllBtn.textContent
                copyAllBtn.textContent = 'Copied!'
                setTimeout(() => copyAllBtn.textContent = orig, 800)
            })
        }

        titleContainer.appendChild(title)
        titleContainer.appendChild(copyAllBtn)
        wrapper.appendChild(titleContainer)

        const listContainer = document.createElement('div')
        listContainer.style.cssText = `display: flex; flex-wrap: wrap; gap: 6px;`

        // Limit to 10 as requested
        const toDisplay = uniqueOrders.slice(0, 10)

        toDisplay.forEach((order) => {
            const pill = document.createElement('div')
            pill.textContent = order
            pill.style.cssText = `
                background: var(--ds-background-neutral, #3D3F47);
                color: var(--ds-text, #FFF);
                padding: 2px 8px;
                border-radius: 3px;
                font-size: 12px;
                font-family: monospace;
                cursor: pointer;
                transition: background 0.2s;
                border: 1px solid transparent;
            `

            pill.onmouseover = () => (pill.style.borderColor = '#36B37E')
            pill.onmouseout = () => (pill.style.borderColor = 'transparent')

            pill.onclick = () => copyToClipboard(order, pill)
            listContainer.appendChild(pill)
        })

        if (uniqueOrders.length > 10) {
            const more = document.createElement('span')
            more.textContent = 'and more...'
            more.style.cssText = 'font-size: 11px; color: var(--ds-text-subtlest, #6B6E76); align-self: center; margin-left: 4px;'
            listContainer.appendChild(more)
        }

        wrapper.appendChild(listContainer)
        anchor.after(wrapper)

        // Highlight orders in the text
        const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT, null, false)
        let node
        const nodesToReplace = []
        while ((node = walker.nextNode())) {
            // Skip our own UI elements
            if (node.parentElement && node.parentElement.closest('.gm-order-wrapper')) continue
            if (node.parentElement && node.parentElement.classList.contains('gm-order-highlight')) continue
            
            if (node.nodeValue.match(ORDER_REGEX)) {
                nodesToReplace.push(node)
            }
        }
        
        nodesToReplace.forEach(textNode => {
            const span = document.createElement('span')
            span.innerHTML = textNode.nodeValue.replace(ORDER_REGEX, (match) => {
                return `<span class="gm-order-highlight" style="color: var(--ds-text-success, #36B37E); background-color: var(--ds-background-success-subtle, rgba(54, 179, 126, 0.15)); padding: 0 4px; border-radius: 3px; font-family: monospace;">${match}</span>`
            })
            textNode.parentNode.replaceChild(span, textNode)
        })
    }

    // MutationObserver is vital for Jira because it's a Single Page App (SPA)
    const observer = new MutationObserver((mutations) => {
        // If the anchor or the content container appears/changes, re-scan
        if (document.querySelector(ANCHOR_ELEMENT)) {
            findAndDisplayOrders()
        }
    })

    observer.observe(document.body, { childList: true, subtree: true })

    // Initial check
    findAndDisplayOrders()
})()
