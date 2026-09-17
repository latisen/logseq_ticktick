import '@logseq/libs'
import { BlockEntity } from '@logseq/libs/dist/LSPlugin'
import * as ticktick from './ticktick'
import {
  DONE_MARKERS,
  PluginSettings,
  SyncRecord,
  SyncResult,
  TASK_MARKERS,
  TickTickTask,
} from './types'

function getSettings(): PluginSettings {
  return logseq.settings as unknown as PluginSettings
}

function taskLabel(block: BlockEntity): string {
  const title = block.fullTitle || block.title || block.content || block.uuid
  return title.length > 80 ? `${title.slice(0, 77)}...` : title
}

async function syncStep<T>(description: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action()
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`${description}. Underlying error: ${detail}`)
  }
}

const SYNC_STORAGE_KEY = 'sync-mappings-v1'
const LEGACY_ID_PROPERTY = 'ticktick-id'
const LEGACY_PROJECT_PROPERTY = 'ticktick-project'
const LEGACY_TITLE_PROPERTY = 'ticktick-title'
let doneStatusId: number | null = null

function getStorage() {
  return logseq.Assets.makeSandboxStorage()
}

async function loadSyncRecords(): Promise<Record<string, SyncRecord>> {
  let value: string | undefined
  try {
    value = await getStorage().getItem(SYNC_STORAGE_KEY)
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes('file not existed')) {
      return {}
    }
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Logseq could not read TickTick sync mappings. Underlying error: ${detail}`)
  }
  if (!value || typeof value !== 'string') return {}
  try {
    return JSON.parse(value) as Record<string, SyncRecord>
  } catch {
    console.warn('[ticktick-sync] Ignoring unreadable sync mapping data.')
    return {}
  }
}

async function saveSyncRecords(records: Record<string, SyncRecord>): Promise<void> {
  await syncStep('Logseq could not save TickTick sync mappings', () =>
    getStorage().setItem(SYNC_STORAGE_KEY, JSON.stringify(records)))
}

function isDoneMarker(marker?: string | null): boolean {
  return !!marker && DONE_MARKERS.has(marker.toUpperCase())
}

function statusFromContent(content?: string): string | null {
  const match = content?.match(/(?:^|\s)Status::\s*(Todo|Doing|Now|Later|Done|Canceled|Cancelled)\s*$/i)
  return match?.[1]?.toUpperCase() || null
}

function normalizeStatus(value: unknown): string | null {
  if (typeof value === 'string') {
    const parts = value.split('.')
    return (parts[parts.length - 1] || '').toUpperCase() || null
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return normalizeStatus(record.ident ?? record['db/ident'] ?? record.name)
  }
  return null
}

function statusFromProperties(block: BlockEntity): string | null {
  const value = block.properties?.status ?? block.properties?.Status ??
    block['logseq.property/status'] ?? block[':logseq.property/status'] ??
    block['logseq.task/status'] ?? block[':logseq.task/status']
  return normalizeStatus(value)
}

function isTaskBlock(block: BlockEntity): boolean {
  const status = block.marker || statusFromProperties(block) || statusFromContent(block.content)
  return !!status && TASK_MARKERS.has(status.toUpperCase())
}

function isBlockDone(block: BlockEntity): boolean {
  return isDoneMarker(block.marker) ||
    isDoneMarker(statusFromProperties(block)) ||
    isDoneMarker(statusFromContent(block.content))
}

function titleFromContent(content: string, marker?: string | null): string {
  const firstLine = content.split('\n')[0]
  const withoutMarker = marker
    ? firstLine.replace(new RegExp(`^${marker}\\s*`, 'i'), '')
    : firstLine.replace(/^(TODO|DOING|NOW|LATER|DONE|CANCELED|CANCELLED)\s*/i, '')
  return withoutMarker.replace(/\s+Status::\s*\w+\s*$/i, '').trim()
}

function contentWithTitle(block: BlockEntity, title: string): string {
  if (block.title && !block.content) return title
  const content = block.content || ''
  const firstLine = content.split('\n')[0]
  const rest = content.slice(firstLine.length)
  const statusProperty = firstLine.match(/(\s+Status::\s*\w+\s*)$/i)?.[1] || ''
  return block.marker ? `${block.marker} ${title}${rest}` : `${title}${statusProperty}${rest}`
}

async function blockText(block: BlockEntity, titlesByUuid?: Map<string, string>): Promise<string> {
  let text = block.fullTitle || block.title || block.content || ''
  if (!titlesByUuid) return text
  return text.replace(/\[\[([0-9a-f]{8}-[0-9a-f-]{27,})\]\]/gi, (_, uuid: string) =>
    `[[${titlesByUuid.get(uuid) || uuid}]]`)
}

function buildLogseqLink(graphName: string, blockUuid: string): string {
  return `logseq://graph/${encodeURIComponent(graphName)}?block-id=${encodeURIComponent(blockUuid)}`
}

function contentWithLogseqLink(content: string | undefined, link: string): string {
  const withoutOldLink = (content || '').replace(/\n*Open in Logseq: \[Open in Logseq\]\([^)]*\)/g, '').trimEnd()
  return `${withoutOldLink}${withoutOldLink ? '\n\n' : ''}Open in Logseq: [Open in Logseq](${link})`
}

function hasLogseqLink(content: string | undefined, link: string): boolean {
  return !!content?.includes(`](${link})`)
}

async function getAllLocalTaskBlocks(): Promise<BlockEntity[]> {
  const isDbGraph = await logseq.App.checkCurrentIsDbGraph()
  if (!isDbGraph) {
    const result = await logseq.DB.datascriptQuery<Array<[BlockEntity]>>(`
      [:find (pull ?block [*])
       :where [?block :block/content ?content]]
    `)
    return result.map(([block]) => block).filter(isTaskBlock)
  }

  const [classResults, statusResults] = await Promise.all([
    logseq.DB.datascriptQuery<Array<[BlockEntity]>>(`
      [:find (pull ?block [*])
       :where
       [?block :block/tags ?tag]
       [?tag :db/ident :logseq.class/Task]]
    `),
    logseq.DB.datascriptQuery<Array<[BlockEntity]>>(`
      [:find (pull ?block [*])
       :where
       [?block :logseq.property/status ?status]]
    `),
  ])

  const blocksByUuid = new Map<string, BlockEntity>()
  for (const [block] of [...classResults, ...statusResults]) {
    if (isTaskBlock(block)) blocksByUuid.set(block.uuid, block)
  }
  return [...blocksByUuid.values()]
}

async function getCompletedDbTaskUuids(): Promise<Set<string>> {
  if (!(await logseq.App.checkCurrentIsDbGraph())) return new Set()
  const uuids = await logseq.DB.datascriptQuery<Array<string>>(`
    [:find [?uuid ...]
     :where
     [?block :block/uuid ?uuid]
     [?block :logseq.property/status ?status]
     [?status :db/ident :logseq.property/status.done]]
  `)
  return new Set(uuids.map(String))
}

function isBlockCompleted(block: BlockEntity, completedDbTaskUuids: Set<string>): boolean {
  return completedDbTaskUuids.has(block.uuid) || isBlockDone(block)
}

async function markBlockDone(block: BlockEntity): Promise<void> {
  const content = block.fullTitle || block.title || block.content || ''
  if (await logseq.App.checkCurrentIsDbGraph()) {
    if (doneStatusId === null) {
      doneStatusId = await syncStep('Logseq could not find its built-in Done status', () =>
        logseq.DB.datascriptQuery<number>(`
          [:find ?status .
           :where
           [?status :db/ident :logseq.property/status.done]]
        `))
    }
    if (!doneStatusId) {
      throw new Error('Logseq could not find its built-in Done status value.')
    }
    await logseq.Editor.upsertBlockProperty(
      block.uuid,
      ':logseq.property/status',
      doneStatusId,
    )
    return
  }
  if (statusFromProperties(block)) {
    await logseq.Editor.upsertBlockProperty(block.uuid, 'status', 'logseq.property/status.done')
    return
  }
  if (!block.marker && statusFromContent(content)) {
    await logseq.Editor.updateBlock(block.uuid, content.replace(/Status::\s*\w+\s*$/i, 'Status:: Done'))
    return
  }
  const firstLine = content.split('\n')[0]
  const rest = content.slice(firstLine.length)
  const newFirstLine = block.marker
    ? firstLine.replace(new RegExp(`^${block.marker}`, 'i'), 'DONE')
    : `DONE ${firstLine}`
  await logseq.Editor.updateBlock(block.uuid, `${newFirstLine}${rest}`)
}

async function repairLegacyDonePrefix(block: BlockEntity): Promise<boolean> {
  const text = block.fullTitle || block.title || block.content || ''
  const repaired = text.replace(/^DONE\s+(.+?\s+Status::\s*)(?:Todo|Doing|Now|Later|Done|Canceled|Cancelled)\s*$/i, '$1Done')
  if (repaired === text) return false
  await logseq.Editor.updateBlock(block.uuid, repaired)
  return true
}

// Due dates are only synced on DB graphs, which expose a built-in timestamp property.
const SCHEDULED_PROPERTY = ':logseq.property/scheduled'
const LIST_PROPERTY = 'ticktick-list'

function msToIsoDueDate(ms: number): string {
  return new Date(ms).toISOString()
}

function isoDueDateToMs(iso?: string | null): number | null {
  if (!iso) return null
  const parsed = Date.parse(iso)
  return Number.isNaN(parsed) ? null : parsed
}

function getLocalScheduledMs(block: BlockEntity): number | null {
  const raw = block[SCHEDULED_PROPERTY] ?? block['logseq.property/scheduled'] ?? block.properties?.scheduled
  if (raw === null || raw === undefined) return null
  const value = raw instanceof Date ? raw.getTime() : Number(raw)
  return Number.isNaN(value) ? null : value
}

async function setLocalScheduled(block: BlockEntity, ms: number | null): Promise<void> {
  if (ms === null) {
    await logseq.Editor.removeBlockProperty(block.uuid, SCHEDULED_PROPERTY)
  } else {
    await logseq.Editor.upsertBlockProperty(block.uuid, SCHEDULED_PROPERTY, ms)
  }
}

function getLocalListName(block: BlockEntity): string | null {
  const raw = block.properties?.[LIST_PROPERTY] ?? block[LIST_PROPERTY]
  return typeof raw === 'string' && raw.trim() ? raw.trim() : null
}

async function setLocalListName(block: BlockEntity, name: string): Promise<void> {
  if (!name) return
  await logseq.Editor.upsertBlockProperty(block.uuid, LIST_PROPERTY, name)
}

interface RemoteData {
  tasksById: Map<string, TickTickTask>
  projectsById: Map<string, { id: string; name: string }>
}

// Reused across syncs within the TTL so bursts of auto-sync triggers (interval +
// graph-change debounce) don't each re-fetch every project from TickTick.
const REMOTE_DATA_CACHE_MS = 90000
let remoteDataCache: { data: RemoteData; fetchedAt: number } | null = null

async function getRemoteData(): Promise<RemoteData> {
  if (remoteDataCache && Date.now() - remoteDataCache.fetchedAt < REMOTE_DATA_CACHE_MS) {
    return remoteDataCache.data
  }
  const projects = await syncStep('TickTick could not list projects', () => ticktick.listProjects())
  const projectData = await Promise.all(projects.map((project) => syncStep(
    `TickTick could not read project "${project.name}" (${project.id})`,
    () => ticktick.getProjectData(project.id),
  )))
  const tasksById = new Map(projectData.flatMap((project) => project.tasks || []).map((task) => [task.id, task]))
  const projectsById = new Map(projects.map((project) => [project.id, project]))
  const data = { tasksById, projectsById }
  remoteDataCache = { data, fetchedAt: Date.now() }
  return data
}

// TickTick Inbox tasks are never covered by getRemoteData, so we'd otherwise have to
// ask about each one individually on every sync. This throttles that per-task check.
const INBOX_CHECK_INTERVAL_MS = 10 * 60 * 1000

function syncRecord(task: TickTickTask, status: number, projectName: string): SyncRecord {
  return {
    taskId: task.id,
    projectId: task.projectId,
    projectName,
    title: task.title,
    status,
    dueDate: isoDueDateToMs(task.dueDate ?? null),
  }
}

export async function runSync(): Promise<SyncResult> {
  const settings = getSettings()
  if (!settings.apiKey) {
    console.warn('[ticktick-sync] Skipping sync: no API key configured.')
    return {
      localTaskCount: 0, createdInTickTick: 0, importedFromTickTick: 0, migratedMappings: 0,
      completedInTickTick: 0, completedInLogseq: 0, completionCandidates: 0, alreadyCompleted: 0,
      movedListInTickTick: 0, movedListInLogseq: 0, dueDateUpdatedInTickTick: 0, dueDateUpdatedInLogseq: 0,
    }
  }

  const isDbGraph = await logseq.App.checkCurrentIsDbGraph()
  const graph = await syncStep('Logseq could not determine the current graph', () => logseq.App.getCurrentGraph())
  const graphName = graph?.name || ''
  const importPage = settings.targetPage || 'ticktick'
  const localBlocks = await syncStep('Logseq could not query task blocks in this graph', getAllLocalTaskBlocks)
  const titleRows = isDbGraph
    ? await syncStep('Logseq could not resolve block reference titles', () => logseq.DB.datascriptQuery<Array<[string, string]>>(`
        [:find ?uuid ?title
         :where [?block :block/uuid ?uuid] [?block :block/title ?title]]
      `))
    : []
  const titlesByUuid = new Map(titleRows.map(([uuid, title]) => [String(uuid), title]))
  const completedDbTaskUuids = await syncStep(
    'Logseq could not query completed task statuses',
    getCompletedDbTaskUuids,
  )
  const { tasksById: remoteById, projectsById } = await getRemoteData()
  const syncRecords = await loadSyncRecords()
  const localByTaskId = new Map<string, BlockEntity>()
  let createdInTickTick = 0
  let importedFromTickTick = 0
  let migratedMappings = 0
  let completedInTickTick = 0
  let completionCandidates = 0
  let alreadyCompleted = 0
  let movedListInTickTick = 0
  let movedListInLogseq = 0
  let dueDateUpdatedInTickTick = 0
  let dueDateUpdatedInLogseq = 0

  for (const block of localBlocks) {
    await syncStep(`Logseq could not repair status for task "${taskLabel(block)}"`, () => repairLegacyDonePrefix(block))
    let record = syncRecords[block.uuid]
    if (!record) {
      const legacyTaskId = await logseq.Editor.getBlockProperty(block.uuid, LEGACY_ID_PROPERTY)
      if (legacyTaskId) {
        const projectId = String((await logseq.Editor.getBlockProperty(block.uuid, LEGACY_PROJECT_PROPERTY)) || '')
        const title = await logseq.Editor.getBlockProperty(block.uuid, LEGACY_TITLE_PROPERTY)
        record = {
          taskId: String(legacyTaskId),
          projectId,
          projectName: projectsById.get(projectId)?.name || '',
          title: String(title || titleFromContent(await blockText(block, titlesByUuid), block.marker)),
          status: isBlockCompleted(block, completedDbTaskUuids) ? 2 : 0,
          dueDate: isDbGraph ? getLocalScheduledMs(block) : null,
        }
        syncRecords[block.uuid] = record
        migratedMappings += 1
      }
    }
    if (record) localByTaskId.set(record.taskId, block)
  }

  // New vault tasks are created in the configured default project or TickTick Inbox,
  // unless the block already names a target list via the "ticktick-list" property.
  for (const block of localBlocks) {
    if (syncRecords[block.uuid]) continue
    const title = titleFromContent(await blockText(block, titlesByUuid), block.marker)
    if (!title) continue

    const desiredListName = getLocalListName(block)
    const desiredProject = desiredListName
      ? [...projectsById.values()].find((p) => p.name.toLowerCase() === desiredListName.toLowerCase())
      : undefined
    const projectId = desiredProject?.id || settings.projectId
    const localDueMs = isDbGraph ? getLocalScheduledMs(block) : null
    const logseqLink = buildLogseqLink(graphName, block.uuid)

    const task = await syncStep(
      `TickTick could not create task "${title}"`,
      () => ticktick.createTask({
        title,
        content: contentWithLogseqLink('', logseqLink),
        ...(projectId ? { projectId } : {}),
        ...(localDueMs !== null ? { dueDate: msToIsoDueDate(localDueMs), isAllDay: false } : {}),
      }),
    )
    const done = isBlockCompleted(block, completedDbTaskUuids)
    if (done) await syncStep(`TickTick could not complete newly created task "${title}"`, () =>
      ticktick.completeTask(task.projectId, task.id))

    const projectName = projectsById.get(task.projectId)?.name || desiredListName || ''
    if (projectName) await syncStep(`Logseq could not save the list name for task "${title}"`, () =>
      setLocalListName(block, projectName))

    syncRecords[block.uuid] = syncRecord(task, done ? 2 : 0, projectName)
    createdInTickTick += 1
    localByTaskId.set(task.id, block)
    // Keep the cached remote data in sync so a follow-up sync within the cache TTL sees this task.
    remoteById.set(task.id, { ...task, status: done ? 2 : task.status })
  }

  // Existing mappings carry title, list, due date, and completion changes in either direction.
  // A simultaneous title conflict resolves to the Logseq version.
  for (const [taskId, block] of localByTaskId) {
    const record = syncRecords[block.uuid]
    if (!record) continue
    let projectId = record.projectId
    if (!projectId) continue

    const localTitle = titleFromContent(await blockText(block, titlesByUuid), block.marker)
    const storedTitle = record.title
    const storedStatus = record.status
    const localStatus = isBlockCompleted(block, completedDbTaskUuids) ? 2 : 0
    const remote = remoteById.get(taskId)
    const logseqLink = buildLogseqLink(graphName, block.uuid)

    if (localStatus === 2) {
      completionCandidates += 1
      if (storedStatus === 2) alreadyCompleted += 1
    }

    if (!remote) {
      // TickTick does not return Inbox in its project listing. Pushing a local
      // completion never needs an extra read, so do that without any API call.
      if (localStatus === 2 && storedStatus !== 2) {
        await syncStep(`TickTick could not complete task "${taskLabel(block)}"`, () =>
          ticktick.completeTask(projectId, taskId))
        record.status = 2
        completedInTickTick += 1
        continue
      }

      // Detecting a TickTick-side completion needs a direct read (Inbox isn't in the
      // project listing), so throttle it instead of checking every single sync.
      const lastChecked = record.lastCheckedAt || 0
      if (localStatus === 2 || Date.now() - lastChecked < INBOX_CHECK_INTERVAL_MS) continue
      try {
        const task = await syncStep(`TickTick could not load task "${taskLabel(block)}"`, () =>
          ticktick.getTask(projectId, taskId))
        record.lastCheckedAt = Date.now()
        if (task.status === 2) {
          await syncStep(`Logseq could not mark task "${taskLabel(block)}" as done`, () => markBlockDone(block))
          record.status = 2
        }
      } catch (error) {
        console.warn(`[ticktick-sync] Could not load TickTick task ${taskId}:`, error)
      }
      continue
    }

    if (!hasLogseqLink(remote.content, logseqLink)) {
      const nextContent = contentWithLogseqLink(remote.content, logseqLink)
      await syncStep(`TickTick could not save the Logseq link for task "${taskLabel(block)}"`, () =>
        ticktick.updateTask(taskId, { content: nextContent, projectId }))
      remote.content = nextContent
    }

    // Moving a task between TickTick lists: edit the "ticktick-list" property in Logseq,
    // or move the task in TickTick directly. Whichever changed since the last sync wins.
    const desiredListName = getLocalListName(block)
    const remoteProjectName = projectsById.get(remote.projectId)?.name || ''
    if (desiredListName && desiredListName.toLowerCase() !== (record.projectName || '').toLowerCase()) {
      const targetProject = [...projectsById.values()].find((p) => p.name.toLowerCase() === desiredListName.toLowerCase())
      if (targetProject && targetProject.id !== record.projectId) {
        await syncStep(`TickTick could not move task "${taskLabel(block)}" to list "${desiredListName}"`, () =>
          ticktick.updateTask(taskId, { projectId: targetProject.id }))
        record.projectId = targetProject.id
        record.projectName = targetProject.name
        projectId = targetProject.id
        remote.projectId = targetProject.id
        movedListInTickTick += 1
      }
    } else if (remote.projectId !== record.projectId) {
      record.projectId = remote.projectId
      record.projectName = remoteProjectName
      projectId = remote.projectId
      await syncStep(`Logseq could not update the list for task "${taskLabel(block)}"`, () =>
        setLocalListName(block, remoteProjectName))
      movedListInLogseq += 1
    }

    if (localTitle !== storedTitle && localTitle !== remote.title) {
      await syncStep(`TickTick could not update title for task "${localTitle}"`, () =>
        ticktick.updateTask(taskId, { title: localTitle, projectId }))
      record.title = localTitle
      remote.title = localTitle
    } else if (remote.title !== storedTitle && remote.title !== localTitle) {
      await syncStep(`Logseq could not update title for task "${taskLabel(block)}"`, () =>
        logseq.Editor.updateBlock(block.uuid, contentWithTitle(block, remote.title)))
      record.title = remote.title
    }

    // Due dates: only pushed to TickTick when set locally (clearing a remote due
    // date isn't supported yet). Remote due date changes, including clearing, sync back.
    if (isDbGraph) {
      const localDueMs = getLocalScheduledMs(block)
      const storedDueMs = record.dueDate
      const remoteDueMs = isoDueDateToMs(remote.dueDate ?? null)

      if (localDueMs !== null && localDueMs !== storedDueMs && localDueMs !== remoteDueMs) {
        await syncStep(`TickTick could not update the due date for task "${taskLabel(block)}"`, () =>
          ticktick.updateTask(taskId, { dueDate: msToIsoDueDate(localDueMs), isAllDay: false, projectId }))
        record.dueDate = localDueMs
        remote.dueDate = msToIsoDueDate(localDueMs)
        dueDateUpdatedInTickTick += 1
      } else if (remoteDueMs !== storedDueMs && remoteDueMs !== localDueMs) {
        await syncStep(`Logseq could not update the due date for task "${taskLabel(block)}"`, () =>
          setLocalScheduled(block, remoteDueMs))
        record.dueDate = remoteDueMs
        dueDateUpdatedInLogseq += 1
      }
    }

    // The stored status is only cache data. TickTick's active-task list is the
    // authority: an active remote task must be completed when Logseq says Done.
    if (localStatus === 2) {
      await syncStep(`TickTick could not complete task "${taskLabel(block)}"`, () =>
        ticktick.completeTask(projectId, taskId))
      record.status = 2
      remote.status = 2
      completedInTickTick += 1
    }
  }

  // New TickTick tasks cannot retain a Logseq location, so they are appended to one import page.
  for (const task of remoteById.values()) {
    if (localByTaskId.has(task.id)) continue
    const block = await syncStep(`Logseq could not import TickTick task "${task.title}" to page "${importPage}"`, () =>
      logseq.Editor.appendBlockInPage(importPage, `TODO ${task.title}`))
    if (block) {
      const projectName = projectsById.get(task.projectId)?.name || ''
      const logseqLink = buildLogseqLink(graphName, block.uuid)
      const nextContent = contentWithLogseqLink(task.content, logseqLink)
      await syncStep(`TickTick could not save the Logseq link for task "${task.title}"`, () =>
        ticktick.updateTask(task.id, { content: nextContent, projectId: task.projectId }))
      task.content = nextContent
      if (projectName) await setLocalListName(block, projectName)
      const dueMs = isoDueDateToMs(task.dueDate ?? null)
      if (isDbGraph && dueMs !== null) await setLocalScheduled(block, dueMs)
      syncRecords[block.uuid] = syncRecord(task, task.status === 2 ? 2 : 0, projectName)
      importedFromTickTick += 1
    }
  }

  await saveSyncRecords(syncRecords)
  return {
    localTaskCount: localBlocks.length,
    createdInTickTick,
    importedFromTickTick,
    migratedMappings,
    completedInTickTick,
    completedInLogseq: completedDbTaskUuids.size,
    completionCandidates,
    alreadyCompleted,
    movedListInTickTick,
    movedListInLogseq,
    dueDateUpdatedInTickTick,
    dueDateUpdatedInLogseq,
  }
}
