import '@logseq/libs'
import { BlockEntity } from '@logseq/libs/dist/LSPlugin'
import * as ticktick from './ticktick'
import {
  DONE_MARKERS,
  PROP_ID,
  PROP_PROJECT,
  PROP_STATUS,
  PROP_TITLE,
  PluginSettings,
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

async function getSyncProperty(block: BlockEntity, property: string) {
  return syncStep(
    `Logseq could not read property "${property}" for task "${taskLabel(block)}"`,
    () => logseq.Editor.getBlockProperty(block.uuid, property),
  )
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
    block['logseq.property/status'] ?? block['logseq.task/status']
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
  const content = block.content || ''
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

async function getRemoteTasks(): Promise<Map<string, TickTickTask>> {
  const projects = await syncStep('TickTick could not list projects', () => ticktick.listProjects())
  const projectData = await Promise.all(projects.map((project) => syncStep(
    `TickTick could not read project "${project.name}" (${project.id})`,
    () => ticktick.getProjectData(project.id),
  )))
  return new Map(projectData.flatMap((project) => project.tasks || []).map((task) => [task.id, task]))
}

function syncProperties(task: TickTickTask, status: number) {
  return {
    [PROP_ID]: task.id,
    [PROP_PROJECT]: task.projectId,
    [PROP_TITLE]: task.title,
    [PROP_STATUS]: status,
  }
}

async function setSyncState(block: BlockEntity, task: TickTickTask, status: number): Promise<void> {
  await syncStep(
    `Logseq could not save the TickTick link for task "${taskLabel(block)}"`,
    () => logseq.Editor.updateBlock(block.uuid, block.content || block.title, {
      properties: syncProperties(task, status),
    }),
  )
}

export async function runSync(): Promise<number> {
  const settings = getSettings()
  if (!settings.apiKey) {
    console.warn('[ticktick-sync] Skipping sync: no API key configured.')
    return 0
  }

  const importPage = settings.targetPage || 'ticktick'
  const localBlocks = await syncStep('Logseq could not query task blocks in this graph', getAllLocalTaskBlocks)
  const remoteById = await getRemoteTasks()
  const localByTaskId = new Map<string, BlockEntity>()

  for (const block of localBlocks) {
    const taskId = await getSyncProperty(block, PROP_ID)
    if (taskId) localByTaskId.set(String(taskId), block)
  }

  // New vault tasks are created in the configured default project or TickTick Inbox.
  for (const block of localBlocks) {
    if (await getSyncProperty(block, PROP_ID)) continue
    const title = titleFromContent(blockText(block), block.marker)
    if (!title) continue

    const task = await syncStep(
      `TickTick could not create task "${title}"`,
      () => ticktick.createTask({ title, ...(settings.projectId ? { projectId: settings.projectId } : {}) }),
    )
    const done = isBlockDone(block)
    if (done) await syncStep(`TickTick could not complete newly created task "${title}"`, () =>
      ticktick.completeTask(task.projectId, task.id))
    await setSyncState(block, task, done ? 2 : 0)
    localByTaskId.set(task.id, block)
  }

  // Existing mappings carry title and completion changes in either direction.
  // A simultaneous title conflict resolves to the Logseq version.
  for (const [taskId, block] of localByTaskId) {
    const projectId = String((await getSyncProperty(block, PROP_PROJECT)) || '')
    if (!projectId) continue

    const localTitle = titleFromContent(blockText(block), block.marker)
    const storedTitle = String((await getSyncProperty(block, PROP_TITLE)) || '')
    const storedStatus = Number((await getSyncProperty(block, PROP_STATUS)) ?? 0)
    const localStatus = isBlockDone(block) ? 2 : 0
    const remote = remoteById.get(taskId)

    if (!remote) {
      if (storedStatus !== 2 && localStatus !== 2) {
        try {
          const task = await ticktick.getTask(projectId, taskId)
          if (task.status === 2) {
            await syncStep(`Logseq could not mark task "${taskLabel(block)}" as done`, () => markBlockDone(block))
            await syncStep(`Logseq could not save completion state for task "${taskLabel(block)}"`, () =>
              logseq.Editor.upsertBlockProperty(block.uuid, PROP_STATUS, 2))
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
      await syncStep(`Logseq could not save title state for task "${taskLabel(block)}"`, () =>
        logseq.Editor.upsertBlockProperty(block.uuid, PROP_TITLE, localTitle))
    } else if (remote.title !== storedTitle && remote.title !== localTitle) {
      await syncStep(`Logseq could not update title for task "${taskLabel(block)}"`, () =>
        logseq.Editor.updateBlock(block.uuid, contentWithTitle(block, remote.title)))
      await syncStep(`Logseq could not save title state for task "${taskLabel(block)}"`, () =>
        logseq.Editor.upsertBlockProperty(block.uuid, PROP_TITLE, remote.title))
    }

    if (localStatus === 2 && storedStatus !== 2) {
      await syncStep(`TickTick could not complete task "${taskLabel(block)}"`, () =>
        ticktick.completeTask(projectId, taskId))
      await syncStep(`Logseq could not save completion state for task "${taskLabel(block)}"`, () =>
        logseq.Editor.upsertBlockProperty(block.uuid, PROP_STATUS, 2))
    }
  }

  // New TickTick tasks cannot retain a Logseq location, so they are appended to one import page.
  for (const task of remoteById.values()) {
    if (localByTaskId.has(task.id)) continue
    await syncStep(`Logseq could not import TickTick task "${task.title}" to page "${importPage}"`, () =>
      logseq.Editor.appendBlockInPage(importPage, `TODO ${task.title}`, {
        properties: syncProperties(task, task.status === 2 ? 2 : 0),
      }))
  }

  return localBlocks.length
}
