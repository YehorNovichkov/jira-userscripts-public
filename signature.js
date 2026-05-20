// ==UserScript==
// @name        Jira Toolbar Signature
// @namespace   Violentmonkey Scripts
// @match       https://*.atlassian.net/*
// @grant       none
// @version     1.5.0
// @author      oggmancuc
// @description Adds a button to insert a standard signature in the Jira comment editor.
// ==/UserScript==

; (function () {
    'use strict'

    const SIGNATURE_HTML = `<p>Best regards,<br>Your Name<br>Your Company / Team</p>`
    const BUTTON_LABEL = '✍️ Sign'

    function injectSignature(editor) {
        // Ensure editor is focused
        editor.focus()

        // 1. Move selection to the very end of the document
        const sel = window.getSelection()
        const range = document.createRange()
        range.selectNodeContents(editor)
        range.collapse(false)
        sel.removeAllRanges()
        sel.addRange(range)

        // 2. Logic to check if we need a new paragraph/breakline
        const lastChild = editor.lastElementChild
        const needsNewPara = lastChild && lastChild.innerText.trim().length > 0

        if (needsNewPara) {
            // Equivalent to hitting 'Enter'
            document.execCommand('insertParagraph', false)
        }

        // 3. Insert the signature
        document.execCommand('insertHTML', false, SIGNATURE_HTML)

        // Auto-scroll to show the new signature
        editor.scrollTop = editor.scrollHeight
    }

    function addToolbarButton() {
        // Target both the new and old toolbar containers
        const toolbars = document.querySelectorAll('[data-testid="ak-editor-main-toolbar"], [data-vc="toolbar-inner"]')

        toolbars.forEach((toolbar) => {
            if (toolbar.querySelector('.gm-toolbar-sig-button')) return

            const btnWrapper = document.createElement('span')
            btnWrapper.className = 'gm-toolbar-sig-button'
            btnWrapper.style.cssText = 'display: flex; align-items: center;'

            const sigBtn = document.createElement('button')
            sigBtn.type = 'button'
            sigBtn.className = 'css-1fqi72t'
            sigBtn.style.cssText = `
                display: flex;
                align-items: center;
                padding: 0 8px;
                margin-right: 4px;
                background: var(--ds-background-neutral, #333);
                border: 1px solid var(--ds-border, #444);
                border-radius: 3px;
                height: 24px;
                cursor: pointer;
            `

            sigBtn.innerHTML = `
                <span style="color: var(--ds-text-selected, #579DFF); font-size: 11px; font-weight: bold; white-space: nowrap;">
                    ${BUTTON_LABEL}
                </span>
            `

            sigBtn.addEventListener('click', (e) => {
                e.preventDefault()
                e.stopPropagation()

                // Robust lookup to find the editor container (supports new & old DOM structures)
                let rootEditor = toolbar.closest('.akEditor')
                if (!rootEditor) {
                    let current = toolbar.parentElement
                    while (current && current !== document.body && !current.querySelector('.ProseMirror')) {
                        current = current.parentElement
                    }
                    rootEditor = current !== document.body ? current : null
                }

                const editor = rootEditor ? rootEditor.querySelector('.ProseMirror') : null

                if (editor) {
                    injectSignature(editor)
                } else {
                    console.warn('[SigScript] Could not find editor for this toolbar.')
                }
            })

            const targetContainer = toolbar.querySelector('[data-toolbar-type="primary"]') || toolbar
            targetContainer.prepend(btnWrapper)
            btnWrapper.appendChild(sigBtn)
        })
    }

    const observer = new MutationObserver(addToolbarButton)
    observer.observe(document.body, { childList: true, subtree: true })

    addToolbarButton()
})()
