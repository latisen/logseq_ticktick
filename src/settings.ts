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
    title: 'Default TickTick project (list) ID',
    description:
      'New Logseq tasks are created here. Leave empty to create them in Inbox. Existing tasks sync with their own TickTick project.',
    default: '',
  },
  {
    key: 'targetPage',
    type: 'string',
    title: 'Page for new TickTick tasks',
    description: 'New tasks created in TickTick are appended to this Logseq page. All existing task blocks in the vault are synced.',
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
