// ==UserScript==
// @name        Jira Starred Queues Bar
// @namespace   Violentmonkey Scripts
// @match       https://*.atlassian.net/*
// @grant       none
// @version     1.2.2
// @author      oggmancuc
// @description Duplicates starred queues into a neat, responsive horizontal bar in the queue header with drag-to-reorder, local renaming, and single-row expand/collapse.
// ==/UserScript==

; (function () {
    'use strict'

    const BAR_ID = 'gm-starred-queues-bar'
    const STYLE_ID = 'gm-starred-queues-style'
    const STORAGE_KEY = 'gm-starred-queues-cache-v2'
    const STORAGE_ORDER_KEY = 'gm-starred-queues-order-v1'
    const STORAGE_RENAMES_KEY = 'gm-starred-queues-renames-v1'
    const STORAGE_COLLAPSED_KEY = 'gm-starred-queues-collapsed-v1'

    // ── Storage Helpers ────────────────────────────────────────────────
    let cachedQueues = []
    try {
        const saved = localStorage.getItem(STORAGE_KEY)
        if (saved) {
            const parsed = JSON.parse(saved)
            if (Array.isArray(parsed)) {
                const seenHrefs = new Set()
                const seenNames = new Set()
                cachedQueues = parsed.filter(q => {
                    if (!q || !q.href || !q.name) return false
                    const cleanHref = q.href.split('?')[0].split('#')[0]
                    if (!cleanHref.includes('/queues/')) return false
                    if (seenHrefs.has(cleanHref) || seenNames.has(q.name)) return false
                    seenHrefs.add(cleanHref)
                    seenNames.add(q.name)
                    q.href = cleanHref
                    return true
                })
            }
        }
    } catch (_) { }

    let customOrder = []
    try {
        const saved = localStorage.getItem(STORAGE_ORDER_KEY)
        if (saved) {
            const parsed = JSON.parse(saved)
            if (Array.isArray(parsed)) customOrder = parsed
        }
    } catch (_) { }

    function saveCustomOrder(order) {
        customOrder = order
        try {
            localStorage.setItem(STORAGE_ORDER_KEY, JSON.stringify(order))
        } catch (_) { }
    }

    let customRenames = {}
    try {
        const saved = localStorage.getItem(STORAGE_RENAMES_KEY)
        if (saved) {
            const parsed = JSON.parse(saved)
            if (parsed && typeof parsed === 'object') customRenames = parsed
        }
    } catch (_) { }

    function saveCustomRenames() {
        try {
            localStorage.setItem(STORAGE_RENAMES_KEY, JSON.stringify(customRenames))
        } catch (_) { }
    }

    let isBarCollapsed = true
    try {
        const saved = localStorage.getItem(STORAGE_COLLAPSED_KEY)
        if (saved !== null) {
            isBarCollapsed = saved === 'true'
        } else {
            isBarCollapsed = true
        }
    } catch (_) { }

    function saveCollapsedState(collapsed) {
        try {
            localStorage.setItem(STORAGE_COLLAPSED_KEY, collapsed ? 'true' : 'false')
        } catch (_) { }
    }

    function applyCustomOrder(queues) {
        if (!customOrder || customOrder.length === 0) return queues
        const orderMap = new Map()
        customOrder.forEach((href, idx) => orderMap.set(href, idx))

        return [...queues].sort((a, b) => {
            const indexA = orderMap.has(a.href) ? orderMap.get(a.href) : 99999
            const indexB = orderMap.has(b.href) ? orderMap.get(b.href) : 99999
            if (indexA !== indexB) return indexA - indexB
            return 0
        })
    }

    function getRenderedKeys(queues) {
        return queues.map(q => `${q.href}:${customRenames[q.href] || q.name}`).join('|')
    }

    // Drag & drop state
    let draggedChip = null
    let hasDragged = false
    let dragStartTime = 0

    // ── CSS Injection ──────────────────────────────────────────────────
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return

        const style = document.createElement('style')
        style.id = STYLE_ID
        style.innerHTML = `
            #${BAR_ID} {
                display: flex;
                flex-direction: row;
                align-items: flex-start;
                align-self: center;
                gap: 4px 6px;
                flex: 1 1 auto;
                min-width: 0;
                margin: 0 14px;
                padding: 2px 0;
                box-sizing: border-box;
                user-select: none;
            }

            .gm-bar-prefix {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                height: 24px;
                padding: 0 4px 0 0;
                color: var(--ds-icon-accent-yellow, #E2B203);
                flex-shrink: 0;
            }

            .gm-chips-container {
                display: flex;
                flex-direction: row;
                flex-wrap: wrap;
                align-items: center;
                gap: 4px 6px;
                flex: 1 1 auto;
                min-width: 0;
                transition: max-height 0.2s cubic-bezier(0.2, 0, 0, 1);
            }

            /* Collapsed single row state */
            #${BAR_ID}.gm-collapsed .gm-chips-container {
                max-height: 24px;
                overflow: hidden;
            }

            /* Expanded state */
            #${BAR_ID}:not(.gm-collapsed) .gm-chips-container {
                max-height: 600px;
            }

            /* Expand / Collapse toggle button */
            .gm-bar-toggle-btn {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 22px;
                height: 22px;
                border-radius: 11px;
                flex-shrink: 0;
                margin-top: 1px;
                cursor: pointer;
                background: var(--ds-background-neutral-subtle, rgba(9, 30, 66, 0.04));
                color: var(--ds-text-subtle, #626F86);
                border: 1px solid var(--ds-border, rgba(9, 30, 66, 0.12));
                padding: 0;
                outline: none;
                transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease, transform 0.15s ease;
            }

            .gm-bar-toggle-btn:hover {
                background: var(--ds-background-neutral, rgba(9, 30, 66, 0.08));
                border-color: var(--ds-border-focused, #388BFF);
                color: var(--ds-text, #172B4D);
            }

            .gm-bar-toggle-btn:active {
                transform: scale(0.92);
            }

            .gm-bar-toggle-btn svg {
                transition: transform 0.2s ease;
            }

            #${BAR_ID}:not(.gm-collapsed) .gm-bar-toggle-btn svg {
                transform: rotate(180deg);
            }

            .gm-queue-chip {
                display: inline-flex;
                align-items: center;
                gap: 5px;
                height: 24px;
                padding: 0 7px 0 9px;
                border-radius: 12px;
                background: var(--ds-background-neutral-subtle, rgba(9, 30, 66, 0.04));
                color: var(--ds-text, #172B4D);
                border: 1px solid var(--ds-border, rgba(9, 30, 66, 0.12));
                font: var(--ds-font-body-UNSAFE_small, normal 500 12px/16px ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
                text-decoration: none !important;
                white-space: nowrap;
                flex-shrink: 0;
                //cursor: grab;
                box-sizing: border-box;
                transition: background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease, opacity 0.15s ease;
            }

            .gm-queue-chip:hover {
                background: var(--ds-background-neutral, rgba(9, 30, 66, 0.08));
                border-color: var(--ds-border-focused, #388BFF);
                color: var(--ds-text, #172B4D);
                transform: translateY(-1px);
                box-shadow: 0 2px 5px rgba(9, 30, 66, 0.08);
            }

            .gm-queue-chip:active {
                //cursor: grabbing;
            }

            .gm-queue-chip.gm-dragging {
                opacity: 0.35 !important;
                border-style: dashed !important;
                transform: scale(0.96);
                //cursor: grabbing !important;
            }

            /* Active / selected queue */
            .gm-queue-chip.gm-active {
                background: var(--ds-background-selected-bold, #0C66E4) !important;
                border-color: var(--ds-background-selected-bold, #0C66E4) !important;
                color: #FFFFFF !important;
                font-weight: 600;
                box-shadow: 0 2px 6px rgba(12, 102, 228, 0.3);
            }

            .gm-queue-chip.gm-active:hover {
                background: var(--ds-background-selected-bold-hovered, #0055CC) !important;
                border-color: var(--ds-background-selected-bold-hovered, #0055CC) !important;
                box-shadow: 0 3px 8px rgba(12, 102, 228, 0.4);
            }

            /* Queue Name label */
            .gm-queue-title {
                max-width: 190px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }


            /* Inline rename input */
            .gm-rename-input {
                font: inherit;
                font-size: 12px;
                line-height: 16px;
                height: 18px;
                padding: 0 4px;
                border: 1px solid var(--ds-border-focused, #388BFF);
                border-radius: 4px;
                background: var(--ds-background-input, #FFFFFF);
                color: var(--ds-text, #172B4D);
                outline: none;
                box-sizing: border-box;
                width: 110px;
            }

            /* Count badge */
            .gm-queue-badge {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 16px;
                height: 16px;
                padding: 0 4px;
                border-radius: 8px;
                font-size: 11px;
                font-weight: 600;
                line-height: 1;
                box-sizing: border-box;
            }

            /* Inactive chip with 0 count: discreet */
            .gm-queue-chip:not(.gm-active) .gm-queue-badge.gm-badge-zero {
                background: transparent;
                color: var(--ds-text-subtlest, #6B6E76);
                border: 1px solid var(--ds-border, rgba(9, 30, 66, 0.12));
                opacity: 0.65;
            }

            /* Inactive chip with count > 0: highlighted badge */
            .gm-queue-chip:not(.gm-active) .gm-queue-badge:not(.gm-badge-zero) {
                background: var(--ds-background-neutral-bold, rgba(9, 30, 66, 0.12));
                color: var(--ds-text, #172B4D);
            }

            /* Active chip count badge: crisp white pill */
            .gm-queue-chip.gm-active .gm-queue-badge {
                background: rgba(255, 255, 255, 0.25) !important;
                color: #FFFFFF !important;
            }

            /* Dark theme overrides */
            [data-color-mode="dark"] .gm-queue-chip,
            [data-theme*="dark"] .gm-queue-chip {
                background: rgba(255, 255, 255, 0.06);
                border-color: rgba(255, 255, 255, 0.14);
                color: #E2E8F0;
            }

            [data-color-mode="dark"] .gm-queue-chip:hover,
            [data-theme*="dark"] .gm-queue-chip:hover {
                background: rgba(255, 255, 255, 0.12);
                border-color: #579DFF;
                color: #FFFFFF;
            }

            [data-color-mode="dark"] .gm-queue-chip:not(.gm-active) .gm-queue-badge:not(.gm-badge-zero),
            [data-theme*="dark"] .gm-queue-chip:not(.gm-active) .gm-queue-badge:not(.gm-badge-zero) {
                background: rgba(255, 255, 255, 0.16);
                color: #FFFFFF;
            }

            [data-color-mode="dark"] .gm-bar-toggle-btn,
            [data-theme*="dark"] .gm-bar-toggle-btn {
                background: rgba(255, 255, 255, 0.06);
                border-color: rgba(255, 255, 255, 0.14);
                color: #9FADBC;
            }

            [data-color-mode="dark"] .gm-bar-toggle-btn:hover,
            [data-theme*="dark"] .gm-bar-toggle-btn:hover {
                background: rgba(255, 255, 255, 0.12);
                border-color: #579DFF;
                color: #FFFFFF;
            }


            [data-color-mode="dark"] .gm-rename-input,
            [data-theme*="dark"] .gm-rename-input {
                background: #22272B;
                border-color: #579DFF;
                color: #E2E8F0;
            }
        `
        document.head.appendChild(style)
    }

    // ── Resilient extraction of Starred Queues ONLY ────────────────────
    function getStarredQueuesFromDOM() {
        // Step 1: Find the Queues expandable menu container in sidebar
        const queuesTrigger = document.querySelector(
            '[data-testid*="jsm-queues-menu.ui.queues-menu.expandable-menu-item-trigger"], [data-testid*="jsm-queues-menu"]'
        )

        let queuesContainer = null
        if (queuesTrigger) {
            queuesContainer = queuesTrigger.closest('[role="listitem"]') || queuesTrigger.parentElement?.parentElement?.parentElement
        }

        // Fallback for queuesContainer: find button in sidebar with text "Queues"
        if (!queuesContainer) {
            const buttons = document.querySelectorAll('button, div[role="button"]')
            for (const btn of buttons) {
                if (btn.textContent.trim() === 'Queues') {
                    queuesContainer = btn.closest('[role="listitem"]') || btn.parentElement?.parentElement?.parentElement
                    if (queuesContainer) break
                }
            }
        }

        // Step 2: Find the "Starred" group specifically within the Queues container
        let starredGroup = null
        if (queuesContainer) {
            const groups = queuesContainer.querySelectorAll('[role="group"]')
            for (const g of groups) {
                const heading = g.querySelector('p, h1, h2, h3, h4, h5, h6, [id*="heading"]')
                if (heading && heading.textContent.trim().toLowerCase() === 'starred') {
                    starredGroup = g
                    break
                }
                const labelId = g.getAttribute('aria-labelledby')
                if (labelId) {
                    const labelEl = document.getElementById(labelId)
                    if (labelEl && labelEl.textContent.trim().toLowerCase() === 'starred') {
                        starredGroup = g
                        break
                    }
                }
            }
            if (!starredGroup && groups.length > 0) {
                starredGroup = groups[0]
            }
        }

        // Fallback: search for any group with heading "Starred" that strictly contains /queues/ links
        if (!starredGroup) {
            const allGroups = document.querySelectorAll('[role="group"]')
            for (const g of allGroups) {
                const heading = g.querySelector('p, h1, h2, h3, h4, [id*="heading"]')
                if (heading && heading.textContent.trim().toLowerCase() === 'starred') {
                    if (g.querySelector('a[href*="/queues/"]')) {
                        starredGroup = g
                        break
                    }
                }
            }
        }

        if (!starredGroup) return null

        // Step 3: Extract items strictly matching queues, with full deduplication
        const listItems = starredGroup.querySelectorAll('[role="listitem"]')
        if (listItems.length === 0) return null

        const queues = []
        const seenHrefs = new Set()
        const seenNames = new Set()

        for (const item of listItems) {
            const link = item.querySelector('a[href*="/queues/"]')
            if (!link) continue

            const rawHref = link.getAttribute('href')
            if (!rawHref || !rawHref.includes('/queues/')) continue

            // Normalize href (remove query params / hash)
            const cleanHref = rawHref.split('?')[0].split('#')[0]

            // Deduplication by URL
            if (seenHrefs.has(cleanHref)) continue

            // Title
            const titleSpan = link.querySelector('span[style*="-webkit-line-clamp"]') ||
                link.querySelector('span') ||
                link
            const name = titleSpan ? titleSpan.textContent.trim() : ''
            if (!name) continue

            // Deduplication by Queue Name
            if (seenNames.has(name)) continue

            seenHrefs.add(cleanHref)
            seenNames.add(name)

            // Queue issue count badge
            const badgeEl = item.querySelector('[data-is-queue-issue-count-badge="true"]') ||
                item.querySelector('[class*="badge"]')
            const count = badgeEl ? badgeEl.textContent.trim() : '0'

            queues.push({
                href: cleanHref,
                name,
                count
            })
        }

        if (queues.length > 0) {
            cachedQueues = queues
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(queues))
            } catch (_) { }
            return queues
        }

        return null
    }

    // ── Check if a queue matches current URL ────────────────────────────
    function isCurrentQueue(queueHref) {
        if (!queueHref) return false
        try {
            const currentPath = window.location.pathname.replace(/\/+$/, '')
            const targetPath = new URL(queueHref, window.location.origin).pathname.replace(/\/+$/, '')
            return currentPath === targetPath
        } catch (_) {
            return window.location.pathname.includes(queueHref)
        }
    }

    // ── Path / Route Validation ────────────────────────────────────────
    /**
     * Checks if current URL is a Jira Service Desk ticket queues page.
     * Ticket queues URL pattern: ...atlassian.net/jira/servicedesk/projects/<space name>/queues...
     * Prevents rendering on IT Portal, issue views, project settings, etc.
     */
    function isTicketQueuesPage() {
        const pathname = window.location.pathname
        // Standard ticket queues path:
        // e.g. /jira/servicedesk/projects/<space name>/queues or /jira/servicedesk/projects/<space name>/queues/...
        if (/\/servicedesk\/projects\/[^/]+\/queues(?:\/|$)/i.test(pathname)) {
            return true
        }
        // Fallback for project root if queues are loaded at the space root level:
        // /jira/servicedesk/projects/<space name> or /jira/servicedesk/projects/<space name>/
        if (/\/servicedesk\/projects\/[^/]+\/?$/i.test(pathname)) {
            return !!(
                document.querySelector('[data-testid*="horizontal-nav-jsm.queue"], [data-vc*="horizontal-nav-jsm.queue"]') ||
                document.querySelector('[data-testid*="jsm-queues-menu"]')
            )
        }
        return false
    }

    function removeBar() {
        const bar = document.getElementById(BAR_ID)
        if (bar) {
            bar.remove()
        }
    }

    // ── Mount Bar In Between Title & Action Buttons ─────────────────────
    function mountBarInHeader(bar) {
        // 1. Locate horizontal nav header or h1
        const nav = document.querySelector(
            '[data-testid="navigation-apps.horizontal-nav.horizontal-nav-jsm.queue"], [data-vc="navigation-apps.horizontal-nav.horizontal-nav-jsm.queue"], [data-testid*="horizontal-nav-jsm.queue"], [data-vc*="horizontal-nav-jsm.queue"]'
        )
        const h1 = (nav ? nav.querySelector('h1') : null) || document.querySelector('h1')
        if (!h1) return false

        // 2. Find the wrapper element containing the h1 title
        const titleWrapper = h1.closest('div[class*="_16jlkb7n"]') || h1.parentElement
        if (!titleWrapper) return false

        // 3. Find the parent row containing title and action buttons
        const rowContainer = titleWrapper.parentElement
        if (!rowContainer) return false

        // 4. Find the toolbar wrapper on the right (contains Star, Share, Alert buttons)
        let toolbarWrapper = null
        for (const child of rowContainer.children) {
            if (child === titleWrapper || child === bar) continue
            if (
                child.querySelector?.('#gm-queue-alert-toggle') ||
                child.querySelector?.('button[aria-label*="Star"], [data-is-favorite]') ||
                child.querySelector?.('button')
            ) {
                toolbarWrapper = child
                break
            }
        }

        // Prevent title or toolbar from shrinking awkwardly
        titleWrapper.style.flexShrink = '0'
        if (toolbarWrapper) {
            toolbarWrapper.style.flexShrink = '0'
        }

        // 5. Mount bar in between titleWrapper and toolbarWrapper
        if (toolbarWrapper) {
            if (bar.nextElementSibling !== toolbarWrapper || bar.parentElement !== rowContainer) {
                rowContainer.insertBefore(bar, toolbarWrapper)
            }
            return true
        } else {
            if (titleWrapper.nextElementSibling !== bar || bar.parentElement !== rowContainer) {
                titleWrapper.insertAdjacentElement('afterend', bar)
            }
            return true
        }
    }

    // ── Check Bar Overflow & Toggle Button Visibility ─────────────────
    function checkOverflow(bar) {
        if (!bar) return
        const container = bar.querySelector('.gm-chips-container')
        const toggleBtn = bar.querySelector('.gm-bar-toggle-btn')
        if (!container || !toggleBtn) return

        const hasMultipleRows = container.scrollHeight > 26
        const isCollapsed = bar.classList.contains('gm-collapsed')

        if (hasMultipleRows || !isCollapsed) {
            toggleBtn.style.display = 'inline-flex'
        } else {
            toggleBtn.style.display = 'none'
        }
    }

    // ── Inline Rename Handler ──────────────────────────────────────────
    function startRename(chip, q) {
        const titleSpan = chip.querySelector('.gm-queue-title')
        if (!titleSpan || chip.querySelector('.gm-rename-input')) return

        chip.setAttribute('draggable', 'false')
        const currentName = customRenames[q.href] || q.name

        const input = document.createElement('input')
        input.type = 'text'
        input.className = 'gm-rename-input'
        input.value = currentName
        input.placeholder = q.name
        input.maxLength = 50

        // Temporarily hide titleSpan
        titleSpan.style.display = 'none'

        chip.insertBefore(input, titleSpan)
        input.focus()
        input.select()

        let finished = false

        function finish(save) {
            if (finished) return
            finished = true

            if (save) {
                const val = input.value.trim()
                if (!val || val === q.name) {
                    delete customRenames[q.href]
                } else {
                    customRenames[q.href] = val
                }
                saveCustomRenames()
            }

            const effectiveName = customRenames[q.href] || q.name
            titleSpan.textContent = effectiveName
            titleSpan.style.display = ''

            const badge = chip.querySelector('.gm-queue-badge')
            const countText = badge ? badge.textContent : (q.count || '0')

            if (customRenames[q.href]) {
                chip.classList.add('gm-is-renamed')
                chip.title = `${effectiveName} (original: "${q.name}") (${countText})\nDouble-click to rename • Drag to reorder`
            } else {
                chip.classList.remove('gm-is-renamed')
                chip.title = `${effectiveName} (${countText})\nDouble-click to rename • Drag to reorder`
            }

            input.remove()
            chip.setAttribute('draggable', 'true')

            const bar = document.getElementById(BAR_ID)
            if (bar) {
                const queues = cachedQueues.length > 0 ? applyCustomOrder(cachedQueues) : []
                bar.dataset.renderedKeys = getRenderedKeys(queues)
            }
        }

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault()
                e.stopPropagation()
                finish(true)
            } else if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                finish(false)
            }
        })

        input.addEventListener('blur', () => {
            finish(true)
        })

        input.addEventListener('click', (e) => {
            e.preventDefault()
            e.stopPropagation()
        })

        input.addEventListener('mousedown', (e) => {
            e.stopPropagation()
        })
    }

    // ── Build or Update the Horizontal Bar ──────────────────────────────
    function updateOrMountBar() {
        if (!isTicketQueuesPage()) {
            removeBar()
            return
        }

        const rawQueues = getStarredQueuesFromDOM() || (cachedQueues.length > 0 ? cachedQueues : null)
        if (!rawQueues || rawQueues.length === 0) return

        const queues = applyCustomOrder(rawQueues)

        injectStyles()

        let bar = document.getElementById(BAR_ID)
        if (!bar) {
            bar = document.createElement('div')
            bar.id = BAR_ID
            if (isBarCollapsed) {
                bar.classList.add('gm-collapsed')
            }
        }

        const mounted = mountBarInHeader(bar)
        if (!mounted) return

        // Prevent destructive re-render while dragging or actively renaming
        if (draggedChip || bar.querySelector('.gm-rename-input')) {
            return
        }

        // Ensure inner skeleton: prefix, chipsContainer, toggleBtn
        let prefix = bar.querySelector('.gm-bar-prefix')
        if (!prefix) {
            prefix = document.createElement('div')
            prefix.className = 'gm-bar-prefix'
            prefix.title = 'Starred Queues'
            prefix.innerHTML = `
                <svg fill="currentColor" viewBox="0 0 16 16" width="14" height="14">
                    <path d="M8 0a.75.75 0 0 1 .7.48l1.705 4.434 4.403.338a.75.75 0 0 1 .422 1.324l-3.38 2.818 1.25 4.662a.75.75 0 0 1-1.148.813L8 12.159l-3.95 2.71a.75.75 0 0 1-1.15-.813l1.251-4.662L.77 6.576a.75.75 0 0 1 .422-1.324l4.403-.338L7.3.48A.75.75 0 0 1 8 0z" />
                </svg>
            `
            bar.appendChild(prefix)
        }

        let chipsContainer = bar.querySelector('.gm-chips-container')
        if (!chipsContainer) {
            chipsContainer = document.createElement('div')
            chipsContainer.className = 'gm-chips-container'
            bar.appendChild(chipsContainer)
        }

        let toggleBtn = bar.querySelector('.gm-bar-toggle-btn')
        if (!toggleBtn) {
            toggleBtn = document.createElement('button')
            toggleBtn.type = 'button'
            toggleBtn.className = 'gm-bar-toggle-btn'
            toggleBtn.title = isBarCollapsed ? 'Reveal full starred queues bar' : 'Collapse starred queues bar to one row'
            toggleBtn.setAttribute('aria-expanded', isBarCollapsed ? 'false' : 'true')
            toggleBtn.innerHTML = `
                <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor">
                    <path d="M1.646 5.646a.5.5 0 0 1 .708 0L8 11.293l5.646-5.647a.5.5 0 0 1 .708.708l-6 6a.5.5 0 0 1-.708 0l-6-6a.5.5 0 0 1 0-.708z"/>
                </svg>
            `
            toggleBtn.addEventListener('click', (e) => {
                e.preventDefault()
                e.stopPropagation()
                isBarCollapsed = !isBarCollapsed
                saveCollapsedState(isBarCollapsed)
                if (isBarCollapsed) {
                    bar.classList.add('gm-collapsed')
                    toggleBtn.title = 'Reveal full starred queues bar'
                    toggleBtn.setAttribute('aria-expanded', 'false')
                } else {
                    bar.classList.remove('gm-collapsed')
                    toggleBtn.title = 'Collapse starred queues bar to one row'
                    toggleBtn.setAttribute('aria-expanded', 'true')
                }
                checkOverflow(bar)
            })
            bar.appendChild(toggleBtn)

            if (window.ResizeObserver) {
                const ro = new ResizeObserver(() => checkOverflow(bar))
                ro.observe(chipsContainer)
            } else {
                window.addEventListener('resize', () => checkOverflow(bar))
            }
        }

        // Compare if we need full rebuild of chips or just an in-place update
        const currentKeys = getRenderedKeys(queues)
        if (bar.dataset.renderedKeys !== currentKeys) {
            chipsContainer.innerHTML = ''
            bar.dataset.renderedKeys = currentKeys

            for (const q of queues) {
                const chip = document.createElement('a')
                chip.className = 'gm-queue-chip'
                chip.href = q.href
                chip.dataset.href = q.href
                chip.setAttribute('draggable', 'true')

                const displayName = customRenames[q.href] || q.name
                if (customRenames[q.href]) {
                    chip.classList.add('gm-is-renamed')
                    chip.title = `${displayName} (original: "${q.name}") (${q.count || '0'})\nDouble-click to rename • Drag to reorder`
                } else {
                    chip.title = `${displayName} (${q.count || '0'})\nDouble-click to rename • Drag to reorder`
                }

                // Title label
                const titleSpan = document.createElement('span')
                titleSpan.className = 'gm-queue-title'
                titleSpan.textContent = displayName
                chip.appendChild(titleSpan)

                // Issue count badge
                const badgeSpan = document.createElement('span')
                badgeSpan.className = 'gm-queue-badge'
                badgeSpan.textContent = q.count || '0'
                if (!q.count || q.count === '0') {
                    badgeSpan.classList.add('gm-badge-zero')
                }
                chip.appendChild(badgeSpan)

                // Double click triggers rename
                chip.addEventListener('dblclick', (e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    startRename(chip, q)
                })

                // Drag and Drop (reorder)
                chip.addEventListener('dragstart', (e) => {
                    if (chip.querySelector('.gm-rename-input')) {
                        e.preventDefault()
                        return
                    }
                    draggedChip = chip
                    hasDragged = true
                    dragStartTime = Date.now()
                    chip.classList.add('gm-dragging')
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', chip.dataset.href || '')
                })

                chip.addEventListener('dragover', (e) => {
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    if (!draggedChip || draggedChip === chip) return

                    const container = chip.parentElement
                    if (!container) return

                    const rect = chip.getBoundingClientRect()
                    const midX = rect.left + rect.width / 2

                    if (e.clientX < midX) {
                        if (chip.previousElementSibling !== draggedChip) {
                            container.insertBefore(draggedChip, chip)
                        }
                    } else {
                        if (chip.nextElementSibling !== draggedChip) {
                            container.insertBefore(draggedChip, chip.nextSibling)
                        }
                    }
                })

                chip.addEventListener('drop', (e) => {
                    e.preventDefault()
                })

                chip.addEventListener('dragend', () => {
                    if (draggedChip) {
                        draggedChip.classList.remove('gm-dragging')
                        draggedChip = null
                    }
                    const container = bar.querySelector('.gm-chips-container')
                    if (container) {
                        const newOrder = Array.from(container.querySelectorAll('.gm-queue-chip'))
                            .map(c => c.dataset.href)
                            .filter(Boolean)
                        saveCustomOrder(newOrder)
                        bar.dataset.renderedKeys = getRenderedKeys(applyCustomOrder(queues))
                    }
                    setTimeout(() => {
                        hasDragged = false
                    }, 100)
                })

                // Click navigation: trigger native sidebar click if available, else navigate
                chip.addEventListener('click', (e) => {
                    if (hasDragged || (Date.now() - dragStartTime < 250 && hasDragged)) {
                        e.preventDefault()
                        e.stopPropagation()
                        return
                    }
                    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) {
                        return // Native open-in-new-tab
                    }

                    // Optimistic active highlight
                    chipsContainer.querySelectorAll('.gm-queue-chip').forEach(c => c.classList.remove('gm-active'))
                    chip.classList.add('gm-active')

                    // Find matching sidebar link to trigger Jira client-side SPA routing
                    const sidebarLink = document.querySelector(
                        `[data-testid*="jsm-queues-menu"] ~ * a[href="${q.href}"], [role="group"] a[href="${q.href}"], a[href="${q.href}"]`
                    )
                    if (sidebarLink && typeof sidebarLink.click === 'function') {
                        e.preventDefault()
                        sidebarLink.click()
                    }
                })

                chipsContainer.appendChild(chip)
            }
        }

        // In-place update of active state & badges
        for (const q of queues) {
            const chip = chipsContainer.querySelector(`.gm-queue-chip[data-href="${q.href}"]`)
            if (!chip) continue

            // Active state
            if (isCurrentQueue(q.href)) {
                chip.classList.add('gm-active')
                chip.setAttribute('aria-current', 'page')
            } else {
                chip.classList.remove('gm-active')
                chip.removeAttribute('aria-current')
            }

            // Count badge
            const badge = chip.querySelector('.gm-queue-badge')
            if (badge && q.count !== undefined) {
                const countText = q.count || '0'
                if (badge.textContent !== countText) {
                    badge.textContent = countText
                    const displayName = customRenames[q.href] || q.name
                    if (customRenames[q.href]) {
                        chip.title = `${displayName} (original: "${q.name}") (${countText})\nDouble-click to rename • Drag to reorder`
                    } else {
                        chip.title = `${displayName} (${countText})\nDouble-click to rename • Drag to reorder`
                    }
                }
                if (countText === '0') {
                    badge.classList.add('gm-badge-zero')
                } else {
                    badge.classList.remove('gm-badge-zero')
                }
            }
        }

        checkOverflow(bar)
    }

    // ── Debounce Helper ────────────────────────────────────────────────
    function debounce(fn, ms) {
        let timer = null
        return function (...args) {
            clearTimeout(timer)
            timer = setTimeout(() => fn.apply(this, args), ms)
        }
    }

    const debouncedUpdate = debounce(updateOrMountBar, 150)

    // ── SPA Navigation Listener ────────────────────────────────────────
    function handleLocationChange() {
        if (!isTicketQueuesPage()) {
            removeBar()
            return
        }

        const bar = document.getElementById(BAR_ID)
        if (bar) {
            bar.querySelectorAll('.gm-queue-chip').forEach(chip => {
                const href = chip.dataset.href
                if (isCurrentQueue(href)) {
                    chip.classList.add('gm-active')
                    chip.setAttribute('aria-current', 'page')
                } else {
                    chip.classList.remove('gm-active')
                    chip.removeAttribute('aria-current')
                }
            })
        }
        debouncedUpdate()
    }

    const originalPushState = history.pushState
    history.pushState = function (...args) {
        originalPushState.apply(this, args)
        handleLocationChange()
    }

    const originalReplaceState = history.replaceState
    history.replaceState = function (...args) {
        originalReplaceState.apply(this, args)
        handleLocationChange()
    }

    window.addEventListener('popstate', handleLocationChange)

    // ── MutationObserver ───────────────────────────────────────────────
    const observer = new MutationObserver((mutations) => {
        if (!isTicketQueuesPage()) {
            removeBar()
            return
        }

        let shouldUpdate = false
        for (const m of mutations) {
            if (m.type === 'childList') {
                for (const node of m.addedNodes) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        if (
                            node.id === BAR_ID ||
                            node.querySelector?.(`#${BAR_ID}`)
                        ) {
                            continue
                        }
                        if (
                            node.querySelector?.('[data-testid*="horizontal-nav"], [data-testid*="jsm-queues-menu"], [role="group"], [data-is-queue-issue-count-badge]') ||
                            node.matches?.('[data-testid*="horizontal-nav"], [data-testid*="jsm-queues-menu"], [role="group"], [data-is-queue-issue-count-badge]')
                        ) {
                            shouldUpdate = true
                            break
                        }
                    }
                }
            }
            if (shouldUpdate) break
        }

        if (!document.getElementById(BAR_ID)) {
            shouldUpdate = true
        }

        if (shouldUpdate) {
            debouncedUpdate()
        }
    })

    observer.observe(document.body, { childList: true, subtree: true })

    updateOrMountBar()
})()
