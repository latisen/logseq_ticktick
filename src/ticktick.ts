import '@logseq/libs'
import { PluginSettings, TickTickProjectData, TickTickTask } from './types'

// NOTE: endpoints follow the TickTick Open API as documented at
// https://developer.ticktick.com/api#/openapi?id=api-reference
// Verify against the live docs if TickTick changes their API.
const API_BASE = 'https://api.ticktick.com/open/v1'
const OAUTH_BASE = 'https://ticktick.com/oauth'
const SCOPE = 'tasks:write tasks:read'

function getSettings(): PluginSettings {
  return logseq.settings as unknown as PluginSettings
}

export function buildAuthorizeUrl(state: string): string {
  const { clientId, redirectUri } = getSettings()
  const params = new URLSearchParams({
    scope: SCOPE,
    client_id: clientId,
    state,
    redirect_uri: redirectUri,
    response_type: 'code',
  })
  return `${OAUTH_BASE}/authorize?${params.toString()}`
}

async function requestToken(body: Record<string, string>): Promise<{
  access_token: string
  refresh_token?: string
}> {
  const { clientId, clientSecret } = getSettings()
  const basicAuth = btoa(`${clientId}:${clientSecret}`)
  const res = await fetch(`${OAUTH_BASE}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basicAuth}`,
    },
    body: new URLSearchParams(body).toString(),
  })
  if (!res.ok) {
    throw new Error(`TickTick token request failed (${res.status}): ${await res.text()}`)
  }
  return res.json()
}

export async function exchangeCodeForToken(code: string) {
  const { redirectUri } = getSettings()
  return requestToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    scope: SCOPE,
  })
}

export async function refreshAccessToken(refreshToken: string) {
  return requestToken({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: SCOPE,
  })
}

async function authedFetch(path: string, init: RequestInit = {}, retried = false): Promise<Response> {
  const settings = getSettings()
  if (!settings.accessToken) {
    throw new Error('Not connected to TickTick yet. Run the "TickTick: 1. Open authorization page" command first.')
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${settings.accessToken}`,
      'Content-Type': 'application/json',
    },
  })

  if (res.status === 401 && !retried && settings.refreshToken) {
    const tokens = await refreshAccessToken(settings.refreshToken)
    await logseq.updateSettings({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || settings.refreshToken,
    })
    return authedFetch(path, init, true)
  }

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
