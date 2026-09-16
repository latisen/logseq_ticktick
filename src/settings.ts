import '@logseq/libs'
import { SettingSchemaDesc } from '@logseq/libs/dist/LSPlugin'

export const settingsSchema: SettingSchemaDesc[] = [
  {
    key: 'ticktickApiHeading',
    type: 'heading',
    title: '1. TickTick API key',
    description:
      'Create or copy your personal API key from https://developer.ticktick.com/manage.',
    default: null,
  },
  {
    key: 'apiKey',
    type: 'string',
    title: 'API key',
    description: 'Stored locally in this graph\'s plugin settings and sent as a Bearer token to TickTick.',
    default: '',
  },
  {
    key: 'syncHeading',
    type: 'heading',
    title: '2. Sync settings',
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
