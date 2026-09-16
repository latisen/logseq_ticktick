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

function isDoneMarker(marker?: string | null): boolean {
  return !!marker && DONE_MARKERS.has(marker.toUpperCase())
}

function statusFromContent(content?: string): string | null {
  const match = content?.match(/(?:^|\s)Status::\s*(Todo|Doing|Now|Later|Done|Canceled|Cancelled)\s*$/i)
  return match?.[1]?.toUpperCase() || null
}

function statusFromProperties(block: BlockEntity): string | null {
  const value = block.properties?.status ?? block.properties?.Status
  if (typeof value === 'string') return value.toUpperCase()
  if (value && typeof value === 'object' && 'name' in value && typeof value.name === 'string') {
    return value.name.toUpperCase()
  }
  return null
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
  const content = block.content || ''
  const firstLine = content.split('\n')[0]
  const rest = content.slice(firstLine.length)
  const statusProperty = firstLine.match(/(\s+Status::\s*\w+\s*)$/i)?.[1] || ''
  return block.marker ? `${block.marker} ${title}${rest}` : `${title}${statusProperty}${rest}`
}

async function getAllLocalTaskBlocks(): Promise<BlockEntity[]> {
  const result = await logseq.DB.datascriptQuery<Array<[BlockEntity]>>(`
    [:find (pull ?block [*])
     :where
     [?block :block/content ?content]]
  `)
  return result.map(([block]) => block).filter(isTaskBlock)
}

async function markBlockDone(block: BlockEntity): Promise<void> {
  const content = block.content || ''
  if (statusFromProperties(block)) {
    await logseq.Editor.upsertBlockProperty(block.uuid, 'status', 'Done')
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
  const projects = await ticktick.listProjects()
  const projectData = await Promise.all(projects.map((project) => ticktick.getProjectData(project.id)))
  return new Map(projectData.flatMap((project) => project.tasks || []).map((task) => [task.id, task]))
}

async function setSyncState(blockUuid: string, task: TickTickTask, status: number): Promise<void> {
  await logseq.Editor.upsertBlockProperty(blockUuid, PROP_ID, task.id)
  await logseq.Editor.upsertBlockProperty(blockUuid, PROP_PROJECT, task.projectId)
  await logseq.Editor.upsertBlockProperty(blockUuid, PROP_TITLE, task.title)
  await logseq.Editor.upsertBlockProperty(blockUuid, PROP_STATUS, status)
}

export async function runSync(): Promise<number> {
  const settings = getSettings()
  if (!settings.apiKey) {
    console.warn('[ticktick-sync] Skipping sync: no API key configured.')
    return 0
  }

  const importPage = settings.targetPage || 'ticktick'
  const localBlocks = await getAllLocalTaskBlocks()
  const remoteById = await getRemoteTasks()
  const localByTaskId = new Map<string, BlockEntity>()

  for (const block of localBlocks) {
    const taskId = await logseq.Editor.getBlockProperty(block.uuid, PROP_ID)
    if (taskId) localByTaskId.set(String(taskId), block)
  }

  // New vault tasks are created in the configured default project or TickTick Inbox.
  for (const block of localBlocks) {
    if (await logseq.Editor.getBlockProperty(block.uuid, PROP_ID)) continue
    const title = titleFromContent(block.content || '', block.marker)
    if (!title) continue

    const task = await ticktick.createTask({
      title,
      ...(settings.projectId ? { projectId: settings.projectId } : {}),
    })
    const done = isBlockDone(block)
    if (done) await ticktick.completeTask(task.projectId, task.id)
    await setSyncState(block.uuid, task, done ? 2 : 0)
    localByTaskId.set(task.id, block)
  }

  // Existing mappings carry title and completion changes in either direction.
  // A simultaneous title conflict resolves to the Logseq version.
  for (const [taskId, block] of localByTaskId) {
    const projectId = String((await logseq.Editor.getBlockProperty(block.uuid, PROP_PROJECT)) || '')
    if (!projectId) continue

    const localTitle = titleFromContent(block.content || '', block.marker)
    const storedTitle = String((await logseq.Editor.getBlockProperty(block.uuid, PROP_TITLE)) || '')
    const storedStatus = Number((await logseq.Editor.getBlockProperty(block.uuid, PROP_STATUS)) ?? 0)
    const localStatus = isBlockDone(block) ? 2 : 0
    const remote = remoteById.get(taskId)

    if (!remote) {
      if (storedStatus !== 2 && localStatus !== 2) {
        try {
          const task = await ticktick.getTask(projectId, taskId)
          if (task.status === 2) {
            await markBlockDone(block)
            await logseq.Editor.upsertBlockProperty(block.uuid, PROP_STATUS, 2)
          }
        } catch (e) {
          console.warn(`[ticktick-sync] Could not load TickTick task ${taskId}:`, e)
        }
      }
      continue
    }

    if (localTitle !== storedTitle && localTitle !== remote.title) {
      await ticktick.updateTask(taskId, { title: localTitle, projectId })
      await logseq.Editor.upsertBlockProperty(block.uuid, PROP_TITLE, localTitle)
    } else if (remote.title !== storedTitle && remote.title !== localTitle) {
      await logseq.Editor.updateBlock(block.uuid, contentWithTitle(block, remote.title))
      await logseq.Editor.upsertBlockProperty(block.uuid, PROP_TITLE, remote.title)
    }

    if (localStatus === 2 && storedStatus !== 2) {
      await ticktick.completeTask(projectId, taskId)
      await logseq.Editor.upsertBlockProperty(block.uuid, PROP_STATUS, 2)
    }
  }

  // New TickTick tasks cannot retain a Logseq location, so they are appended to one import page.
  for (const task of remoteById.values()) {
    if (localByTaskId.has(task.id)) continue
    const block = await logseq.Editor.appendBlockInPage(importPage, `TODO ${task.title}`)
    if (block) await setSyncState(block.uuid, task, task.status === 2 ? 2 : 0)
  }

  return localBlocks.length
}
