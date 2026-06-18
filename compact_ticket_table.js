// ==UserScript==
// @name        Jira Compact Ticket Table
// @namespace   Violentmonkey Scripts
// @match       https://*.atlassian.net/*
// @grant       none
// @version     1.0.0
// @author      oggmancuc
// @description Makes the Jira service desk ticket list table more compact and hides specified columns.
// ==/UserScript==

; (function () {
    'use strict'

    const CONFIG = {
        // Add names of columns you want to hide in this array.
        // E.g., "Key", "Reporter", "Time to resolution"
        hiddenColumns: ["Key", "Reporter", "Time to resolution"],

        // Custom widths for specific columns to prevent truncation
        // E.g., "Created": "140px"
        customWidths: {
            "Created": "110px",
            "Updated": "90px",
            "Assignee": "180px",
            "Status": "140px",
            "Dashboard Reminder Date": "110px",
            "Components": "600px"
        },

        // Row height in pixels
        rowHeight: "42px"
    };

    // ==========================================
    // CSS INJECTION
    // ==========================================
    const globalStyles = `
        /* 1. Reduce Row Height */
        div.virtual-table-row > div {
            min-height: ${CONFIG.rowHeight} !important;
            height: ${CONFIG.rowHeight} !important;
        }

        /* 2. Force Content to One Line & Truncate */
        div[role="cell"] {
            white-space: nowrap !important;
            overflow: hidden !important;
        }

        /* Ensure flex containers inside cells can shrink and truncate text */
        div[role="cell"] * {
            white-space: nowrap;
        }

        /* Target the most common text wrappers to apply ellipsis */
        div[role="cell"] span,
        div[role="cell"] a,
        div[role="cell"] div {
            text-overflow: ellipsis;
            overflow: hidden;
        }

        /* Fix issue link display for proper truncation */
        .issue-link {
            display: inline-block;
            max-width: 100%;
            vertical-align: middle;
        }

        /* Prevent icons from being mangled by overflow hidden */
        div[role="cell"] img,
        div[role="cell"] svg {
            overflow: visible !important;
            flex-shrink: 0;
        }
    `;

    function injectCSS() {
        if (!document.getElementById('jira-compact-table-global-style')) {
            const style = document.createElement('style');
            style.id = 'jira-compact-table-global-style';
            style.innerHTML = globalStyles;
            document.head.appendChild(style);
        }
    }

    // ==========================================
    // COLUMN STYLE LOGIC
    // ==========================================
    function applyColumnStyles() {
        const headers = document.querySelectorAll('div[role="columnheader"]');
        if (!headers.length) return;

        let styleContent = '';
        headers.forEach((header, index) => {
            const text = header.textContent.trim().toLowerCase();
            const shouldHide = CONFIG.hiddenColumns.some(col => col.toLowerCase() === text);
            const nth = index + 1;

            if (shouldHide) {
                styleContent += `
                    div[role="columnheader"]:nth-child(${nth}),
                    div[role="cell"]:nth-child(${nth}) {
                        display: none !important;
                    }
                `;
            }

            const customWidthKey = Object.keys(CONFIG.customWidths).find(col => col.toLowerCase() === text);
            if (customWidthKey) {
                const width = CONFIG.customWidths[customWidthKey];
                styleContent += `
                    div[role="columnheader"]:nth-child(${nth}),
                    div[role="cell"]:nth-child(${nth}) {
                        min-width: ${width} !important;
                        max-width: ${width} !important;
                        width: ${width} !important;
                        flex-basis: ${width} !important;
                    }
                    div[role="cell"]:nth-child(${nth}) * {
                        text-overflow: clip !important;
                        overflow: hidden !important;
                    }
                `;
            }
        });

        let styleEl = document.getElementById('jira-compact-table-columns-style');
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'jira-compact-table-columns-style';
            document.head.appendChild(styleEl);
        }

        if (styleEl.innerHTML !== styleContent) {
            styleEl.innerHTML = styleContent;
        }
    }

    // ==========================================
    // DATE FORMATTING & HOVER LOGIC
    // ==========================================
    function formatDate(text) {
        // Matches typical Jira format: "18/Jun/26 10:23"
        const regex = /^(\d{1,2})\/([A-Za-z]{3})\/(\d{2,4})\s+(.+)$/i;
        const match = text.trim().match(regex);

        if (match) {
            const day = match[1].padStart(2, '0');
            const monthStr = match[2].toLowerCase();
            const months = {
                jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
                jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
            };
            const month = months[monthStr] || '00';
            let time = match[4];

            // Convert 12h to 24h if necessary
            const timeMatch = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
            if (timeMatch) {
                let hours = parseInt(timeMatch[1], 10);
                const mins = timeMatch[2];
                const ampm = timeMatch[3].toUpperCase();
                if (ampm === 'PM' && hours < 12) hours += 12;
                if (ampm === 'AM' && hours === 12) hours = 0;
                time = `${hours.toString().padStart(2, '0')}:${mins}`;
            }

            return `${day}.${month} ${time}`;
        }
        return null;
    }

    function processRows() {
        // 1. Format Dates (for "Created" and "Dashboard Reminder Date" columns)
        const dateCells = document.querySelectorAll('[data-testid$="-created"], [data-testid$="-customfield_10803"]');
        dateCells.forEach(cell => {
            const innerDiv = cell.querySelector('div[title]') || cell.querySelector('div');
            if (innerDiv && innerDiv.textContent) {
                // To avoid parsing "Today 10:23" if it's already modified
                if (innerDiv.textContent.includes('/')) {
                    const formatted = formatDate(innerDiv.textContent);
                    if (formatted && innerDiv.textContent !== formatted) {
                        innerDiv.textContent = formatted;
                    }
                }
            }
        });

        // 2. Add Hover Title to Summary
        const summaryCells = document.querySelectorAll('[data-testid$="-summary"]');
        summaryCells.forEach(cell => {
            const link = cell.querySelector('a.issue-link');
            if (link && !link.hasAttribute('title')) {
                link.setAttribute('title', link.textContent.trim());
            }
        });
    }

    // ==========================================
    // MUTATION OBSERVER
    // ==========================================
    const observer = new MutationObserver(() => {
        applyColumnStyles();
        processRows();
    });

    // Initialize
    injectCSS();
    observer.observe(document.body, {
        childList: true,
        subtree: true,
    });

    // Run once immediately
    applyColumnStyles();
    processRows();

})();
