import { CoachSpec, Debrief, SessionSummary, HabitProfile, DailyMission, Streak, Person, WeeklyReport } from '../bus/contracts';
import { MOCK_COACHES, MOCK_HABIT_PROFILE, MOCK_SESSIONS, MOCK_MISSION, MOCK_STREAK, MOCK_PEOPLE, MOCK_WEEKLY_REPORT, MOCK_DEVICES, MOCK_APPS } from '../bus/mock-source';

export async function listCoaches() { return MOCK_COACHES; }
export async function buildCoach(_goal: string) {
  return new Promise<CoachSpec>(resolve => setTimeout(() => resolve(MOCK_COACHES[0]), 2500));
}
export async function buildPersonalCoach() { return MOCK_COACHES[0]; }
export async function saveCoach(_coach: CoachSpec) {}
export async function activateCoach(_coachId: string) {}
export async function startSession(_coachId: string, _mode: string) {}
export async function stopSession(_sessionId: string) {}
export async function addBookmark(_text: string) {}
export async function swapSpeakers() {}
export async function createPairing() {}
export async function listDevices() { return MOCK_DEVICES; }
export async function listApps() { return MOCK_APPS; }
export async function approveApp(_appId: string) {}
export async function revokeApp(_appId: string) {}
export async function getDebrief(_sessionId: string): Promise<Debrief | null> { return null; }
export async function listSessions() { return MOCK_SESSIONS; }
export async function getProfile() { return MOCK_HABIT_PROFILE; }
export async function getMissionToday() { return MOCK_MISSION; }
export async function chooseMission(_missionId: string) {}
export async function getStreak() { return MOCK_STREAK; }
export async function listPeople() { return MOCK_PEOPLE; }
export async function tagPerson(_personId: string) {}
export async function getWeeklyReport() { return MOCK_WEEKLY_REPORT; }
