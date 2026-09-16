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

export interface SyncRecord {
  taskId: string
  projectId: string
  projectName: string
  title: string
  status: number
  // Due date cached as epoch milliseconds (or null when unset) for comparisons.
  dueDate: number | null
}

export interface SyncResult {
  localTaskCount: number
  createdInTickTick: number
  importedFromTickTick: number
  migratedMappings: number
  completedInTickTick: number
  completedInLogseq: number
  completionCandidates: number
  alreadyCompleted: number
  movedListInTickTick: number
  movedListInLogseq: number
  dueDateUpdatedInTickTick: number
  dueDateUpdatedInLogseq: number
}
