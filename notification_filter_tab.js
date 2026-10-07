// ==UserScript==
// @name        Jira Notification Filter (Self & Automation)
// @namespace   Violentmonkey Scripts
// @match       https://*.atlassian.net/*
// @grant       none
// @version     1.0.0
// @author      oggmancuc
// @description Hides notifications from your own actions and Automation for Jira, placing them in a dedicated 'Self & Automation' tab.
// ==/UserScript==

;(function () {
    'use strict'

    // =========================================================================
    // CONFIGURATION
    // =========================================================================
    const CONFIG = {
        // Names of actors whose notifications should be filtered out from Direct/Watching
        // and routed into the custom tab. Case-insensitive matching.
        filterActors: [
            'Yehor Novichkov',
            'Automation for Jira'
        ],

        // Label for the custom tab
        tabTitle: 'Self & Automation',

        // Show count badge with number of filtered items
        showBadge: true,

        // Highlight badge when there are unread filtered notifications
        highlightUnread: true,

        // Show a notice in native tabs when all notifications were filtered out
        showAllFilteredNotice: true
    }

    const STYLE_ID = 'gm-notification-filter-style'
    const TAB_ID = 'gm-jira-filter-tab'
    const NOTICE_ID = 'gm-jira-all-filtered-notice'
    const EMPTY_STATE_ID = 'gm-jira-filter-empty-state'

    // 'native' = viewing Direct or Watching (custom tab inactive, filtered items hidden)
    // 'filtered' = viewing custom tab (normal items hidden, filtered items visible)
    let activeTabMode = 'native'
    let lastActiveNativeTab = null

    // =========================================================================
    // CSS INJECTION
    // =========================================================================
    function injectStyles() {
        if (document.getElementById(STYLE_ID)) return

        const style = document.createElement('style')
        style.id = STYLE_ID
        style.textContent = `
            /* Hidden notification rows & date sections */
            .gm-notification-hidden {
                display: none !important;
            }

            /* Custom Filter Tab */
            #${TAB_ID} {
                cursor: pointer !important;
                position: relative !important;
                user-select: none !important;
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                white-space: nowrap !important;
                box-sizing: border-box !important;
                transition: color 0.15s ease, border-color 0.15s ease !important;
            }

            #${TAB_ID}:hover {
                color: var(--ds-text, #172B4D) !important;
            }

            #${TAB_ID}[aria-selected="true"] {
                color: var(--ds-text-selected, #0C66E4) !important;
            }

            #${TAB_ID}[aria-selected="true"]::after {
                content: '' !important;
                position: absolute !important;
                left: 0 !important;
                right: 0 !important;
                bottom: 0 !important;
                height: 2px !important;
                background-color: var(--ds-border-selected, #0C66E4) !important;
                border-radius: 1px 1px 0 0 !important;
            }

            #${TAB_ID}[aria-selected="false"]::after {
                display: none !important;
            }

            /* Tab count badge */
            #${TAB_ID} .gm-tab-badge {
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                margin-left: 6px !important;
                padding: 0 6px !important;
                font-size: 11px !important;
                font-weight: 600 !important;
                line-height: 16px !important;
                height: 16px !important;
                min-width: 16px !important;
                box-sizing: border-box !important;
                border-radius: 8px !important;
                background-color: var(--ds-background-neutral, rgba(9, 30, 66, 0.08)) !important;
                color: var(--ds-text-subtle, #626F86) !important;
                transition: background-color 0.2s ease, color 0.2s ease !important;
            }

            #${TAB_ID} .gm-tab-badge.has-unread {
                background-color: var(--ds-background-brand-bold, #0C66E4) !important;
                color: var(--ds-text-inverse, #FFFFFF) !important;
            }

            #${TAB_ID}[aria-selected="true"] .gm-tab-badge:not(.has-unread) {
                background-color: var(--ds-background-selected, #E9F2FF) !important;
                color: var(--ds-text-selected, #0C66E4) !important;
            }

            /* Inactive state for native tabs when custom tab is active */
            .gm-filtered-tab-active [role="tablist"] [role="tab"]:not(#${TAB_ID}) {
                border-bottom-color: transparent !important;
                color: var(--ds-text-subtle, #626F86) !important;
            }
            .gm-filtered-tab-active [role="tablist"] [role="tab"]:not(#${TAB_ID})::after {
                display: none !important;
            }

            /* Empty state notices */
            .gm-jira-notice-container {
                display: flex !important;
                flex-direction: column !important;
                align-items: center !important;
                justify-content: center !important;
                padding: 32px 16px !important;
                text-align: center !important;
                color: var(--ds-text-subtle, #626F86) !important;
                animation: gmFadeIn 0.2s ease-in-out !important;
            }

            .gm-jira-notice-icon {
                margin-bottom: 12px !important;
                color: var(--ds-icon-subtle, #626F86) !important;
            }

            .gm-jira-notice-title {
                font-size: 14px !important;
                font-weight: 600 !important;
                margin-bottom: 4px !important;
                color: var(--ds-text, #172B4D) !important;
            }

            .gm-jira-notice-desc {
                font-size: 12px !important;
                line-height: 16px !important;
                max-width: 280px !important;
                margin-bottom: 14px !important;
            }

            .gm-jira-notice-btn {
                background-color: var(--ds-background-neutral, rgba(9, 30, 66, 0.08)) !important;
                color: var(--ds-text, #172B4D) !important;
                border: none !important;
                border-radius: 4px !important;
                padding: 6px 12px !important;
                font-size: 12px !important;
                font-weight: 500 !important;
                cursor: pointer !important;
                transition: background-color 0.15s ease !important;
            }

            .gm-jira-notice-btn:hover {
                background-color: var(--ds-background-neutral-hovered, rgba(9, 30, 66, 0.14)) !important;
            }

            @keyframes gmFadeIn {
                from { opacity: 0; transform: translateY(4px); }
                to { opacity: 1; transform: translateY(0); }
            }
        `
        document.head.appendChild(style)
    }

    // =========================================================================
    // ACTOR EXTRACTION
    // =========================================================================
    function getNotificationActor(itemContainer) {
        if (!itemContainer) return ''

        // 1. Hidden span inside user profile / avatar container
        const avatarSpan = itemContainer.querySelector(
            '[data-testid="user-profile-card-trigger-wrapper"] [role="img"] span[hidden], ' +
            '[data-testid="avatar-wrapper"] [role="img"] span[hidden]'
        )
        if (avatarSpan && avatarSpan.textContent.trim()) {
            return avatarSpan.textContent.trim()
        }

        // 2. Main action link aria-label, e.g. "Automation for Jira assigned a work item to you 5 minutes ago"
        // or "Yehor Novichkov commented on a work item 16 minutes ago"
        const mainAction = itemContainer.querySelector('a[data-testid="notification-item-main-action"]')
        if (mainAction) {
            const label = mainAction.getAttribute('aria-label') || ''
            const match = label.match(/^(.+?)\s+(?:assigned|commented|mentioned|reacted|updated|edited|created|transitioned|resolved|closed|opened|attached|requested)\b/i)
            if (match && match[1].trim()) {
                return match[1].trim()
            }
        }

        // 3. Summary heading: e.g. "<h4><span>Yehor Novichkov commented on a work item</span>...</h4>"
        const headingSpan = itemContainer.querySelector('h4[id*="_summary"] > span:first-child, h4 > span:first-child')
        if (headingSpan) {
            const text = headingSpan.textContent.trim()
            const match = text.match(/^(.+?)\s+(?:assigned|commented|mentioned|reacted|updated|edited|created|transitioned|resolved|closed|opened|attached|requested)\b/i)
            if (match && match[1].trim()) {
                return match[1].trim()
            }
        }

        // 4. Fallback: aria-labelledby on the avatar wrapper image
        const avatarImgWrapper = itemContainer.querySelector('[data-testid="user-profile-card-trigger-wrapper"] [role="img"]')
        if (avatarImgWrapper) {
            const labelledBy = avatarImgWrapper.getAttribute('aria-labelledby')
            if (labelledBy) {
                const labelEl = document.getElementById(labelledBy)
                if (labelEl && labelEl.textContent.trim()) {
                    return labelEl.textContent.trim()
                }
            }
        }

        return ''
    }

    function isFilteredActor(actorName) {
        if (!actorName) return false
        const lower = actorName.toLowerCase().trim()
        return CONFIG.filterActors.some(name => lower.includes(name.toLowerCase().trim()))
    }

    function isItemUnread(itemContainer) {
        if (!itemContainer) return false
        return Boolean(
            itemContainer.querySelector('[data-testid="unread-indicator"]') ||
            itemContainer.querySelector('button[aria-label="Mark as read"]')
        )
    }

    function getItemRow(itemContainer) {
        return itemContainer.closest('section[role="feed"] > article') ||
            itemContainer.closest('article[data-testid="notification-item-container"]') ||
            itemContainer
    }

    // =========================================================================
    // TAB MANAGEMENT & SYNCHRONIZATION
    // =========================================================================
    function getNotificationDrawer() {
        return document.querySelector('[data-testid="category-filter-tab"]')
    }

    function ensureCustomTab(drawer) {
        const tablist = drawer.querySelector('[role="tablist"]')
        if (!tablist) return null

        let customTab = tablist.querySelector(`#${TAB_ID}`)
        if (customTab) return customTab

        // Find reference native tab (Direct or Watching) to clone styles and markup structure
        const referenceTab = tablist.querySelector('[role="tab"]')
        if (!referenceTab) return null

        customTab = document.createElement('div')
        customTab.id = TAB_ID
        customTab.setAttribute('role', 'tab')
        customTab.setAttribute('data-testid', 'notification-list-layout-SelfAutomation')
        customTab.className = referenceTab.className
        customTab.setAttribute('aria-selected', activeTabMode === 'filtered' ? 'true' : 'false')
        customTab.setAttribute('tabindex', activeTabMode === 'filtered' ? '0' : '-1')
        customTab.setAttribute('aria-posinset', '3')
        customTab.setAttribute('aria-setsize', '3')

        // Title span matching native tab styling
        const refSpan = referenceTab.querySelector('span')
        const titleSpan = document.createElement('span')
        titleSpan.className = refSpan ? refSpan.className : ''
        titleSpan.style.webkitLineClamp = '1'
        titleSpan.textContent = CONFIG.tabTitle

        // Count badge
        const badge = document.createElement('span')
        badge.className = 'gm-tab-badge'
        badge.style.display = 'none'

        customTab.appendChild(titleSpan)
        customTab.appendChild(badge)

        // Event listeners for user interaction
        customTab.addEventListener('click', (e) => {
            e.preventDefault()
            e.stopPropagation()
            switchTabMode('filtered')
        })

        customTab.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                switchTabMode('filtered')
            }
        })

        // Capture clicks on native tabs to return to 'native' mode seamlessly
        if (!tablist.dataset.gmListenersAttached) {
            tablist.dataset.gmListenersAttached = 'true'
            tablist.addEventListener('click', (e) => {
                const clickedTab = e.target.closest('[role="tab"]')
                if (!clickedTab || clickedTab.id === TAB_ID) return

                lastActiveNativeTab = clickedTab
                switchTabMode('native')
            }, true)
        }

        tablist.appendChild(customTab)

        // Update aria-setsize on all tabs
        tablist.querySelectorAll('[role="tab"]').forEach(tab => {
            tab.setAttribute('aria-setsize', '3')
        })

        return customTab
    }

    function switchTabMode(newMode) {
        activeTabMode = newMode
        const drawer = getNotificationDrawer()
        if (!drawer) return

        syncTabAttributes(drawer)
        applyNotificationFilter(drawer)
    }

    function syncTabAttributes(drawer) {
        const tablist = drawer.querySelector('[role="tablist"]')
        if (!tablist) return

        const customTab = tablist.querySelector(`#${TAB_ID}`)
        const nativeTabs = Array.from(tablist.querySelectorAll(`[role="tab"]:not(#${TAB_ID})`))

        if (activeTabMode === 'filtered') {
            drawer.classList.add('gm-filtered-tab-active')
            if (customTab) {
                customTab.setAttribute('aria-selected', 'true')
                customTab.setAttribute('tabindex', '0')
            }
            nativeTabs.forEach(tab => {
                if (tab.getAttribute('aria-selected') === 'true') {
                    lastActiveNativeTab = tab
                }
                tab.setAttribute('aria-selected', 'false')
                tab.setAttribute('tabindex', '-1')
            })
        } else {
            drawer.classList.remove('gm-filtered-tab-active')
            if (customTab) {
                customTab.setAttribute('aria-selected', 'false')
                customTab.setAttribute('tabindex', '-1')
            }

            // Restore active state on native tab
            const activeNative = lastActiveNativeTab || nativeTabs[0]
            if (activeNative) {
                activeNative.setAttribute('aria-selected', 'true')
                activeNative.setAttribute('tabindex', '0')
            }
        }
    }

    // =========================================================================
    // NOTIFICATION FILTERING
    // =========================================================================
    function applyNotificationFilter(drawer) {
        if (!drawer) return

        const customTab = ensureCustomTab(drawer)
        const itemContainers = drawer.querySelectorAll('article[data-testid="notification-item-container"]')

        let totalFiltered = 0
        let unreadFiltered = 0
        let visibleCount = 0

        itemContainers.forEach(item => {
            const actor = getNotificationActor(item)
            const isFiltered = isFilteredActor(actor)
            const unread = isItemUnread(item)
            const row = getItemRow(item)

            if (isFiltered) {
                totalFiltered++
                if (unread) unreadFiltered++
            }

            const shouldHide = (activeTabMode === 'native' && isFiltered) ||
                (activeTabMode === 'filtered' && !isFiltered)

            if (row) {
                row.classList.toggle('gm-notification-hidden', shouldHide)
                if (!shouldHide) visibleCount++
            }
        })

        // Update custom tab badge
        if (customTab && CONFIG.showBadge) {
            const badge = customTab.querySelector('.gm-tab-badge')
            if (badge) {
                if (totalFiltered > 0) {
                    badge.textContent = totalFiltered
                    badge.style.display = 'inline-flex'
                    badge.classList.toggle('has-unread', CONFIG.highlightUnread && unreadFiltered > 0)
                    badge.title = `${totalFiltered} filtered notification${totalFiltered > 1 ? 's' : ''}${unreadFiltered > 0 ? ` (${unreadFiltered} unread)` : ''}`
                } else {
                    badge.style.display = 'none'
                }
            }
        }

        // Update time-group section headings (e.g. "Today", "Yesterday")
        updateDateHeadings(drawer)

        // Handle empty states
        updateEmptyStates(drawer, totalFiltered, visibleCount)
    }

    function updateDateHeadings(drawer) {
        const headings = drawer.querySelectorAll('h3[data-testid^="time-group-heading-"]')
        headings.forEach(heading => {
            const dateSection = heading.closest('section')
            if (!dateSection) return

            const feed = dateSection.querySelector('[role="feed"]')
            if (!feed) return

            const articles = feed.querySelectorAll(':scope > article')
            if (articles.length === 0) return

            const hasVisible = Array.from(articles).some(art => !art.classList.contains('gm-notification-hidden'))
            dateSection.classList.toggle('gm-notification-hidden', !hasVisible)
        })
    }

    function updateEmptyStates(drawer, totalFiltered, visibleCount) {
        // 1. Notice when on native tab and all items were filtered out
        let noticeEl = drawer.querySelector(`#${NOTICE_ID}`)
        if (activeTabMode === 'native' && CONFIG.showAllFilteredNotice && visibleCount === 0 && totalFiltered > 0) {
            if (!noticeEl) {
                const targetContainer = drawer.querySelector('[role="tabpanel"]') || drawer
                noticeEl = document.createElement('div')
                noticeEl.id = NOTICE_ID
                noticeEl.className = 'gm-jira-notice-container'
                noticeEl.innerHTML = `
                    <div class="gm-jira-notice-icon">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                            <polyline points="22 4 12 14.01 9 11.01"></polyline>
                        </svg>
                    </div>
                    <div class="gm-jira-notice-title">All notifications here were filtered</div>
                    <div class="gm-jira-notice-desc">
                        ${totalFiltered} notification${totalFiltered > 1 ? 's' : ''} from ${CONFIG.filterActors.join(' & ')} moved to the separate tab.
                    </div>
                    <button type="button" class="gm-jira-notice-btn">View in ${CONFIG.tabTitle} (${totalFiltered})</button>
                `
                noticeEl.querySelector('button').addEventListener('click', () => {
                    switchTabMode('filtered')
                })
                targetContainer.appendChild(noticeEl)
            } else {
                noticeEl.style.display = 'flex'
                const btn = noticeEl.querySelector('button')
                if (btn) btn.textContent = `View in ${CONFIG.tabTitle} (${totalFiltered})`
            }
        } else if (noticeEl) {
            noticeEl.style.display = 'none'
        }

        // 2. Empty state when on custom tab and no filtered notifications exist
        let emptyStateEl = drawer.querySelector(`#${EMPTY_STATE_ID}`)
        if (activeTabMode === 'filtered' && totalFiltered === 0) {
            if (!emptyStateEl) {
                const targetContainer = drawer.querySelector('[role="tabpanel"]') || drawer
                emptyStateEl = document.createElement('div')
                emptyStateEl.id = EMPTY_STATE_ID
                emptyStateEl.className = 'gm-jira-notice-container'
                emptyStateEl.innerHTML = `
                    <div class="gm-jira-notice-icon">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                            <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                        </svg>
                    </div>
                    <div class="gm-jira-notice-title">No filtered notifications</div>
                    <div class="gm-jira-notice-desc">
                        Notifications from ${CONFIG.filterActors.join(' and ')} will appear here.
                    </div>
                `
                targetContainer.appendChild(emptyStateEl)
            } else {
                emptyStateEl.style.display = 'flex'
            }
        } else if (emptyStateEl) {
            emptyStateEl.style.display = 'none'
        }
    }

    // =========================================================================
    // OBSERVER & INITIALIZATION
    // =========================================================================
    let updateScheduled = false
    function scheduleUpdate() {
        if (updateScheduled) return
        updateScheduled = true
        requestAnimationFrame(() => {
            updateScheduled = false
            const drawer = getNotificationDrawer()
            if (drawer) {
                ensureCustomTab(drawer)
                syncTabAttributes(drawer)
                applyNotificationFilter(drawer)
            }
        })
    }

    injectStyles()

    const observer = new MutationObserver((mutations) => {
        // Quick check to avoid running on purely our own class changes
        const hasRelevantChanges = mutations.some(m => {
            if (m.type === 'childList') return true
            if (m.type === 'attributes' && (m.attributeName === 'aria-selected' || m.attributeName === 'aria-label')) {
                return true
            }
            return false
        })

        if (hasRelevantChanges) {
            scheduleUpdate()
        }
    })

    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['aria-selected', 'aria-label', 'data-testid']
    })

    // Run once on load
    scheduleUpdate()

})()
