import type { GoogleUserProfile, OnboardingState } from "./contracts";

export const ONBOARDING_COMPLETE_KEY = "handshook:onboardingComplete";
export const ONBOARDING_COMPLETED_AT_KEY = "handshook:onboardingCompletedAt";
export const ONBOARDING_USER_KEY = "handshook:googleUser";
export const AUTH_TOKEN_KEY = "handshook:sessionToken";

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
    ONBOARDING_USER_KEY,
    AUTH_TOKEN_KEY
  ]);

  const completedAt = stored[ONBOARDING_COMPLETED_AT_KEY];
  const user = stored[ONBOARDING_USER_KEY];
  const token = stored[AUTH_TOKEN_KEY];
  const authenticated = isGoogleUserProfile(user) && typeof token === "string" && token.length > 0;

  return {
    complete: authenticated && stored[ONBOARDING_COMPLETE_KEY] !== false,
    completedAt: typeof completedAt === "string" ? completedAt : null,
    user: authenticated ? user : null
  };
}

export async function saveOnboardingUser(
  user: GoogleUserProfile,
  sessionToken: string
): Promise<void> {
  if (!globalThis.chrome?.storage?.local) return;
  await globalThis.chrome.storage.local.set({
    [ONBOARDING_USER_KEY]: user,
    [AUTH_TOKEN_KEY]: sessionToken
  });
}

export async function readSessionToken(): Promise<string | null> {
  if (!globalThis.chrome?.storage?.local) return null;
  const stored = await globalThis.chrome.storage.local.get(AUTH_TOKEN_KEY);
  const token = stored[AUTH_TOKEN_KEY];
  return typeof token === "string" && token.length > 0 ? token : null;
}

export async function clearOnboardingUser(): Promise<void> {
  if (!globalThis.chrome?.storage?.local) return;
  await globalThis.chrome.storage.local.remove([
    ONBOARDING_USER_KEY,
    ONBOARDING_COMPLETED_AT_KEY,
    AUTH_TOKEN_KEY
  ]);
  await globalThis.chrome.storage.local.set({ [ONBOARDING_COMPLETE_KEY]: false });
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
