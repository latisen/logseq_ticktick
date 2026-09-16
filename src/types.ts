export interface PluginSettings {
  apiKey: string
  projectId: string
  targetPage: string
  pollIntervalSec: number
  autoSync: boolean
}

// Marker used by Logseq for a finished/cancelled task.
export const DONE_MARKERS = new Set(['DONE', 'CANCELED', 'CANCELLED'])
// Markers that identify a block as an actionable task.
export const TASK_MARKERS = new Set(['TODO', 'DOING', 'NOW', 'LATER', 'DONE', 'CANCELED', 'CANCELLED'])

export interface TickTickTask {
  id: string
  projectId: string
  title: string
  status?: number // 0 = open, 2 = completed
  content?: string
  isAllDay?: boolean
  dueDate?: string
  [key: string]: unknown
}

export interface TickTickProjectData {
  project: { id: string; name: string }
  tasks: TickTickTask[]
}

// Bookkeeping block properties written by this plugin, kept out of the visible content.
export const PROP_ID = 'ticktick-id'
export const PROP_PROJECT = 'ticktick-project'
export const PROP_STATUS = 'ticktick-status'
export const PROP_TITLE = 'ticktick-title'
