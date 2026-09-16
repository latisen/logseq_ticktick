import '@logseq/libs'
import { BlockEntity } from '@logseq/libs/dist/LSPlugin'
import * as ticktick from './ticktick'
import { DONE_MARKERS, PROP_ID, PROP_PROJECT, PROP_STATUS, PluginSettings, TASK_MARKERS } from './types'

function getSettings(): PluginSettings {
  return logseq.settings as unknown as PluginSettings
}

function isDoneMarker(marker?: string | null): boolean {
  return !!marker && DONE_MARKERS.has(marker.toUpperCase())
}

// First line of block content, with a leading task marker (if any) stripped off.
function titleFromContent(content: string, marker?: string | null): string {
  const firstLine = content.split('\n')[0]
  if (marker) {
    return firstLine.replace(new RegExp(`^${marker}\\s*`, 'i'), '').trim()
  }
  return firstLine.replace(/^(TODO|DOING|NOW|LATER|DONE|CANCELED|CANCELLED)\s*/i, '').trim()
}

async function getLocalTaskBlocks(pageName: string): Promise<BlockEntity[]> {
  const blocks = await logseq.Editor.getPageBlocksTree(pageName)
  if (!blocks) return []
  return blocks.filter((b) => b.marker && TASK_MARKERS.has(b.marker.toUpperCase()))
}

async function markBlockDone(block: BlockEntity): Promise<void> {
  const content = block.content || ''
  const firstLine = content.split('\n')[0]
  const rest = content.slice(firstLine.length)
  const newFirstLine = block.marker
    ? firstLine.replace(new RegExp(`^${block.marker}`, 'i'), 'DONE')
    : `DONE ${firstLine}`
  await logseq.Editor.updateBlock(block.uuid, `${newFirstLine}${rest}`)
}

async function ensureSyncPageExists(pageName: string): Promise<void> {
  const page = await logseq.Editor.getPage(pageName)
  if (!page) {
    await logseq.Editor.createPage(pageName, {}, { redirect: false, createFirstBlock: false })
  }
}

export async function runSync(): Promise<void> {
  const settings = getSettings()
  if (!settings.accessToken || !settings.projectId) {
    console.warn('[ticktick-sync] Skipping sync: not connected or no project configured.')
    return
  }

  const pageName = settings.targetPage || 'ticktick'
  await ensureSyncPageExists(pageName)

  const localBlocks = await getLocalTaskBlocks(pageName)
  const localByTtId = new Map<string, BlockEntity>()
  for (const block of localBlocks) {
    const ttId = await logseq.Editor.getBlockProperty(block.uuid, PROP_ID)
    if (ttId) localByTtId.set(String(ttId), block)
  }

  const projectData = await ticktick.getProjectData(settings.projectId)
  const remoteOpenTasks = projectData.tasks || []
  const remoteById = new Map(remoteOpenTasks.map((t) => [t.id, t]))

  // 1) New local tasks -> create in TickTick.
  for (const block of localBlocks) {
    const existingId = await logseq.Editor.getBlockProperty(block.uuid, PROP_ID)
    if (existingId) continue

    const title = titleFromContent(block.content || '', block.marker)
    if (!title) continue

    const done = isDoneMarker(block.marker)
    const created = await ticktick.createTask({ title, projectId: settings.projectId })
    await logseq.Editor.upsertBlockProperty(block.uuid, PROP_ID, created.id)
    await logseq.Editor.upsertBlockProperty(block.uuid, PROP_PROJECT, settings.projectId)
    await logseq.Editor.upsertBlockProperty(block.uuid, PROP_STATUS, done ? 2 : 0)
    if (done) {
      await ticktick.completeTask(settings.projectId, created.id)
    }
    localByTtId.set(created.id, block)
  }

  // 2) Local completions -> complete in TickTick.
  for (const [ttId, block] of localByTtId) {
    const storedStatus = Number((await logseq.Editor.getBlockProperty(block.uuid, PROP_STATUS)) ?? 0)
    if (storedStatus === 2) continue
    if (!isDoneMarker(block.marker)) continue

    await ticktick.completeTask(settings.projectId, ttId)
    await logseq.Editor.upsertBlockProperty(block.uuid, PROP_STATUS, 2)
  }

  // 3) New TickTick tasks -> create local blocks.
  for (const task of remoteOpenTasks) {
    if (localByTtId.has(task.id)) continue

    const newBlock = await logseq.Editor.appendBlockInPage(pageName, `TODO ${task.title}`)
    if (!newBlock) continue
    await logseq.Editor.upsertBlockProperty(newBlock.uuid, PROP_ID, task.id)
    await logseq.Editor.upsertBlockProperty(newBlock.uuid, PROP_PROJECT, settings.projectId)
    await logseq.Editor.upsertBlockProperty(newBlock.uuid, PROP_STATUS, 0)
  }

  // 4) TickTick completions -> mark local blocks DONE.
  // Completed tasks are excluded from the project "open tasks" list, so anything
  // we know about locally as still-open but missing from that list needs to be
  // double-checked directly (it may just have been completed on the TickTick side).
  for (const [ttId, block] of localByTtId) {
    if (remoteById.has(ttId)) continue
    if (isDoneMarker(block.marker)) continue

    const storedStatus = Number((await logseq.Editor.getBlockProperty(block.uuid, PROP_STATUS)) ?? 0)
    if (storedStatus === 2) continue

    try {
      const remoteTask = await ticktick.getTask(settings.projectId, ttId)
      if (remoteTask.status === 2) {
        await markBlockDone(block)
        await logseq.Editor.upsertBlockProperty(block.uuid, PROP_STATUS, 2)
      }
    } catch (e) {
      // Task no longer exists on TickTick (e.g. deleted) - leave the local block as-is.
      console.warn(`[ticktick-sync] Could not verify TickTick task ${ttId}:`, e)
    }
  }
}
