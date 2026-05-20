### Instalation

1. Install Tampermonkey/Violentmonkey or similar extension
2. Create new script in extension's dashboard
3. Paste the code of the script that you want to use from this repo
4. Hit save and reload Jira tab

### Scripts

* **\`bot_human_highlighter.js\`**: Visually separates monitoring alerts from human requests, and cleans up long subject lines.
* **\`header_proxy.js\`**: Hides main header with a toggle button to reveal it for editing.
* **\`heatmap_update_time.js\`**: Colors tickets by update age, adds unread dot, and auto-cleans old view data.
* **\`order_number_extractor.js\`**: Extracts 10xx/30xx orders from the issue description and lists them for quick copying.
* **\`recovery_signal.js\`**: Adds a pulsing green indicator if the 'recovered' label is present on the issue.
* **\`signature.js\`**: Adds a button to insert a standard signature in the Jira comment editor.
* **\`ticket_list_highlighter.js\`**: Dynamically highlights rows in the Jira issue list when their status is "In Progress".
* **\`worklog_helper.js\`**: Auto-expands the 'Log Work' modal and adds quick time buttons for logging.
