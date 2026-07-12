// ---------------------------------------------
// 음주 기록 저장소 (AsyncStorage 기반) + 피드백 보정 로직
// ---------------------------------------------

import AsyncStorage from '@react-native-async-storage/async-storage';
import { DrinkTypeKey, Sex, StomachState, VolumeUnit, clampLevel } from './hangover';

const STORAGE_KEY = 'sulgirok:records:v1';

export type DrinkRecord = {
  id: string;
  createdAt: string; // ISO string
  drinkType: DrinkTypeKey;
  drinkLabel: string;
  percent: number;
  volume: number;
  volumeUnit: VolumeUnit;
  volumeMl: number;
  hours: number;
  weight: number;
  sex: Sex;
  emptyStomach: StomachState | null;
  alcGrams: number;
  bac: number;
  eliminationTime: number;
  predictedLevel: number;
  calibratedLevel: number;
  actualLevel?: number;
};

export async function getRecords(): Promise<DrinkRecord[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function saveAll(records: DrinkRecord[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

export async function addRecord(record: DrinkRecord): Promise<void> {
  const records = await getRecords();
  records.push(record);
  await saveAll(records);
}

export async function setRecordFeedback(id: string, actualLevel: number): Promise<void> {
  const records = await getRecords();
  const next = records.map((r) => (r.id === id ? { ...r, actualLevel } : r));
  await saveAll(next);
}

// 실제 숙취 정도 피드백과 예측치의 평균 오차만큼 다음 예측을 보정한다.
export function getCalibrationOffset(records: DrinkRecord[]): number {
  const rated = records.filter((r) => typeof r.actualLevel === 'number');
  if (rated.length === 0) return 0;
  const sum = rated.reduce((acc, r) => acc + ((r.actualLevel as number) - r.predictedLevel), 0);
  return sum / rated.length;
}

export function applyCalibration(predictedLevel: number, offset: number): number {
  return clampLevel(predictedLevel + offset);
}

// 최근 피드백(실제 숙취 단계)이 "보통(3단계)"보다 높게 이어지면 권장 음주량을 줄이는 배율을 반환한다.
// 음주를 늘리도록 유도하지는 않으므로 평균이 3 이하일 때는 항상 1(변화 없음)이다.
export function getVolumeAdjustmentFactor(records: DrinkRecord[], windowSize = 5): number {
  const rated = records.filter((r) => typeof r.actualLevel === 'number');
  if (rated.length === 0) return 1;
  const recent = rated.slice(-windowSize);
  const avgActual = recent.reduce((acc, r) => acc + (r.actualLevel as number), 0) / recent.length;
  if (avgActual <= 3) return 1;
  const reduction = Math.min((avgActual - 3) * 0.15, 0.3);
  return 1 - reduction;
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
