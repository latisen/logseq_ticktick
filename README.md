# TickTick Sync for Logseq

Two-way sync between Logseq tasks and [TickTick](https://ticktick.com), built on the
[TickTick Open API](https://developer.ticktick.com/api#/openapi?id=api-reference) and
[`@logseq/libs`](https://github.com/logseq/logseq-plugin-samples).

## What it does

- A new `TODO`/`DOING`/... block anywhere in the vault is created as a task in TickTick.
- A new task in any normal TickTick project is appended to the configured Logseq import page.
- Marking a task `DONE`/`CANCELED` in Logseq completes it in TickTick.
- Completing a task in TickTick marks the matching Logseq block `DONE`.
- Editing a synced task title in either Logseq or TickTick updates the other side.
- Moving a task to a different TickTick list, or editing its `ticktick-list` property in Logseq,
  moves the task on the other side too.
- Editing a task's due date (DB graphs only, via the built-in `Scheduled` property) pushes the change
  to TickTick; a due date change in TickTick updates the Logseq property.

Sync happens automatically (interval + shortly after you edit the graph), or on demand via the
toolbar refresh button / command palette.

**Scope:** every task block in the vault is included, including nested blocks. New local tasks go to
the default TickTick project (or Inbox), unless the block already has a `ticktick-list` property naming
an existing TickTick list. New remote tasks go to the configured import page because TickTick has no
Logseq placement information. Priorities, descriptions, subtasks, deletes, and reopening completed
tasks are not currently synced. Clearing a scheduled date in Logseq does not clear it in TickTick. Due date
sync requires a Logseq **DB graph**. If the same title changes on both sides before a sync, Logseq wins.

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
2. Run **"TickTick: List projects"** to see project IDs. Paste one into the
   **Default TickTick project (list) ID** setting to choose where newly created Logseq tasks go, or
   leave it empty to create them in TickTick Inbox.
3. (Optional) change **Page for new TickTick tasks** (defaults to `ticktick`).

Add task blocks anywhere in Logseq or tasks in any normal TickTick project; they sync automatically.

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
- [src/ticktick.ts](src/ticktick.ts) — TickTick REST API client.
- [src/sync.ts](src/sync.ts) — the actual two-way sync logic.
- [src/settings.ts](src/settings.ts) — settings schema shown in the plugin's settings panel.

## License

MIT