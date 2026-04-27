import type { FormCarrySlice } from '../types'

export const initialFormCarryState: FormCarrySlice = {
  lastImagesByRole: {},
  lastInputsByName: {},
  lastModelParams: {},
  lastModelId: null,
  lastPlaygroundPrompt: '',
  lastPlaygroundNegativePrompt: '',
}
