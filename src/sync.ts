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
  const title = block.title || block.content || block.uuid
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

function blockText(block: BlockEntity): string {
  return block.title || block.content || ''
}

async function getAllLocalTaskBlocks(): Promise<BlockEntity[]> {
  const isDbGraph = await logseq.App.checkCurrentIsDbGraph()
  const query = isDbGraph
    ? `[:find (pull ?block [*])
        :where
        [?block :block/tags ?tag]
        [?tag :db/ident :logseq.class/Task]]`
    : `[:find (pull ?block [*])
        :where
        [?block :block/content ?content]]`
  const result = await logseq.DB.datascriptQuery<Array<[BlockEntity]>>(query)
  return isDbGraph ? result.map(([block]) => block) : result.map(([block]) => block).filter(isTaskBlock)
}

async function markBlockDone(block: BlockEntity): Promise<void> {
  const content = blockText(block)
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
  const text = blockText(block)
  const repaired = text.replace(/^DONE\s+(.+?\s+Status::\s*)(?:Todo|Doing|Now|Later|Done|Canceled|Cancelled)\s*$/i, '$1Done')
  if (repaired === text) return false
  await logseq.Editor.updateBlock(block.uuid, repaired)
  return true
}

async function getRemoteTasks(): Promise<Map<string, TickTickTask>> {
  const projects = await syncStep('TickTick could not list projects', () => ticktick.listProjects())
  const projectData = await Promise.all(projects.map((project) => syncStep(
    `TickTick could not read project "${project.name}" (${project.id})`,
    () => ticktick.getProjectData(project.id),
  )))
  return new Map(projectData.flatMap((project) => project.tasks || []).map((task) => [task.id, task]))
}

function syncRecord(task: TickTickTask, status: number): SyncRecord {
  return {
    taskId: task.id,
    projectId: task.projectId,
    title: task.title,
    status,
  }
}

export async function runSync(): Promise<SyncResult> {
  const settings = getSettings()
  if (!settings.apiKey) {
    console.warn('[ticktick-sync] Skipping sync: no API key configured.')
    return { localTaskCount: 0, createdInTickTick: 0, importedFromTickTick: 0, migratedMappings: 0, completedInTickTick: 0 }
  }

  const importPage = settings.targetPage || 'ticktick'
  const localBlocks = await syncStep('Logseq could not query task blocks in this graph', getAllLocalTaskBlocks)
  const remoteById = await getRemoteTasks()
  const syncRecords = await loadSyncRecords()
  const localByTaskId = new Map<string, BlockEntity>()
  let createdInTickTick = 0
  let importedFromTickTick = 0
  let migratedMappings = 0
  let completedInTickTick = 0

  for (const block of localBlocks) {
    await syncStep(`Logseq could not repair status for task "${taskLabel(block)}"`, () => repairLegacyDonePrefix(block))
    let record = syncRecords[block.uuid]
    if (!record) {
      const legacyTaskId = await logseq.Editor.getBlockProperty(block.uuid, LEGACY_ID_PROPERTY)
      if (legacyTaskId) {
        const projectId = await logseq.Editor.getBlockProperty(block.uuid, LEGACY_PROJECT_PROPERTY)
        const title = await logseq.Editor.getBlockProperty(block.uuid, LEGACY_TITLE_PROPERTY)
        record = {
          taskId: String(legacyTaskId),
          projectId: String(projectId || ''),
          title: String(title || titleFromContent(blockText(block), block.marker)),
          status: isBlockDone(block) ? 2 : 0,
        }
        syncRecords[block.uuid] = record
        migratedMappings += 1
      }
    }
    if (record) localByTaskId.set(record.taskId, block)
  }

  // New vault tasks are created in the configured default project or TickTick Inbox.
  for (const block of localBlocks) {
    if (syncRecords[block.uuid]) continue
    const title = titleFromContent(blockText(block), block.marker)
    if (!title) continue

    const task = await syncStep(
      `TickTick could not create task "${title}"`,
      () => ticktick.createTask({ title, ...(settings.projectId ? { projectId: settings.projectId } : {}) }),
    )
    const done = isBlockDone(block)
    if (done) await syncStep(`TickTick could not complete newly created task "${title}"`, () =>
      ticktick.completeTask(task.projectId, task.id))
    syncRecords[block.uuid] = syncRecord(task, done ? 2 : 0)
    createdInTickTick += 1
    localByTaskId.set(task.id, block)
  }

  // Existing mappings carry title and completion changes in either direction.
  // A simultaneous title conflict resolves to the Logseq version.
  for (const [taskId, block] of localByTaskId) {
    const record = syncRecords[block.uuid]
    if (!record) continue
    const projectId = record.projectId
    if (!projectId) continue

    const localTitle = titleFromContent(blockText(block), block.marker)
    const storedTitle = record.title
    const storedStatus = record.status
    const localStatus = isBlockDone(block) ? 2 : 0
    const remote = remoteById.get(taskId)

    if (!remote) {
      if (storedStatus !== 2 && localStatus !== 2) {
        try {
          const task = await ticktick.getTask(projectId, taskId)
          if (task.status === 2) {
            await syncStep(`Logseq could not mark task "${taskLabel(block)}" as done`, () => markBlockDone(block))
            record.status = 2
          }
        } catch (e) {
          console.warn(`[ticktick-sync] Could not load TickTick task ${taskId}:`, e)
        }
      }
      continue
    }

    if (localTitle !== storedTitle && localTitle !== remote.title) {
      await syncStep(`TickTick could not update title for task "${localTitle}"`, () =>
        ticktick.updateTask(taskId, { title: localTitle, projectId }))
      record.title = localTitle
    } else if (remote.title !== storedTitle && remote.title !== localTitle) {
      await syncStep(`Logseq could not update title for task "${taskLabel(block)}"`, () =>
        logseq.Editor.updateBlock(block.uuid, contentWithTitle(block, remote.title)))
      record.title = remote.title
    }

    if (localStatus === 2 && storedStatus !== 2) {
      await syncStep(`TickTick could not complete task "${taskLabel(block)}"`, () =>
        ticktick.completeTask(projectId, taskId))
      record.status = 2
      completedInTickTick += 1
    }
  }

  // New TickTick tasks cannot retain a Logseq location, so they are appended to one import page.
  for (const task of remoteById.values()) {
    if (localByTaskId.has(task.id)) continue
    const block = await syncStep(`Logseq could not import TickTick task "${task.title}" to page "${importPage}"`, () =>
      logseq.Editor.appendBlockInPage(importPage, `TODO ${task.title}`))
    if (block) {
      syncRecords[block.uuid] = syncRecord(task, task.status === 2 ? 2 : 0)
      importedFromTickTick += 1
    }
  }

  await saveSyncRecords(syncRecords)
  return { localTaskCount: localBlocks.length, createdInTickTick, importedFromTickTick, migratedMappings, completedInTickTick }
}
