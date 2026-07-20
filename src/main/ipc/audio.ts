// IPC for the Audio panel: catalog fetch (music settings / song slots / SFX
// names over the built ROM), .spc synthesis for the renderer's SPC player,
// sequence/SFX timeline decoding for the inspector tabs, and the fixed
// per-project export folder (Export tab — YY-CHR-tab model: export-all,
// base-aware sample import, song import, browse what's on disk, open
// folder; no dialogs). All logic — including the result envelopes — lives
// in src/main/audio.ts; this layer is channel registration only.

import { ipcMain, shell } from 'electron'
import {
  composeRowSpc,
  composeSfxSpc,
  composeSongSpc,
  decodeSfxTimeline,
  decodeSongTimeline,
  deleteSong,
  exportAllAudio,
  getAudioAramUsage,
  getAudioCatalog,
  getAudioExportState,
  getSongImportState,
  importSamples,
  importSong,
  openAudioExportFolder,
  previewSongImport,
  readExportedSpc,
  restoreSong,
  revertSongImport
} from '../audio'
import type {
  AudioAramUsageResult,
  AudioCatalogResult,
  AudioComposeSpcResult,
  AudioDecodeSongResult,
  AudioExportRunResult,
  AudioExportStateResult,
  AudioImportResult,
  AudioSongImportPreviewResult,
  AudioSongImportRunResult,
  AudioSongImportStateResult
} from '../../shared/ipc-types'

export function registerAudioIpc(): void {
  ipcMain.handle('audio:catalog', async (): Promise<AudioCatalogResult> => getAudioCatalog())

  ipcMain.handle('audio:aramUsage', async (): Promise<AudioAramUsageResult> => getAudioAramUsage())

  ipcMain.handle(
    'audio:composeSongSpc',
    async (_e, setting: number, songSlotId: number): Promise<AudioComposeSpcResult> =>
      composeSongSpc(setting, songSlotId)
  )

  ipcMain.handle(
    'audio:composeRowSpc',
    async (_e, blockIds: number[], songSlotId: number): Promise<AudioComposeSpcResult> =>
      composeRowSpc(blockIds, songSlotId)
  )

  ipcMain.handle(
    'audio:decodeSong',
    async (_e, setting: number, songSlotId: number): Promise<AudioDecodeSongResult> =>
      decodeSongTimeline(setting, songSlotId)
  )

  ipcMain.handle('audio:decodeSfx', async (_e, id: number): Promise<AudioDecodeSongResult> => decodeSfxTimeline(id))

  ipcMain.handle('audio:composeSfxSpc', async (_e, id: number): Promise<AudioComposeSpcResult> => composeSfxSpc(id))

  ipcMain.handle('audio:exportState', async (): Promise<AudioExportStateResult> => getAudioExportState())

  ipcMain.handle('audio:exportAll', async (): Promise<AudioExportRunResult> => exportAllAudio())

  ipcMain.handle('audio:importSamples', async (): Promise<AudioImportResult> => importSamples())

  ipcMain.handle(
    'audio:readExportedSpc',
    async (_e, rel: string): Promise<AudioComposeSpcResult> => readExportedSpc(rel)
  )

  ipcMain.handle('audio:openExportFolder', async (): Promise<void> => {
    const dir = openAudioExportFolder()
    if (dir) await shell.openPath(dir)
  })

  ipcMain.handle(
    'audio:songImportState',
    async (_e, downsampleToFit?: boolean, dropStaccatoToFit?: boolean, useSmwSamples?: boolean, noEcho?: boolean): Promise<AudioSongImportStateResult> =>
      getSongImportState(downsampleToFit, dropStaccatoToFit, useSmwSamples, noEcho)
  )

  ipcMain.handle(
    'audio:previewSongImport',
    async (_e, rel: string, sourceSlot: number, targetBlockId: number, downsampleToFit?: boolean, dropStaccatoToFit?: boolean, useSmwSamples?: boolean, noEcho?: boolean, targetSlotId?: number | null): Promise<AudioSongImportPreviewResult> =>
      previewSongImport(rel, sourceSlot, targetBlockId, downsampleToFit, dropStaccatoToFit, useSmwSamples, noEcho, targetSlotId ?? null)
  )

  ipcMain.handle(
    'audio:importSong',
    async (_e, rel: string, sourceSlot: number, targetBlockId: number, downsampleToFit?: boolean, dropStaccatoToFit?: boolean, useSmwSamples?: boolean, noEcho?: boolean, targetSlotId?: number | null): Promise<AudioSongImportRunResult> =>
      importSong(rel, sourceSlot, targetBlockId, downsampleToFit, dropStaccatoToFit, useSmwSamples, noEcho, targetSlotId ?? null)
  )

  ipcMain.handle(
    'audio:revertSongImport',
    async (_e, targetBlockId: number): Promise<AudioSongImportRunResult> => revertSongImport(targetBlockId)
  )

  ipcMain.handle(
    'audio:deleteSong',
    async (_e, targetBlockId: number, slot: number): Promise<AudioSongImportRunResult> => deleteSong(targetBlockId, slot)
  )

  ipcMain.handle(
    'audio:restoreSong',
    async (_e, targetBlockId: number, slot: number): Promise<AudioSongImportRunResult> => restoreSong(targetBlockId, slot)
  )
}
