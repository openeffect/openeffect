import { useState } from 'react'
import { AnimatePresence, motion, LayoutGroup } from 'framer-motion'
import { Header } from './Header'
import { EffectGallery } from '@/features/effects/EffectGallery'
import { EffectPanel } from '@/features/effects/EffectPanel'
import { GenerationView } from '@/features/generation/GenerationView'
import { SettingsDialog } from '@/features/settings/SettingsDialog'
import { EffectsManagerDialog } from '@/features/settings/EffectsManagerDialog'
import { OnboardingDialog } from '@/features/settings/OnboardingDialog'
import { useGenerationStore } from '@/store/generationStore'
import { useSelectedEffect } from '@/store/effectsStore'
import { useConfigStore } from '@/store/configStore'
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
  const viewingJobId = useGenerationStore((s) => s.viewingJobId)
  const activeJobs = useGenerationStore((s) => s.activeJobs)
  const selectedEffect = useSelectedEffect()
  const showOnboarding = useConfigStore((s) => s.showOnboarding)

  useSse(viewingJobId)

  const rightOpen = !!selectedEffect
  const showGeneration = viewingJobId && activeJobs.has(viewingJobId)

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
              {showGeneration ? (
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
              ) : (
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
            {selectedEffect && (
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
