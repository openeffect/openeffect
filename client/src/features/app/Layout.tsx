import { useState } from 'react'
import { AnimatePresence, motion, LayoutGroup } from 'framer-motion'
import { Header } from './Header'
import { EffectGallery } from '@/features/effects/EffectGallery'
import { EffectPanel } from '@/features/effects/EffectPanel'
import { EffectEditor } from '@/features/editor/EffectEditor'
import { RunView } from '@/features/run/RunView'
import { PlaygroundPanel } from '@/features/playground/PlaygroundPanel'
import { SettingsDialog } from '@/features/settings/SettingsDialog'
import { EffectsManagerDialog } from '@/features/settings/EffectsManagerDialog'
import { OnboardingDialog } from '@/features/settings/OnboardingDialog'
import { useStore } from '@/store'
import { selectSelectedId } from '@/store/selectors/effectsSelectors'
import { selectViewingJobId, selectJobs, selectViewingRunRecord } from '@/store/selectors/runSelectors'
import { selectEditorIsOpen } from '@/store/selectors/editorSelectors'
import { selectShowOnboarding } from '@/store/selectors/configSelectors'
import { selectPlaygroundIsOpen } from '@/store/selectors/playgroundSelectors'
import { useSse } from '@/hooks/useSse'

const PANEL_WIDTH_PERCENT = 35
const SLIDE_DURATION = 0.3
const SLIDE_EASE: [number, number, number, number] = [0.25, 1, 0.5, 1]

const panelVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.2, ease: 'easeOut' as const } },
  exit: { opacity: 0, transition: { duration: 0.1 } },
}

export function Layout() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [effectsOpen, setEffectsOpen] = useState(false)
  const viewingJobId = useStore(selectViewingJobId)
  const viewingRunRecord = useStore(selectViewingRunRecord)
  const activeJobs = useStore(selectJobs)
  const selectedId = useStore(selectSelectedId)
  const showOnboarding = useStore(selectShowOnboarding)
  const isEditorOpen = useStore(selectEditorIsOpen)
  const isPlaygroundOpen = useStore(selectPlaygroundIsOpen)

  useSse(viewingJobId)

  const rightOpen = !!selectedId || isEditorOpen || isPlaygroundOpen
  const activeJob = viewingJobId ? activeJobs.get(viewingJobId) : null
  const showRun = !!(viewingRunRecord || activeJob)

  // Left panel priority: run > editor > gallery. Playground keeps the gallery
  // visible behind its right-side panel, same as opening an effect.
  const leftPanelKey = showRun ? 'run' : isEditorOpen ? 'editor' : 'gallery'

  return (
    <div className="flex h-screen flex-col bg-background">
      <Header onEffectsOpen={() => setEffectsOpen(true)} onSettingsOpen={() => setSettingsOpen(true)} />

      <LayoutGroup>
        <div className="relative flex flex-1 overflow-hidden">
          {/* Left panel */}
          <motion.div
            layout
            className="flex-1 overflow-hidden"
            animate={{ marginRight: rightOpen ? `${PANEL_WIDTH_PERCENT}%` : 0 }}
            transition={{ duration: SLIDE_DURATION, ease: SLIDE_EASE }}
          >
            <AnimatePresence mode="popLayout">
              {leftPanelKey === 'run' && (
                <motion.div
                  key="run"
                  variants={panelVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className="h-full"
                >
                  <RunView />
                </motion.div>
              )}
              {leftPanelKey === 'editor' && (
                <motion.div
                  key="editor"
                  variants={panelVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className="h-full"
                >
                  <EffectEditor />
                </motion.div>
              )}
              {leftPanelKey === 'gallery' && (
                <motion.div
                  key="gallery"
                  variants={panelVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className="h-full"
                >
                  <EffectGallery />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          {/* Right: Effect or Playground settings panel */}
          <AnimatePresence>
            {rightOpen && (
              <motion.div
                initial={{ x: '100%' }}
                animate={{ x: 0, transition: { duration: SLIDE_DURATION, ease: SLIDE_EASE } }}
                exit={{ x: '100%', transition: { duration: SLIDE_DURATION, ease: SLIDE_EASE } }}
                className="absolute inset-y-0 right-0 overflow-y-auto border-l bg-card shadow-[-4px_0_24px_rgba(0,0,0,0.1)]"
                style={{ width: `${PANEL_WIDTH_PERCENT}%` }}
              >
                {isPlaygroundOpen ? <PlaygroundPanel /> : <EffectPanel />}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </LayoutGroup>

      <SettingsDialog isOpen={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <EffectsManagerDialog isOpen={effectsOpen} onClose={() => setEffectsOpen(false)} />
      {showOnboarding && <OnboardingDialog />}
    </div>
  )
}
