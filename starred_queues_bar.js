// ==UserScript==
// @name        Jira Starred Queues Bar
// @namespace   Violentmonkey Scripts
// @match       https://*.atlassian.net/*
// @grant       none
// @version     1.1.0
// @author      oggmancuc
// @description Duplicates starred queues into a neat, responsive horizontal bar in the queue header between the title and action buttons, wrapping only when items stop fitting horizontally.
// ==/UserScript==

;(function () {
    'use strict'

    const BAR_ID = 'gm-starred-queues-bar'
    const STYLE_ID = 'gm-starred-queues-style'
    const STORAGE_KEY = 'gm-starred-queues-cache-v2'

    // Load & sanitize cache
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
    } catch (_) {}

    // ── CSS Injection ──────────────────────────────────────────────────
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return

        const style = document.createElement('style')
        style.id = STYLE_ID
        style.innerHTML = `
            #${BAR_ID} {
                display: flex;
                flex-direction: row;
                flex-wrap: wrap; /* wraps to next line ONLY when items stop fitting horizontally */
                align-items: center;
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
                padding: 2px 4px 2px 0;
                color: var(--ds-icon-accent-yellow, #E2B203);
                flex-shrink: 0;
            }

            .gm-queue-chip {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                padding: 2px 7px 2px 9px;
                border-radius: 12px;
                background: var(--ds-background-neutral-subtle, rgba(9, 30, 66, 0.04));
                color: var(--ds-text, #172B4D);
                border: 1px solid var(--ds-border, rgba(9, 30, 66, 0.12));
                font: var(--ds-font-body-UNSAFE_small, normal 500 12px/16px ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
                text-decoration: none !important;
                white-space: nowrap;
                flex-shrink: 0; /* Keep each chip intact; wrap to next row when out of horizontal space */
                cursor: pointer;
                transition: background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
            }

            .gm-queue-chip:hover {
                background: var(--ds-background-neutral, rgba(9, 30, 66, 0.08));
                border-color: var(--ds-border-focused, #388BFF);
                color: var(--ds-text, #172B4D);
                transform: translateY(-1px);
                box-shadow: 0 2px 5px rgba(9, 30, 66, 0.08);
            }

            .gm-queue-chip:active {
                transform: translateY(0) scale(0.98);
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
            } catch (_) {}
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

    // ── Mount Bar In Between Title & Action Buttons ─────────────────────
    function mountBarInHeader(bar) {
        // 1. Locate horizontal nav header or h1
        const nav = document.querySelector(
            '[data-testid="navigation-apps.horizontal-nav.horizontal-nav-jsm.queue"], [data-vc="navigation-apps.horizontal-nav.horizontal-nav-jsm.queue"]'
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

    // ── Build or Update the Horizontal Bar ──────────────────────────────
    function updateOrMountBar() {
        const queues = getStarredQueuesFromDOM() || (cachedQueues.length > 0 ? cachedQueues : null)
        if (!queues || queues.length === 0) return

        injectStyles()

        let bar = document.getElementById(BAR_ID)
        if (!bar) {
            bar = document.createElement('div')
            bar.id = BAR_ID
        }

        const mounted = mountBarInHeader(bar)
        if (!mounted) return

        // Compare if we need full rebuild of chips or just an update
        const currentKeys = queues.map(q => `${q.href}:${q.name}`).join('|')
        if (bar.dataset.renderedKeys !== currentKeys) {
            bar.innerHTML = ''
            bar.dataset.renderedKeys = currentKeys

            // Compact Prefix Star Icon
            const prefix = document.createElement('div')
            prefix.className = 'gm-bar-prefix'
            prefix.title = 'Starred Queues'
            prefix.innerHTML = `
                <svg fill="currentColor" viewBox="0 0 16 16" width="14" height="14">
                    <path d="M8 0a.75.75 0 0 1 .7.48l1.705 4.434 4.403.338a.75.75 0 0 1 .422 1.324l-3.38 2.818 1.25 4.662a.75.75 0 0 1-1.148.813L8 12.159l-3.95 2.71a.75.75 0 0 1-1.15-.813l1.251-4.662L.77 6.576a.75.75 0 0 1 .422-1.324l4.403-.338L7.3.48A.75.75 0 0 1 8 0z" />
                </svg>
            `
            bar.appendChild(prefix)

            for (const q of queues) {
                const chip = document.createElement('a')
                chip.className = 'gm-queue-chip'
                chip.href = q.href
                chip.dataset.href = q.href
                chip.title = `${q.name} (${q.count || '0'})`

                const titleSpan = document.createElement('span')
                titleSpan.className = 'gm-queue-title'
                titleSpan.textContent = q.name
                chip.appendChild(titleSpan)

                const badgeSpan = document.createElement('span')
                badgeSpan.className = 'gm-queue-badge'
                badgeSpan.textContent = q.count || '0'
                if (!q.count || q.count === '0') {
                    badgeSpan.classList.add('gm-badge-zero')
                }
                chip.appendChild(badgeSpan)

                // Interactivity: trigger native sidebar click if available, else navigate
                chip.addEventListener('click', (e) => {
                    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) {
                        return // Native open-in-new-tab
                    }

                    // Optimistic active highlight
                    document.querySelectorAll('.gm-queue-chip').forEach(c => c.classList.remove('gm-active'))
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

                bar.appendChild(chip)
            }
        }

        // In-place update of active state & badges
        for (const q of queues) {
            const chip = bar.querySelector(`.gm-queue-chip[data-href="${q.href}"]`)
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
                    chip.title = `${q.name} (${countText})`
                }
                if (countText === '0') {
                    badge.classList.add('gm-badge-zero')
                } else {
                    badge.classList.remove('gm-badge-zero')
                }
            }
        }
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
