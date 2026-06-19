import type { GoogleUserProfile, OnboardingState } from "./contracts";

export const ONBOARDING_COMPLETE_KEY = "handshook:onboardingComplete";
export const ONBOARDING_COMPLETED_AT_KEY = "handshook:onboardingCompletedAt";
export const ONBOARDING_USER_KEY = "handshook:googleUser";

export function onboardingPageUrl(): string {
  const path = "options.html?onboarding=1";
  return globalThis.chrome?.runtime?.getURL ? globalThis.chrome.runtime.getURL(path) : `/${path}`;
}

function isGoogleUserProfile(value: unknown): value is GoogleUserProfile {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<GoogleUserProfile>;
  return typeof candidate.email === "string" && candidate.email.length > 0;
}

export async function readOnboardingState(): Promise<OnboardingState> {
  if (!globalThis.chrome?.storage?.local) {
    return { complete: true, completedAt: null, user: null };
  }

  const stored = await globalThis.chrome.storage.local.get([
    ONBOARDING_COMPLETE_KEY,
    ONBOARDING_COMPLETED_AT_KEY,
    ONBOARDING_USER_KEY
  ]);

  const completedAt = stored[ONBOARDING_COMPLETED_AT_KEY];
  const user = stored[ONBOARDING_USER_KEY];

  return {
    complete: stored[ONBOARDING_COMPLETE_KEY] !== false,
    completedAt: typeof completedAt === "string" ? completedAt : null,
    user: isGoogleUserProfile(user) ? user : null
  };
}

export async function saveOnboardingUser(user: GoogleUserProfile): Promise<void> {
  if (!globalThis.chrome?.storage?.local) return;
  await globalThis.chrome.storage.local.set({ [ONBOARDING_USER_KEY]: user });
}

export async function markOnboardingIncomplete(): Promise<void> {
  if (!globalThis.chrome?.storage?.local) return;
  await globalThis.chrome.storage.local.set({
    [ONBOARDING_COMPLETE_KEY]: false,
    [ONBOARDING_COMPLETED_AT_KEY]: null
  });
}

export async function markOnboardingComplete(): Promise<OnboardingState> {
  const completedAt = new Date().toISOString();

  if (!globalThis.chrome?.storage?.local) {
    return { complete: true, completedAt, user: null };
  }

  await globalThis.chrome.storage.local.set({
    [ONBOARDING_COMPLETE_KEY]: true,
    [ONBOARDING_COMPLETED_AT_KEY]: completedAt
  });

  return readOnboardingState();
}
