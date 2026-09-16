# TickTick Sync for Logseq

Two-way sync between Logseq tasks and [TickTick](https://ticktick.com), built on the
[TickTick Open API](https://developer.ticktick.com/api#/openapi?id=api-reference) and
[`@logseq/libs`](https://github.com/logseq/logseq-plugin-samples).

## What it does

- A new `TODO`/`DOING`/... block on your configured Logseq sync page is created as a task in TickTick.
- A new task in your configured TickTick project is appended as a block on that Logseq page.
- Marking a task `DONE`/`CANCELED` in Logseq completes it in TickTick.
- Completing a task in TickTick marks the matching Logseq block `DONE`.

Sync happens automatically (interval + shortly after you edit the sync page), or on demand via the
toolbar refresh button / command palette.

**Scope (v1):** only top-level blocks on one configured Logseq page are synced, matched against one
TickTick project (list). This keeps the matching logic simple and predictable. Editing a task's title
after creation, due dates, subtasks, etc. are not synced (only creation + completion, per the original
requirements).

## Setup

### 1. Create an API key

1. Go to <https://developer.ticktick.com/manage>.
2. Create or copy your personal **API Key**.

### 2. Install the plugin

```bash
npm install
npm run build
```

Then in Logseq: enable **Developer mode** in settings, open the plugins dashboard (`t` `p`), click
**Load unpacked plugin**, and select this folder.

### 3. Configure

1. Open the plugin's settings and paste the API key into **API key**.
2. Run **"TickTick: List projects"** to see your TickTick project IDs. Paste one into the
   **TickTick project (list) ID** setting to sync that list, or leave it empty to create new Logseq
   tasks in TickTick Inbox.
3. (Optional) change the **Logseq sync page** setting (defaults to the page `ticktick`).

Add tasks as top-level blocks on that page in Logseq, or in the chosen list in TickTick, and they'll
sync automatically.

## Security note

The API key is stored in the plugin's settings (`.logseq/plugin-settings` in your graph),
which is local to your machine but not encrypted. Treat it like any other local config file.

## Development

```bash
npm run dev    # vite dev server
npm run build  # production bundle in dist/
```

Main source files:

- [src/main.ts](src/main.ts) — plugin bootstrap, settings, commands, toolbar button, scheduling.
- [src/ticktick.ts](src/ticktick.ts) — TickTick OAuth + REST API client.
- [src/sync.ts](src/sync.ts) — the actual two-way sync logic.
- [src/settings.ts](src/settings.ts) — settings schema shown in the plugin's settings panel.

## License

MIT