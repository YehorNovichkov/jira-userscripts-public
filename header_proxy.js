// ==UserScript==
// @name        Jira Minimalist Header Proxy
// @namespace   Violentmonkey Scripts
// @match       https://*.atlassian.net/*
// @grant       none
// @version     1.6.0
// @author      oggmancuc
// @description Hides main header with a toggle button to reveal it for editing.
// ==/UserScript==

;(function () {
    'use strict'

    // 1. CSS to define the "hidden" state
    const style = document.createElement('style')
    style.id = 'gm-toggle-style'
    style.innerHTML = `
        /* When 'gm-hide-header' class is on body, hide the original elements */
        body.gm-hide-header [data-testid="issue-field-summary.ui.issue-field-summary-inline-edit--container"],
        body.gm-hide-header .css-bt2fdh,
        body.gm-hide-header [data-testid="issue-view-foundation.quick-add.quick-add-items-container"] {
            display: none !important;
        }

        /* Ensure proxy is only visible when main header is hidden */
        body:not(.gm-hide-header) #gm-proxy-header {
            opacity: 0.3; /* Dim the proxy when main header is visible to avoid confusion */
        }
    `
    document.head.appendChild(style)

    // Default to hidden state
    document.body.classList.add('gm-hide-header')

    const STICKY_HEADER_SELECTOR = '#jira-issue-header [data-component-selector="breadcrumbs-wrapper"]'
    const REAL_SUMMARY_H1 = 'h1[data-testid="issue.views.issue-base.foundation.summary.heading"]'
    const REAL_LINK_BTN = 'button[data-testid="issue.issue-view.views.issue-base.foundation.quick-add.quick-add-item.link-issue"]'

    function createProxyHeader() {
        const container = document.createElement('div')
        container.id = 'gm-proxy-header'
        container.style.cssText = `
            display: flex; align-items: center; gap: 12px; margin-left: 12px;
            padding: 2px 12px; border-left: 1px solid var(--ds-border, #444);
            flex: 1 1 auto; min-width: 0; transition: opacity 0.2s; overflow: hidden;
        `

        const title = document.createElement('div')
        title.id = 'gm-proxy-title'
        title.style.cssText = `
            font-size: 12px;
            font-weight: 500;
            color: var(--ds-text, #FFFFFF);
            line-height: 1.2;
            white-space: normal;
            word-break: break-word;
            flex: 1 1 auto;
            min-width: 0;
            display: -webkit-box;
            -webkit-line-clamp: 3;
            -webkit-box-orient: vertical;
            overflow: hidden;
        `
        title.textContent = 'Loading...'

        // --- BUTTONS GROUP ---
        const btnGroup = document.createElement('div')
        btnGroup.style.cssText = `display: flex; gap: 6px; align-items: center; flex-shrink: 0; margin-right: 6px`

        // 1. Toggle Button (Eye Icon)
        const toggleBtn = document.createElement('button')
        toggleBtn.innerHTML = '&#128065;' // Eye emoji/icon
        toggleBtn.title = 'Show/Hide Original Header for Editing'
        toggleBtn.style.cssText = `
            background: var(--ds-background-neutral, #333);
            color: var(--ds-text, #EEE);
            border: 1px solid var(--ds-border, #555);
            border-radius: 3px;
            padding: 2px 6px;
            font-size: 14px;
            cursor: pointer;
            transition: all 0.2s;
        `
        toggleBtn.onclick = () => {
            document.body.classList.toggle('gm-hide-header')
        }

        // 2. Link Button
        const linkBtn = document.createElement('button')
        linkBtn.innerHTML = `&#128279;`
        linkBtn.style.cssText = `
            background: var(--ds-background-neutral, #333);
            color: var(--ds-text, #EEE);
            border: 1px solid var(--ds-border, #555);
            border-radius: 3px;
            padding: 2px 6px;
            font-size: 14px;
            cursor: pointer;
            transition: all 0.2s;
        `
        linkBtn.onclick = () => {
            const realBtn = document.querySelector(REAL_LINK_BTN)
            if (realBtn) realBtn.click()
        }

        btnGroup.appendChild(toggleBtn)
        btnGroup.appendChild(linkBtn)
        container.appendChild(title)
        container.appendChild(btnGroup)
        return container
    }

    function sync() {
        const anchor = document.querySelector(STICKY_HEADER_SELECTOR)
        if (!anchor) return

        let proxy = document.getElementById('gm-proxy-header')
        if (!proxy) {
            proxy = createProxyHeader()
            anchor.after(proxy)
        }

        const realTitle = document.querySelector(REAL_SUMMARY_H1)
        const proxyTitle = document.getElementById('gm-proxy-title')
        if (realTitle && proxyTitle && proxyTitle.textContent !== realTitle.textContent) {
            proxyTitle.textContent = realTitle.textContent
        }
    }

    setInterval(sync, 500)
})()
