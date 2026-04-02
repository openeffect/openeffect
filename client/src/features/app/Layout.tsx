import { useState } from 'react'
import { AnimatePresence, motion, LayoutGroup } from 'framer-motion'
import { Header } from './Header'
import { EffectGallery } from '@/features/effects/EffectGallery'
import { EffectPanel } from '@/features/effects/EffectPanel'
import { EffectEditor } from '@/features/editor/EffectEditor'
import { GenerationView } from '@/features/generation/GenerationView'
import { SettingsDialog } from '@/features/settings/SettingsDialog'
import { EffectsManagerDialog } from '@/features/settings/EffectsManagerDialog'
import { OnboardingDialog } from '@/features/settings/OnboardingDialog'
import { useStore } from '@/store'
import { selectSelectedEffect } from '@/store/selectors/effectsSelectors'
import { selectViewingJobId, selectJobs } from '@/store/selectors/generationSelectors'
import { selectEditorIsOpen } from '@/store/selectors/editorSelectors'
import { selectShowOnboarding } from '@/store/selectors/configSelectors'
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
  const activeJobs = useStore(selectJobs)
  const selectedEffect = useStore(selectSelectedEffect)
  const showOnboarding = useStore(selectShowOnboarding)
  const isEditorOpen = useStore(selectEditorIsOpen)

  useSse(viewingJobId)

  const rightOpen = !!selectedEffect || isEditorOpen
  const showGeneration = viewingJobId && activeJobs.has(viewingJobId)

  // Left panel priority: generation > editor > gallery
  const leftPanelKey = showGeneration ? 'generation' : isEditorOpen ? 'editor' : 'gallery'

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
              {leftPanelKey === 'generation' && (
                <motion.div
                  key="generation"
                  variants={panelVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className="h-full"
                >
                  <GenerationView />
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

          {/* Right: Effect settings panel */}
          <AnimatePresence>
            {(selectedEffect || isEditorOpen) && (
              <motion.div
                initial={{ x: '100%' }}
                animate={{ x: 0, transition: { duration: SLIDE_DURATION, ease: SLIDE_EASE } }}
                exit={{ x: '100%', transition: { duration: SLIDE_DURATION, ease: SLIDE_EASE } }}
                className="absolute inset-y-0 right-0 overflow-y-auto border-l bg-card shadow-[-4px_0_24px_rgba(0,0,0,0.1)]"
                style={{ width: `${PANEL_WIDTH_PERCENT}%` }}
              >
                <EffectPanel />
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
