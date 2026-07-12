// ---------------------------------------------
// 음주 기록 계산 공용 로직 (index.tsx, history.tsx 공유)
// ---------------------------------------------

export type Sex = 'male' | 'female';
export type StomachState = 'fasting' | 'fed';

export type DrinkTypeKey = 'soju' | 'beer' | 'wine' | 'makgeolli' | 'liquor' | 'highball' | 'custom';

export type VolumeUnit = 'ml' | 'bottle';

export type DrinkType = {
  key: DrinkTypeKey;
  label: string;
  percent: number | null;
  bottleVolumeMl: number;
};

export const DRINK_TYPES: DrinkType[] = [
  { key: 'soju', label: '소주', percent: 16, bottleVolumeMl: 360 },
  { key: 'beer', label: '맥주', percent: 5, bottleVolumeMl: 355 },
  { key: 'wine', label: '와인', percent: 13, bottleVolumeMl: 750 },
  { key: 'makgeolli', label: '막걸리', percent: 6, bottleVolumeMl: 750 },
  { key: 'liquor', label: '양주', percent: 40, bottleVolumeMl: 375 },
  { key: 'highball', label: '하이볼', percent: 8, bottleVolumeMl: 350 },
  { key: 'custom', label: '직접 입력', percent: null, bottleVolumeMl: 360 },
];

export function getDistributionRatio(sex: Sex): number {
  return sex === 'male' ? 0.68 : 0.55;
}

export function calculateAlcoholGrams(volumeMl: number, percent: number): number {
  return volumeMl * (percent / 100) * 0.789;
}

export function convertVolumeToMl(volume: number, unit: VolumeUnit, bottleVolumeMl: number): number {
  return unit === 'bottle' ? volume * bottleVolumeMl : volume;
}

export function calculateAlcoholGramsByUnit(
  volume: number,
  percent: number,
  unit: VolumeUnit,
  bottleVolumeMl: number,
): number {
  const volumeMl = convertVolumeToMl(volume, unit, bottleVolumeMl);
  return calculateAlcoholGrams(volumeMl, percent);
}

export function calculateBAC(alcoholGrams: number, weightKg: number, r: number): number {
  const weightG = weightKg * 1000;
  return (alcoholGrams / (weightG * r)) * 100;
}

export function calculateEliminationTime(bac: number): number {
  return bac / 0.015;
}

export function classifyHangoverLevel(bac: number): number {
  if (bac < 0.03) return 1;
  if (bac < 0.06) return 2;
  if (bac < 0.1) return 3;
  if (bac < 0.15) return 4;
  return 5;
}

export function getRecoveryGuide(level: number): string[] {
  const guides: Record<number, string[]> = {
    1: ['물을 충분히 마시기', '가벼운 식사하기', '평소 수면 시간 확보하기'],
    2: ['물이나 이온 음료 마시기', '자극적이지 않은 음식 섭취하기', '충분한 수면 취하기'],
    3: [
      '수분과 전해질을 천천히 보충하기',
      '죽, 바나나, 토스트 등 부담이 적은 음식 먹기',
      '추가 음주를 피하고 충분히 휴식하기',
    ],
    4: [
      '무리한 운동과 운전을 피하기',
      '조금씩 자주 수분을 섭취하기',
      '심한 구토나 어지럼증이 지속되면 주변 사람에게 알리기',
    ],
    5: [
      '혼자 있지 않기',
      '운전이나 위험한 활동을 절대 하지 않기',
      '의식 저하, 호흡 이상, 반복적인 구토 등의 증상이 있으면 즉시 119 또는 의료기관의 도움을 받기',
    ],
  };
  return guides[level] || [];
}

export const LEVEL_NAMES: Record<number, string> = {
  1: '거의 없음',
  2: '경미',
  3: '보통',
  4: '심함',
  5: '매우 심함',
};

export function clampLevel(level: number): number {
  return Math.min(5, Math.max(1, Math.round(level)));
}

// 각 숙취 단계에서 다음 단계로 넘어가기 직전까지의 BAC 상한 (classifyHangoverLevel의 역함수용)
const LEVEL_BAC_CEILING: Record<number, number> = {
  1: 0.029,
  2: 0.059,
  3: 0.099,
  4: 0.149,
  5: 0.25,
};

// 목표 숙취 단계를 넘지 않는 최대 음주량(ml)을 위드마크 공식 역산으로 계산한다.
export function getRecommendedVolume(
  weightKg: number,
  sex: Sex,
  percent: number,
  targetLevel: number,
  calibrationOffset: number = 0,
): number {
  const effectiveLevel = clampLevel(targetLevel - calibrationOffset);
  const targetBac = LEVEL_BAC_CEILING[effectiveLevel];
  const r = getDistributionRatio(sex);
  const weightG = weightKg * 1000;
  const alcGrams = (targetBac * weightG * r) / 100;
  return alcGrams / ((percent / 100) * 0.789);
}

export type InputValues = {
  percent: number;
  volume: number;
  hours: number;
  weight: number;
  sex: Sex | null;
  emptyStomach: StomachState | null;
};

export function validateInputs(values: InputValues): Record<string, string> {
  const errors: Record<string, string> = {};
  if (values.percent === null || Number.isNaN(values.percent)) {
    errors.percent = '도수를 입력해 주세요.';
  } else if (values.percent <= 0 || values.percent > 100) {
    errors.percent = '도수는 0보다 크고 100 이하여야 합니다.';
  }
  if (values.volume === null || Number.isNaN(values.volume) || values.volume <= 0) {
    errors.volume = '섭취량은 0보다 커야 합니다.';
  }
  if (values.hours === null || Number.isNaN(values.hours) || values.hours <= 0) {
    errors.hours = '음주 시간은 0보다 커야 합니다.';
  }
  if (values.weight === null || Number.isNaN(values.weight) || values.weight <= 0) {
    errors.weight = '체중을 정확히 입력해 주세요.';
  }
  if (!values.sex) {
    errors.sex = '성별을 선택해 주세요.';
  }
  return errors;
}
