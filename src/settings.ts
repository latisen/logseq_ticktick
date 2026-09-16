import '@logseq/libs'
import { SettingSchemaDesc } from '@logseq/libs/dist/LSPlugin'

export const settingsSchema: SettingSchemaDesc[] = [
  {
    key: 'ticktickHeading',
    type: 'heading',
    title: '1. TickTick app credentials',
    description:
      'Create an app at https://developer.ticktick.com/manage to get a Client ID/Secret. ' +
      'Set its redirect URI to match the value below (it does not need to point to a real server).',
    default: null,
  },
  {
    key: 'clientId',
    type: 'string',
    title: 'Client ID',
    description: 'TickTick OAuth Client ID.',
    default: '',
  },
  {
    key: 'clientSecret',
    type: 'string',
    title: 'Client Secret',
    description: 'TickTick OAuth Client Secret.',
    default: '',
  },
  {
    key: 'redirectUri',
    type: 'string',
    title: 'Redirect URI',
    description: 'Must exactly match the redirect URI configured on developer.ticktick.com.',
    default: 'http://localhost:8080/callback',
  },
  {
    key: 'authHeading',
    type: 'heading',
    title: '2. Connect your account',
    description:
      'Run "TickTick: 1. Open authorization page" from the command palette, approve access, then ' +
      'copy the "code" query parameter from the address bar of the page you get redirected to and paste it below. ' +
      'Then run "TickTick: 2. Exchange authorization code".',
    default: null,
  },
  {
    key: 'authCode',
    type: 'string',
    title: 'Authorization code (paste here)',
    description: 'Temporary value, cleared automatically after the token exchange succeeds.',
    default: '',
  },
  {
    key: 'accessToken',
    type: 'string',
    title: 'Access token (auto-filled)',
    description: 'Do not edit manually.',
    default: '',
  },
  {
    key: 'refreshToken',
    type: 'string',
    title: 'Refresh token (auto-filled)',
    description: 'Do not edit manually.',
    default: '',
  },
  {
    key: 'syncHeading',
    type: 'heading',
    title: '3. Sync settings',
    description: '',
    default: null,
  },
  {
    key: 'projectId',
    type: 'string',
    title: 'TickTick project (list) ID',
    description:
      'Run "TickTick: List projects" from the command palette to see IDs, then paste the one to sync with here.',
    default: '',
  },
  {
    key: 'targetPage',
    type: 'string',
    title: 'Logseq sync page',
    description: 'Top-level TODO/DOING/DONE blocks on this page are synced with the TickTick project above.',
    default: 'ticktick',
  },
  {
    key: 'pollIntervalSec',
    type: 'number',
    title: 'Auto-sync interval (seconds)',
    description: 'How often to poll TickTick for changes. Set to 0 to disable automatic polling.',
    default: 120,
  },
  {
    key: 'autoSync',
    type: 'boolean',
    title: 'Sync automatically on graph changes',
    description: 'Also trigger a sync shortly after you edit blocks on the sync page.',
    default: true,
  },
]
