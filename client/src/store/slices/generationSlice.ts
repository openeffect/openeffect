import type { GenerationSlice } from '../types'

export const initialGenerationState: GenerationSlice = {
  jobs: new Map(),
  viewingJobId: null,
  leftPanel: 'gallery',
  restoredParams: null,
  restoringFromUrl: false,
}
