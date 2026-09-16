import '@logseq/libs'
import { PluginSettings, TickTickProjectData, TickTickTask } from './types'

// NOTE: endpoints follow the TickTick Open API as documented at
// https://developer.ticktick.com/api#/openapi?id=api-reference
// Verify against the live docs if TickTick changes their API.
const API_BASE = 'https://api.ticktick.com/open/v1'

function getSettings(): PluginSettings {
  return logseq.settings as unknown as PluginSettings
}

async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const settings = getSettings()
  if (!settings.apiKey) {
    throw new Error('Add your TickTick API key in the plugin settings first.')
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${settings.apiKey}`,
      'Content-Type': 'application/json',
    },
  })

  return res
}

async function authedJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await authedFetch(path, init)
  if (!res.ok) {
    throw new Error(`TickTick API error ${res.status} on ${path}: ${await res.text()}`)
  }
  // Some endpoints (complete/delete) return an empty body.
  const text = await res.text()
  return (text ? JSON.parse(text) : {}) as T
}

export async function listProjects(): Promise<Array<{ id: string; name: string }>> {
  return authedJson('/project')
}

export async function getProjectData(projectId: string): Promise<TickTickProjectData> {
  return authedJson(`/project/${projectId}/data`)
}

export async function getTask(projectId: string, taskId: string): Promise<TickTickTask> {
  return authedJson(`/project/${projectId}/task/${taskId}`)
}

export async function createTask(task: Partial<TickTickTask>): Promise<TickTickTask> {
  return authedJson('/task', { method: 'POST', body: JSON.stringify(task) })
}

export async function completeTask(projectId: string, taskId: string): Promise<void> {
  await authedJson(`/project/${projectId}/task/${taskId}/complete`, { method: 'POST' })
}
