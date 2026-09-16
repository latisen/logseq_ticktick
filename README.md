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

### 1. Create a TickTick app

1. Go to <https://developer.ticktick.com/manage> and create an app.
2. Set the **Redirect URL** to something like `http://localhost:8080/callback` — it does not need to
   be a real, reachable server, it's only used so TickTick can put the authorization `code` in the
   address bar for you to copy.
3. Copy the **Client ID** and **Client Secret**.

### 2. Install the plugin

```bash
npm install
npm run build
```

Then in Logseq: enable **Developer mode** in settings, open the plugins dashboard (`t` `p`), click
**Load unpacked plugin**, and select this folder.

### 3. Configure & connect

1. Open the plugin's settings and fill in **Client ID**, **Client Secret**, and **Redirect URI**
   (matching what you set on developer.ticktick.com).
2. Run the command **"TickTick: 1. Open authorization page"** (`Ctrl/Cmd+Shift+P`). Approve access in
   the browser tab that opens.
3. You'll land on a page that fails to load (expected, since the redirect URI isn't a real server) —
   copy the `code=...` value from the browser's address bar.
4. Paste it into the **Authorization code** setting, then run
   **"TickTick: 2. Exchange authorization code"**. On success, the access/refresh tokens are filled in
   automatically.
5. Run **"TickTick: List projects"** to see your TickTick project IDs, then paste the one you want to
   sync into the **TickTick project (list) ID** setting.
6. (Optional) change the **Logseq sync page** setting (defaults to the page `ticktick`).

Add tasks as top-level blocks on that page in Logseq, or in the chosen list in TickTick, and they'll
sync automatically.

## Security note

Tokens and secrets are stored in the plugin's settings (`.logseq/plugin-settings` in your graph),
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