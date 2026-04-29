import { setState, getState } from '../index'
import { mutateCloseEditor } from '../mutations/editorMutations'
import { mutateSelectEffect } from '../mutations/effectsMutations'
import { mutateClearViewingJob } from '../mutations/runMutations'
import { loadConfig, initThemeListener } from './configActions'
import { navigate } from '@/utils/router'

/** Called once from App.tsx on mount. Initializes all app state. */
export async function initializeApp(): Promise<void> {
  initThemeListener()
  await loadConfig()
}

/**
 * Navigate home - close editor (with confirm), deselect effect, clear run.
 */
export function goHome(): void {
  const s = getState()
  if (s.editor.isOpen && s.editor.yamlContent !== s.editor.lastSavedYaml) {
    if (!window.confirm('You have unsaved changes. Discard them?')) return
  }
  setState((s) => {
    mutateCloseEditor(s)
    mutateSelectEffect(s, null)
    mutateClearViewingJob(s)
  }, 'app/goHome')
  navigate('/')
}
