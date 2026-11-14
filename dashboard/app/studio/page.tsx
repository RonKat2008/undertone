'use client';

import React, { useState, useEffect } from 'react';
import type { CoachSpec, HabitProfile } from '@/lib/bus/contracts';
import { useBus } from '@/lib/bus/use-bus';
import { activateCoach, saveCoach, buildCoach, buildPersonalCoach, getProfile } from '@/lib/api/client';
import { PromptHero } from '@/components/studio/PromptHero';
import { GeneratingProgress } from '@/components/studio/GeneratingProgress';
import { CoachSheet } from '@/components/studio/CoachSheet';
import { LibraryStrip } from '@/components/studio/LibraryStrip';
import {
  PREBUILT_INTERVIEW,
  PREBUILT_LISTENER,
  DEFAULT_HABIT_PROFILE,
  buildMockPersonalCoach,
  generateCustomCoachFromGoal
} from '@/components/studio/mock-data';

export default function StudioPage() {
  const { state, injectEvent } = useBus();

  const [prebuiltCoaches] = useState<CoachSpec[]>([PREBUILT_INTERVIEW, PREBUILT_LISTENER]);
  const [savedCoaches, setSavedCoaches] = useState<CoachSpec[]>([]);
  const [habitProfile, setHabitProfile] = useState<HabitProfile>(DEFAULT_HABIT_PROFILE);
  const [personalCoach, setPersonalCoach] = useState<CoachSpec>(() => buildMockPersonalCoach(DEFAULT_HABIT_PROFILE));
  const [selectedCoach, setSelectedCoach] = useState<CoachSpec>(() => state?.activeCoach || PREBUILT_INTERVIEW);
  const [prevActiveCoach, setPrevActiveCoach] = useState<CoachSpec | null>(() => state?.activeCoach || null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingGoal, setGeneratingGoal] = useState('');
  const [isLoadingPersonal, setIsLoadingPersonal] = useState(false);

  // Synchronize state during render when bus changes active coach externally
  if (state?.activeCoach && state.activeCoach !== prevActiveCoach) {
    setPrevActiveCoach(state.activeCoach);
    setSelectedCoach(state.activeCoach);
  }

  // Load habit profile on mount
  useEffect(() => {
    let mounted = true;
    getProfile()
      .then((prof) => {
        if (!mounted) return;
        // Merge with rich defaults if needed
        const merged: HabitProfile = {
          ...DEFAULT_HABIT_PROFILE,
          ...prof,
          crutch_words: prof.crutch_words?.length ? prof.crutch_words : DEFAULT_HABIT_PROFILE.crutch_words,
          recurring_issues: prof.recurring_issues?.length ? prof.recurring_issues : DEFAULT_HABIT_PROFILE.recurring_issues
        };
        setHabitProfile(merged);
        setPersonalCoach(buildMockPersonalCoach(merged));
      })
      .catch((err) => {
        console.error('Failed to load profile:', err);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const handleGenerate = async (goal: string) => {
    setIsGenerating(true);
    setGeneratingGoal(goal);

    try {
      // Call mock api delay
      await buildCoach(goal);
      const generated = generateCustomCoachFromGoal(goal);
      setSelectedCoach(generated);
    } catch (err) {
      console.error('Coach generation error:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRefreshPersonalCoach = async () => {
    setIsLoadingPersonal(true);
    try {
      await buildPersonalCoach();
      const prof = await getProfile();
      const merged: HabitProfile = {
        ...DEFAULT_HABIT_PROFILE,
        ...prof
      };
      setHabitProfile(merged);
      const updatedPersonal = buildMockPersonalCoach(merged);
      setPersonalCoach(updatedPersonal);
    } catch (err) {
      console.error('Failed to refresh personal coach:', err);
    } finally {
      setIsLoadingPersonal(false);
    }
  };

  const handleActivate = async () => {
    if (!selectedCoach) return;
    await activateCoach(selectedCoach.id);
    injectEvent({ type: 'coach.activated', coach: selectedCoach });
  };

  const handleSave = async () => {
    if (!selectedCoach) return;
    await saveCoach(selectedCoach);
    setSavedCoaches((prev) => {
      const existsIndex = prev.findIndex((c) => c.id === selectedCoach.id);
      if (existsIndex >= 0) {
        const next = [...prev];
        next[existsIndex] = selectedCoach;
        return next;
      }
      return [selectedCoach, ...prev];
    });
  };

  const activeCoachId = state?.activeCoach?.id || null;

  return (
    <div className="min-h-screen bg-paper text-ink font-sans selection:bg-paper-well pb-24">
      {/* Top Editorial Banner */}
      <div className="border-b border-hairline py-10 px-4 md:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="font-mono text-xs uppercase tracking-widest text-ink-mid mb-2">
            Undertone · Coach Specification Studio
          </div>
          <h1 className="font-serif text-5xl md:text-7xl tracking-tight leading-none text-ink">
            The Studio
          </h1>
          <p className="font-sans text-sm md:text-base text-ink-mid max-w-2xl mt-3 leading-relaxed">
            Inscribe custom behavioral judges and tactile haptic policies for your wearable band. Write a single sentence or select from your personal habit history.
          </p>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-4 md:px-8 pt-10">
        {/* 1. Sentence Prompt Hero */}
        <PromptHero onGenerate={handleGenerate} isGenerating={isGenerating} />

        {/* 2. Generating State Animation (~2.5s synthesis) */}
        {isGenerating && <GeneratingProgress goal={generatingGoal} />}

        {/* 3. Library Strip & Personal Coach with Trends */}
        <LibraryStrip
          prebuiltCoaches={prebuiltCoaches}
          savedCoaches={savedCoaches}
          personalCoach={personalCoach}
          habitProfile={habitProfile}
          currentCoachId={selectedCoach.id}
          activeCoachId={activeCoachId}
          onSelectCoach={(coach) => setSelectedCoach(coach)}
          onRefreshPersonalCoach={handleRefreshPersonalCoach}
          isLoadingPersonal={isLoadingPersonal}
        />

        {/* 4. The Editable Coach Sheet */}
        <section id="coach-sheet" className="pt-4">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div>
              <span className="font-mono text-xs uppercase tracking-widest text-ink-mid">
                Active Editor
              </span>
              <h2 className="font-serif text-3xl text-ink">
                {selectedCoach.name}
              </h2>
            </div>
            <div className="font-mono text-xs text-ink-mid">
              Status: {selectedCoach.id === activeCoachId ? (
                <span className="text-green-700 font-medium">Active on Band</span>
              ) : (
                <span>Drafting</span>
              )}
            </div>
          </div>

          <CoachSheet
            coach={selectedCoach}
            isActive={selectedCoach.id === activeCoachId}
            onUpdateCoach={(updated) => setSelectedCoach(updated)}
            onActivate={handleActivate}
            onSave={handleSave}
          />
        </section>
      </main>
    </div>
  );
}
