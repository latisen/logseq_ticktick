import '@logseq/libs'
import { settingsSchema } from './settings'
import * as ticktick from './ticktick'
import { runSync } from './sync'
import { PluginSettings } from './types'

function getSettings(): PluginSettings {
  return logseq.settings as unknown as PluginSettings
}

let syncTimer: ReturnType<typeof setInterval> | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let syncing = false
// A sync writes block properties itself, which fires DB.onChanged again. Without this
// cooldown, every sync would immediately re-schedule another one, multiplying API calls.
let lastSyncEndedAt = 0
const AUTO_SYNC_COOLDOWN_MS = 15000

async function safeSync(reason: string) {
  if (syncing) return
  syncing = true
  try {
    console.log(`[ticktick-sync] running sync (${reason})`)
    const result = await runSync()
    if (reason === 'manual command' || reason === 'toolbar click') {
      await logseq.UI.showMsg(
        `TickTick sync completed. Found ${result.localTaskCount} Logseq task(s); ` +
          `created ${result.createdInTickTick} in TickTick; imported ${result.importedFromTickTick}; ` +
          `completed ${result.completedInTickTick} in TickTick; Logseq reports ${result.completedInLogseq} done ` +
          `(${result.completionCandidates} mapped, ${result.alreadyCompleted} already synced); ` +
          `moved ${result.movedListInTickTick} list(s) in TickTick, ${result.movedListInLogseq} in Logseq; ` +
          `due dates updated: ${result.dueDateUpdatedInTickTick} in TickTick, ${result.dueDateUpdatedInLogseq} in Logseq; ` +
          `migrated ${result.migratedMappings} older link(s).`,
        'success',
        { timeout: 10000 },
      )
    }
  } catch (e) {
    console.error('[ticktick-sync] sync failed:', e)
    await logseq.UI.showMsg(`TickTick sync failed: ${(e as Error).message}`, 'error')
  } finally {
    syncing = false
    lastSyncEndedAt = Date.now()
  }
}

function scheduleAutoSync() {
  if (syncTimer) {
    clearInterval(syncTimer)
    syncTimer = null
  }
  const interval = getSettings().pollIntervalSec
  if (interval && interval > 0) {
    syncTimer = setInterval(() => safeSync('interval'), interval * 1000)
  }
}

function debounceSyncOnChange() {
  if (!getSettings().autoSync) return
  if (syncing) return
  if (Date.now() - lastSyncEndedAt < AUTO_SYNC_COOLDOWN_MS) return
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => safeSync('graph change'), 5000)
}

async function listProjectsCommand() {
  try {
    const projects = await ticktick.listProjects()
    const lines = projects.map((p) => `- **${p.name}**: \`${p.id}\``).join('\n')
    await logseq.UI.showMsg(
      `[:div.p-2 [:p "Your TickTick projects (copy an id into the plugin settings):"] ` +
        `[:pre "${lines.replace(/"/g, '\\"')}"]]`,
      'success',
      { timeout: 15000 },
    )
  } catch (e) {
    console.error('[ticktick-sync] listing projects failed:', e)
    await logseq.UI.showMsg(`Could not list TickTick projects: ${(e as Error).message}`, 'error')
  }
}

function main() {
  logseq.useSettingsSchema(settingsSchema)

  logseq.App.registerCommandPalette({ key: 'ticktick-list-projects', label: 'TickTick: List projects' }, listProjectsCommand)
  logseq.App.registerCommandPalette(
    { key: 'ticktick-sync-now', label: 'TickTick: Sync now' },
    () => safeSync('manual command'),
  )

  logseq.provideModel({
    ticktickSyncNow: () => safeSync('toolbar click'),
  })

  logseq.App.registerUIItem('toolbar', {
    key: 'ticktick-sync-toolbar',
    template: `
      <a data-on-click="ticktickSyncNow" class="button" title="Sync with TickTick now">
        <i class="ti ti-refresh"></i>
      </a>
    `,
  })

  logseq.onSettingsChanged(() => {
    scheduleAutoSync()
  })

  logseq.DB.onChanged(() => {
    debounceSyncOnChange()
  })

  scheduleAutoSync()
  // Kick off an initial sync shortly after load, if already connected.
  setTimeout(() => safeSync('startup'), 5000)
}

logseq.ready(main).catch(console.error)
