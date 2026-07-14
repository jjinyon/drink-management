import AsyncStorage from '@react-native-async-storage/async-storage';
import { DrinkTypeKey, Sex, StomachState, VolumeUnit, clampLevel } from './hangover';

const STORAGE_KEY = 'sulgirok:records:v1';

export type DrinkEntry = {
  id: string;
  drinkType: DrinkTypeKey;
  drinkLabel: string;
  percent: number;
  volume: number;
  volumeUnit: VolumeUnit;
  volumeMl: number;
  alcGrams: number;
};

export type DrinkingPlace = {
  id: string;
  name: string;
  startedAt: string;
  drinks: DrinkEntry[];
};

export type DrinkRecord = {
  id: string;
  createdAt: string;
  nightKey?: string;
  places?: DrinkingPlace[];
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

export function getCalibrationOffset(records: DrinkRecord[]): number {
  const rated = records.filter((r) => typeof r.actualLevel === 'number');
  if (rated.length === 0) return 0;
  const sum = rated.reduce((acc, r) => acc + ((r.actualLevel as number) - r.predictedLevel), 0);
  return sum / rated.length;
}

export function applyCalibration(predictedLevel: number, offset: number): number {
  return clampLevel(predictedLevel + offset);
}

export function getVolumeAdjustmentFactor(records: DrinkRecord[], windowSize = 5): number {
  const rated = records.filter((r) => typeof r.actualLevel === 'number');
  if (rated.length === 0) return 1;
  const recent = rated.slice(-windowSize);
  const avgActual = recent.reduce((acc, r) => acc + (r.actualLevel as number), 0) / recent.length;
  if (avgActual <= 3) return 1;
  const reduction = Math.min((avgActual - 3) * 0.15, 0.3);
  return 1 - reduction;
}

export function getNightKey(date = new Date()): string {
  const night = new Date(date);
  if (night.getHours() < 6) {
    night.setDate(night.getDate() - 1);
  }
  const yyyy = night.getFullYear();
  const mm = String(night.getMonth() + 1).padStart(2, '0');
  const dd = String(night.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function summarizePlaces(record: DrinkRecord): { placeCount: number; drinkCount: number } {
  if (!record.places || record.places.length === 0) {
    return { placeCount: 1, drinkCount: 1 };
  }
  return {
    placeCount: record.places.length,
    drinkCount: record.places.reduce((sum, place) => sum + place.drinks.length, 0),
  };
}

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
