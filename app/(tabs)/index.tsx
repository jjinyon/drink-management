import { useFocusEffect } from '@react-navigation/native';
import { Link } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
    SafeAreaView,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';

import {
    DRINK_TYPES,
    LEVEL_NAMES,
    Sex,
    StomachState,
    VolumeUnit,
    calculateAlcoholGramsByUnit,
    calculateBAC,
    calculateEliminationTime,
    classifyHangoverLevel,
    getDistributionRatio,
    getRecommendedVolume,
    getRecoveryGuide,
    validateInputs,
} from '@/lib/hangover';
import { EMPTY_PROFILE, UserProfile, getProfile, isProfileReadyForCalc } from '@/lib/profile';
import {
    DrinkRecord,
    addRecord,
    applyCalibration,
    generateId,
    getCalibrationOffset,
    getRecords,
    getVolumeAdjustmentFactor,
} from '@/lib/records';

const TARGET_LEVEL = 3;

// ---------------------------------------------
// UI 컴포넌트
// ---------------------------------------------

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </TouchableOpacity>
  );
}

function parseWakeTimeInput(value: string): { hours: number; minutes: number } | null {
  if (!value.includes(':')) return null;

  const [hourText, minuteText] = value.split(':');
  const hours = Number.parseInt(hourText, 10);
  const minutes = Number.parseInt(minuteText, 10);

  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  return { hours, minutes };
}

function getHoursUntilWakeup(value: string): number | null {
  const parsed = parseWakeTimeInput(value);
  if (!parsed) return null;

  const now = new Date();
  const target = new Date(now);
  target.setHours(parsed.hours, parsed.minutes, 0, 0);

  if (target.getTime() <= now.getTime()) {
    target.setDate(target.getDate() + 1);
  }

  return (target.getTime() - now.getTime()) / (1000 * 60 * 60);
}

type Result = {
  alcGrams: number;
  bac: number;
  eliminationTime: number;
  predictedLevel: number;
  calibratedLevel: number;
  levelName: string;
  guides: string[];
  emptyStomach: StomachState | null;
};

export default function App() {
  const [drinkType, setDrinkType] = useState('soju');
  const [percent, setPercent] = useState('16');
  const [volume, setVolume] = useState('');
  const [volumeUnit, setVolumeUnit] = useState<VolumeUnit>('ml');
  const [wakeTime, setWakeTime] = useState('');
  const [emptyStomach, setEmptyStomach] = useState<StomachState | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [calibrationOffset, setCalibrationOffset] = useState(0);
  const [volumeAdjustmentFactor, setVolumeAdjustmentFactor] = useState(1);
  const [pendingRecord, setPendingRecord] = useState<DrinkRecord | null>(null);
  const [saved, setSaved] = useState(false);
  const [profile, setProfile] = useState<UserProfile>(EMPTY_PROFILE);

  useFocusEffect(
    useCallback(() => {
      getRecords().then((records) => {
        setCalibrationOffset(getCalibrationOffset(records));
        setVolumeAdjustmentFactor(getVolumeAdjustmentFactor(records));
      });
      getProfile().then(setProfile);
    }, []),
  );

  const profileReady = isProfileReadyForCalc(profile);
  const percentNum = parseFloat(percent);
  const selectedDrink = DRINK_TYPES.find((d) => d.key === drinkType);
  const bottleVolumeMl = selectedDrink?.bottleVolumeMl ?? 360;
  const recommendedVolume =
    profileReady && !Number.isNaN(percentNum) && percentNum > 0
      ? getRecommendedVolume(
          profile.weight as number,
          profile.sex as Sex,
          percentNum,
          TARGET_LEVEL,
          calibrationOffset,
        ) * volumeAdjustmentFactor
      : null;
  const recommendedDisplayVolume =
    recommendedVolume !== null && volumeUnit === 'bottle'
      ? recommendedVolume / bottleVolumeMl
      : recommendedVolume;

  function handleSelectDrinkType(key: string) {
    setDrinkType(key);
    const found = DRINK_TYPES.find((d) => d.key === key);
    if (found && found.percent !== null) {
      setPercent(String(found.percent));
    } else {
      setPercent('');
    }
  }

  function handleCalculate() {
    if (!profileReady) {
      setErrors({ profile: '[내 정보] 탭에서 체중과 성별을 먼저 입력해 주세요.' });
      setResult(null);
      setPendingRecord(null);
      return;
    }

    const wakeHours = getHoursUntilWakeup(wakeTime);
    const values = {
      percent: parseFloat(percent),
      volume: parseFloat(volume),
      hours: wakeHours ?? Number.NaN,
      weight: profile.weight as number,
      sex: profile.sex,
      emptyStomach,
    };

    const newErrors = validateInputs(values);
    if (wakeHours === null) {
      newErrors.wakeTime = '다음날 기상 시각을 HH:MM 형식으로 입력해 주세요.';
    }
    setErrors(newErrors);

    if (Object.keys(newErrors).length > 0) {
      setResult(null);
      setPendingRecord(null);
      return;
    }

    const alcGrams = calculateAlcoholGramsByUnit(
      values.volume,
      values.percent,
      volumeUnit,
      bottleVolumeMl,
    );
    const r = getDistributionRatio(values.sex as Sex);
    const bac = calculateBAC(alcGrams, values.weight, r);
    const bacEliminationTime = calculateEliminationTime(bac);
    const elimination = Math.max(bacEliminationTime, wakeHours ?? 0);
    const predictedLevel = classifyHangoverLevel(bac);
    const calibratedLevel = applyCalibration(predictedLevel, calibrationOffset);
    const guides = getRecoveryGuide(calibratedLevel);

    setResult({
      alcGrams,
      bac,
      eliminationTime: elimination,
      predictedLevel,
      calibratedLevel,
      levelName: LEVEL_NAMES[calibratedLevel],
      guides,
      emptyStomach: values.emptyStomach,
    });

    const found = DRINK_TYPES.find((d) => d.key === drinkType);
    setPendingRecord({
      id: generateId(),
      createdAt: new Date().toISOString(),
      drinkType: found ? found.key : 'custom',
      drinkLabel: found ? found.label : '직접 입력',
      percent: values.percent,
      volume: values.volume,
      volumeUnit,
      volumeMl: values.volume * (volumeUnit === 'bottle' ? bottleVolumeMl : 1),
      hours: wakeHours ?? 0,
      weight: values.weight,
      sex: values.sex as Sex,
      emptyStomach: values.emptyStomach,
      alcGrams,
      bac,
      eliminationTime: elimination,
      predictedLevel,
      calibratedLevel,
    });
    setSaved(false);
  }

  async function handleSaveRecord() {
    if (!pendingRecord) return;
    await addRecord(pendingRecord);
    setSaved(true);
  }

  function handleReset() {
    setDrinkType('soju');
    setPercent('16');
    setVolume('');
    setVolumeUnit('ml');
    setWakeTime('');
    setEmptyStomach(null);
    setErrors({});
    setResult(null);
    setPendingRecord(null);
    setSaved(false);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.receipt}>
          {/* 헤더 */}
          <View style={styles.header}>
            <Text style={styles.title}>술기록</Text>
            <Text style={styles.subtitle}>오늘의 음주 기록으로 내일의 상태를 예상해보세요.</Text>
          </View>

          {/* 술 종류 */}
          <Text style={styles.label}>술 종류</Text>
          <View style={styles.chipRow}>
            {DRINK_TYPES.map((d) => (
              <Chip
                key={d.key}
                label={d.label}
                selected={drinkType === d.key}
                onPress={() => handleSelectDrinkType(d.key)}
              />
            ))}
          </View>

          {/* 도수 */}
          <Text style={styles.label}>알코올 도수 (%)</Text>
          <TextInput
            style={[styles.input, drinkType !== 'custom' && styles.inputDisabled]}
            keyboardType="decimal-pad"
            value={percent}
            onChangeText={setPercent}
            placeholder="예: 16"
            editable={drinkType === 'custom'}
          />
          {!!errors.percent && <Text style={styles.error}>{errors.percent}</Text>}

          {/* 섭취량 */}
          <Text style={styles.label}>섭취량 입력 방식</Text>
          <View style={styles.chipRow}>
            <Chip label="ml" selected={volumeUnit === 'ml'} onPress={() => setVolumeUnit('ml')} />
            <Chip label="병" selected={volumeUnit === 'bottle'} onPress={() => setVolumeUnit('bottle')} />
          </View>

          <Text style={styles.label}>{volumeUnit === 'ml' ? '섭취량 (ml)' : '섭취량 (병)'}</Text>
          <TextInput
            style={styles.input}
            keyboardType="decimal-pad"
            value={volume}
            onChangeText={setVolume}
            placeholder={volumeUnit === 'ml' ? '예: 360' : '예: 2'}
          />
          {!!errors.volume && <Text style={styles.error}>{errors.volume}</Text>}
          {recommendedVolume !== null && (
            <Text style={styles.recommendHint}>
              권장 음주량 (숙취 {TARGET_LEVEL}단계 기준): 약{' '}
              {volumeUnit === 'bottle'
                ? `${Math.round((recommendedDisplayVolume ?? 0) * 10) / 10}병`
                : `${Math.round(recommendedDisplayVolume ?? 0)}ml`}
              {volumeAdjustmentFactor < 1 &&
                ` · 최근 기록 반영 ${Math.round(volumeAdjustmentFactor * 100)}%`}
            </Text>
          )}

          {/* 다음날 기상 시간 */}
          <Text style={styles.label}>다음날 기상 시각 (HH:MM)</Text>
          <TextInput
            style={styles.input}
            value={wakeTime}
            onChangeText={setWakeTime}
            placeholder="예: 08:30"
          />
          {!!errors.wakeTime && <Text style={styles.error}>{errors.wakeTime}</Text>}
          <Text style={styles.helperText}>
            술자리를 시작한 뒤 다음날 기상 시각까지의 시간을 기준으로 계산합니다.
          </Text>

          {/* 내 정보 상태 */}
          {profileReady ? (
            <Text style={styles.profileSummary}>
              내 정보: {profile.sex === 'male' ? '남성' : '여성'} · {profile.weight}kg
            </Text>
          ) : (
            <View style={styles.caution}>
              <Text style={styles.cautionText}>
                계산을 위해 체중과 성별 정보가 필요합니다.{' '}
                <Link href="/profile" style={styles.cautionLink}>
                  내 정보 탭
                </Link>
                에서 먼저 입력해 주세요.
              </Text>
            </View>
          )}
          {!!errors.profile && <Text style={styles.error}>{errors.profile}</Text>}

          {/* 공복 여부 */}
          <Text style={styles.label}>안주 섭취 여부</Text>
          <View style={styles.chipRow}>
            <Chip
              label="공복"
              selected={emptyStomach === 'fasting'}
              onPress={() => setEmptyStomach('fasting')}
            />
            <Chip
              label="안주와 함께"
              selected={emptyStomach === 'fed'}
              onPress={() => setEmptyStomach('fed')}
            />
          </View>

          {/* 버튼 */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary, !profileReady && styles.btnDisabled]}
              onPress={handleCalculate}
              disabled={!profileReady}
            >
              <Text style={styles.btnPrimaryText}>계산하기</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btn} onPress={handleReset}>
              <Text style={styles.btnText}>초기화</Text>
            </TouchableOpacity>
          </View>

          {/* 결과 */}
          {result && (
            <View style={styles.result}>
              <Text style={styles.resultTitle}>계산 결과</Text>
              <View style={styles.resultGrid}>
                <View style={styles.resultCell}>
                  <Text style={styles.resultLabel}>순수 알코올 섭취량</Text>
                  <Text style={styles.resultValue}>{result.alcGrams.toFixed(1)} g</Text>
                </View>
                <View style={styles.resultCell}>
                  <Text style={styles.resultLabel}>예상 BAC</Text>
                  <Text style={styles.resultValue}>{result.bac.toFixed(3)} %</Text>
                </View>
                <View style={styles.resultCell}>
                  <Text style={styles.resultLabel}>숙취 지수</Text>
                  <Text style={styles.resultValue}>{result.calibratedLevel}</Text>
                </View>
                <View style={styles.resultCell}>
                  <Text style={styles.resultLabel}>단계 이름</Text>
                  <Text style={styles.resultValue}>{result.levelName}</Text>
                </View>
                <View style={styles.resultCell}>
                  <Text style={styles.resultLabel}>다음날 기상까지 예상 시간</Text>
                  <Text style={styles.resultValue}>{result.eliminationTime.toFixed(1)} 시간</Text>
                </View>
              </View>

              {calibrationOffset !== 0 && (
                <Text style={styles.calibrationNote}>
                  나의 실제 숙취 기록을 반영해 기본 예측({result.predictedLevel}단계)을 보정한
                  지수입니다.
                </Text>
              )}

              {result.emptyStomach === 'fasting' && (
                <View style={styles.caution}>
                  <Text style={styles.cautionText}>
                    공복 음주는 알코올 흡수가 더 빠르게 느껴질 수 있으므로 충분한 식사와 수분
                    섭취가 필요합니다.
                  </Text>
                </View>
              )}

              <View style={styles.guide}>
                <Text style={styles.guideTitle}>숙취 관리 가이드</Text>
                {result.guides.map((item, idx) => (
                  <Text key={idx} style={styles.guideItem}>
                    • {item}
                  </Text>
                ))}
              </View>

              <TouchableOpacity
                style={[styles.btn, styles.btnSave, saved && styles.btnSaved]}
                onPress={handleSaveRecord}
                disabled={saved}
              >
                <Text style={saved ? styles.btnSavedText : styles.btnPrimaryText}>
                  {saved ? '기록에 저장됨 ✓' : '이 기록 저장하기'}
                </Text>
              </TouchableOpacity>

              <Text style={styles.safety}>
                이 결과는 입력값을 기반으로 한 단순 추정치이며 실제 혈중알코올농도, 숙취 정도,
                알코올 분해 속도는 개인의 건강 상태와 음주 상황에 따라 달라질 수 있습니다. 계산
                결과와 관계없이 음주 후에는 운전하지 마세요.
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------
// 스타일
// ---------------------------------------------

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f4f4f2',
  },
  scroll: {
    flexGrow: 1,
    alignItems: 'center',
    padding: 20,
  },
  receipt: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e6e6e6',
    borderRadius: 6,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  header: {
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#e6e6e6',
    borderStyle: 'dashed',
    paddingBottom: 12,
    marginBottom: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 1,
    color: '#2b2b2b',
  },
  subtitle: {
    marginTop: 6,
    fontSize: 13,
    color: '#6b6b6b',
    textAlign: 'center',
  },
  label: {
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 6,
    color: '#2b2b2b',
  },
  input: {
    borderWidth: 1,
    borderColor: '#d6d6d6',
    borderStyle: 'dashed',
    borderRadius: 4,
    padding: 10,
    fontSize: 15,
    color: '#2b2b2b',
  },
  inputDisabled: {
    backgroundColor: '#f0f0f0',
    color: '#999',
  },
  error: {
    color: '#c0392b',
    fontSize: 12,
    marginTop: 4,
  },
  recommendHint: {
    color: '#0a7ea4',
    fontSize: 12,
    marginTop: 4,
  },
  helperText: {
    color: '#6b6b6b',
    fontSize: 12,
    marginTop: 4,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#cfcfcf',
    backgroundColor: '#fff',
    marginRight: 6,
    marginBottom: 6,
  },
  chipSelected: {
    backgroundColor: '#111',
    borderColor: '#111',
  },
  chipText: {
    color: '#2b2b2b',
    fontSize: 13,
  },
  chipTextSelected: {
    color: '#fff',
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  btn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#cfcfcf',
    backgroundColor: '#fff',
    alignItems: 'center',
    marginRight: 8,
  },
  btnPrimary: {
    backgroundColor: '#111',
    borderColor: '#111',
    marginRight: 0,
  },
  btnDisabled: {
    backgroundColor: '#cfcfcf',
    borderColor: '#cfcfcf',
  },
  btnText: {
    color: '#2b2b2b',
    fontWeight: '600',
  },
  btnPrimaryText: {
    color: '#fff',
    fontWeight: '600',
  },
  btnSave: {
    backgroundColor: '#0a7ea4',
    borderColor: '#0a7ea4',
    marginTop: 16,
    marginRight: 0,
  },
  btnSaved: {
    backgroundColor: '#e7f3f6',
    borderColor: '#0a7ea4',
  },
  btnSavedText: {
    color: '#0a7ea4',
    fontWeight: '600',
  },
  result: {
    marginTop: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  resultTitle: {
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 10,
  },
  resultGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  resultCell: {
    width: '47%',
    backgroundColor: '#fafafa',
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 4,
    padding: 10,
    marginBottom: 10,
  },
  resultLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2b2b2b',
    marginBottom: 4,
  },
  resultValue: {
    fontSize: 15,
    color: '#2b2b2b',
  },
  calibrationNote: {
    fontSize: 12,
    color: '#0a7ea4',
    marginTop: -2,
    marginBottom: 10,
  },
  caution: {
    backgroundColor: '#fff6f6',
    borderWidth: 1,
    borderColor: '#ffd6d6',
    borderRadius: 6,
    padding: 10,
    marginTop: 10,
  },
  cautionText: {
    color: '#c0392b',
    fontSize: 13,
  },
  cautionLink: {
    color: '#0a7ea4',
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  profileSummary: {
    marginTop: 12,
    fontSize: 13,
    color: '#6b6b6b',
  },
  guide: {
    marginTop: 12,
  },
  guideTitle: {
    fontWeight: '700',
    marginBottom: 6,
  },
  guideItem: {
    fontSize: 13,
    color: '#2b2b2b',
    marginBottom: 4,
    lineHeight: 20,
  },
  safety: {
    fontSize: 12,
    color: '#6b6b6b',
    marginTop: 12,
    lineHeight: 18,
  },
});
