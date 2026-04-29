import { enableMapSet } from 'immer'
import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import { devtools } from 'zustand/middleware'
import type { AppState } from './types'
import { initialEffectsState } from './slices/effectsSlice'
import { initialRunState } from './slices/runSlice'
import { initialHistoryState } from './slices/historySlice'
import { initialConfigState } from './slices/configSlice'
import { initialEditorState } from './slices/editorSlice'
import { initialPlaygroundState } from './slices/playgroundSlice'
import { initialFormCarryState } from './slices/formCarrySlice'

// Enable Map/Set support for immer (must be called before store creation)
enableMapSet()

export const useStore = create<AppState>()(
  devtools(
    immer(() => ({
      effects: initialEffectsState,
      run: initialRunState,
      history: initialHistoryState,
      config: initialConfigState,
      editor: initialEditorState,
      playground: initialPlaygroundState,
      formCarry: initialFormCarryState,
    })),
    {
      name: 'OpenEffect',
      enabled: import.meta.env.DEV,
    },
  ),
)

// Used inside actions - wraps immer setState with an optional action name for DevTools
export const setState = (
  fn: (state: AppState) => void,
  actionName?: string,
) => useStore.setState(fn, false, actionName)

// Used inside actions to read state before deciding what to mutate
export const getState = (): AppState => useStore.getState()
