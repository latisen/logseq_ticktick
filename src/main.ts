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

async function safeSync(reason: string) {
  if (syncing) return
  syncing = true
  try {
    console.log(`[ticktick-sync] running sync (${reason})`)
    await runSync()
  } catch (e) {
    console.error('[ticktick-sync] sync failed:', e)
    await logseq.UI.showMsg(`TickTick sync failed: ${(e as Error).message}`, 'error')
  } finally {
    syncing = false
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
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => safeSync('graph change'), 3000)
}

async function connectStep1() {
  const settings = getSettings()
  if (!settings.clientId || !settings.clientSecret) {
    await logseq.UI.showMsg('Please fill in Client ID and Client Secret in the plugin settings first.', 'warning')
    return
  }
  const state = Math.random().toString(36).slice(2)
  const url = ticktick.buildAuthorizeUrl(state)
  if (logseq.App.openExternalLink) {
    await logseq.App.openExternalLink(url)
  } else {
    window.open(url, '_blank')
  }
  await logseq.UI.showMsg(
    'Approve access in your browser, then copy the "code" parameter from the redirected URL into the ' +
      '"Authorization code" setting and run "TickTick: 2. Exchange authorization code".',
    'success',
    { timeout: 8000 },
  )
}

async function connectStep2() {
  const settings = getSettings()
  if (!settings.authCode) {
    await logseq.UI.showMsg('Paste the authorization code into settings first.', 'warning')
    return
  }
  try {
    const tokens = await ticktick.exchangeCodeForToken(settings.authCode)
    await logseq.updateSettings({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || '',
      authCode: '',
    })
    await logseq.UI.showMsg('Connected to TickTick successfully!', 'success')
  } catch (e) {
    console.error('[ticktick-sync] token exchange failed:', e)
    await logseq.UI.showMsg(`Could not exchange the code: ${(e as Error).message}`, 'error')
  }
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

  logseq.App.registerCommandPalette(
    { key: 'ticktick-connect-1', label: 'TickTick: 1. Open authorization page' },
    connectStep1,
  )
  logseq.App.registerCommandPalette(
    { key: 'ticktick-connect-2', label: 'TickTick: 2. Exchange authorization code' },
    connectStep2,
  )
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
