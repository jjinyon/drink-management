// ---------------------------------------------
// 사용자 정보 저장소 (AsyncStorage 기반)
// 키 / 체중 / 성별 / 본인 주량을 음주 기록과 별도로 보관한다.
// ---------------------------------------------

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Sex } from './hangover';

const STORAGE_KEY = 'sulgirok:profile:v1';

export type UserProfile = {
  height: number | null;
  weight: number | null;
  sex: Sex | null;
  tolerance: number | null;
};

export const EMPTY_PROFILE: UserProfile = {
  height: null,
  weight: null,
  sex: null,
  tolerance: null,
};

export async function getProfile(): Promise<UserProfile> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return EMPTY_PROFILE;
  try {
    const parsed = JSON.parse(raw);
    return { ...EMPTY_PROFILE, ...parsed };
  } catch {
    return EMPTY_PROFILE;
  }
}

export async function saveProfile(profile: UserProfile): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}

export function isProfileReadyForCalc(profile: UserProfile): boolean {
  return profile.weight !== null && profile.sex !== null;
}
