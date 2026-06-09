import { ipcMain } from 'electron'
import { getSettings, updateSettings } from '../settings'
import type { Settings } from '../../shared/ipc-types'

export function registerSettingsIpc(): void {
  ipcMain.handle('settings:get', async (): Promise<Settings> => getSettings())

  ipcMain.handle(
    'settings:set',
    async (_e, patch: Partial<Settings>): Promise<Settings> => updateSettings(patch)
  )
}
