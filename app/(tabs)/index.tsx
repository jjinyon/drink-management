import { useFocusEffect } from '@react-navigation/native';
import { Link } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
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
  DrinkEntry,
  DrinkRecord,
  DrinkingPlace,
  addRecord,
  applyCalibration,
  generateId,
  getCalibrationOffset,
  getNightKey,
  getRecords,
  getVolumeAdjustmentFactor,
} from '@/lib/records';

const TARGET_LEVEL = 3;

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

function formatVolume(entry: DrinkEntry) {
  return entry.volumeUnit === 'bottle' ? `${entry.volume}병` : `${entry.volume}ml`;
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
  drinkCount: number;
  placeCount: number;
};

export default function App() {
  const [drinkType, setDrinkType] = useState('soju');
  const [percent, setPercent] = useState('16');
  const [volume, setVolume] = useState('');
  const [volumeUnit, setVolumeUnit] = useState<VolumeUnit>('ml');
  const [wakeTime, setWakeTime] = useState('');
  const [placeName, setPlaceName] = useState('1차');
  const [currentDrinks, setCurrentDrinks] = useState<DrinkEntry[]>([]);
  const [places, setPlaces] = useState<DrinkingPlace[]>([]);
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
  const allPlaces = useMemo(() => {
    const trimmedName = placeName.trim() || `${places.length + 1}차`;
    if (currentDrinks.length === 0) return places;
    return [
      ...places,
      { id: 'draft', name: trimmedName, startedAt: new Date().toISOString(), drinks: currentDrinks },
    ];
  }, [currentDrinks, placeName, places]);
  const totalDrinkCount = allPlaces.reduce((sum, place) => sum + place.drinks.length, 0);
  const totalAlcoholGrams = allPlaces.reduce(
    (sum, place) => sum + place.drinks.reduce((drinkSum, drink) => drinkSum + drink.alcGrams, 0),
    0,
  );
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
    recommendedVolume !== null && volumeUnit === 'bottle' ? recommendedVolume / bottleVolumeMl : recommendedVolume;

  function handleSelectDrinkType(key: string) {
    setDrinkType(key);
    const found = DRINK_TYPES.find((d) => d.key === key);
    setPercent(found?.percent !== null && found?.percent !== undefined ? String(found.percent) : '');
  }

  function handleAddDrink() {
    const values = {
      percent: parseFloat(percent),
      volume: parseFloat(volume),
      hours: 1,
      weight: profile.weight ?? 1,
      sex: profile.sex,
      emptyStomach,
    };
    const newErrors = validateInputs(values);
    delete newErrors.hours;
    delete newErrors.weight;
    delete newErrors.sex;
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    const found = DRINK_TYPES.find((d) => d.key === drinkType);
    const volumeMl = values.volume * (volumeUnit === 'bottle' ? bottleVolumeMl : 1);
    const alcGrams = calculateAlcoholGramsByUnit(values.volume, values.percent, volumeUnit, bottleVolumeMl);
    setCurrentDrinks((prev) => [
      ...prev,
      {
        id: generateId(),
        drinkType: found ? found.key : 'custom',
        drinkLabel: found ? found.label : '직접 입력',
        percent: values.percent,
        volume: values.volume,
        volumeUnit,
        volumeMl,
        alcGrams,
      },
    ]);
    setVolume('');
    setResult(null);
    setPendingRecord(null);
    setSaved(false);
  }

  function handleSavePlace() {
    if (currentDrinks.length === 0) {
      setErrors({ drinks: '이 술자리에 마신 술을 먼저 추가해 주세요.' });
      return;
    }
    const nextIndex = places.length + 2;
    setPlaces((prev) => [
      ...prev,
      {
        id: generateId(),
        name: placeName.trim() || `${prev.length + 1}차`,
        startedAt: new Date().toISOString(),
        drinks: currentDrinks,
      },
    ]);
    setCurrentDrinks([]);
    setPlaceName(`${nextIndex}차`);
    setErrors({});
    setResult(null);
    setPendingRecord(null);
    setSaved(false);
  }

  function handleCalculate() {
    if (!profileReady) {
      setErrors({ profile: '[내 정보] 탭에서 체중과 성별을 먼저 입력해 주세요.' });
      setResult(null);
      setPendingRecord(null);
      return;
    }
    if (totalDrinkCount === 0) {
      setErrors({ drinks: '오늘 밤 마신 술을 하나 이상 추가해 주세요.' });
      setResult(null);
      setPendingRecord(null);
      return;
    }

    const wakeHours = getHoursUntilWakeup(wakeTime);
    const values = {
      percent: 1,
      volume: 1,
      hours: wakeHours ?? Number.NaN,
      weight: profile.weight as number,
      sex: profile.sex,
      emptyStomach,
    };
    const newErrors = validateInputs(values);
    delete newErrors.percent;
    delete newErrors.volume;
    if (wakeHours === null) {
      newErrors.wakeTime = '다음 기상 시각을 HH:MM 형식으로 입력해 주세요.';
    }
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) {
      setResult(null);
      setPendingRecord(null);
      return;
    }

    const r = getDistributionRatio(values.sex as Sex);
    const bac = calculateBAC(totalAlcoholGrams, values.weight, r);
    const bacEliminationTime = calculateEliminationTime(bac);
    const elimination = Math.max(bacEliminationTime, wakeHours ?? 0);
    const predictedLevel = classifyHangoverLevel(bac);
    const calibratedLevel = applyCalibration(predictedLevel, calibrationOffset);
    const guides = getRecoveryGuide(calibratedLevel);
    const savedPlaces: DrinkingPlace[] = allPlaces.map((place) => ({
      ...place,
      id: place.id === 'draft' ? generateId() : place.id,
    }));
    const flatDrinks = savedPlaces.flatMap((place) => place.drinks);
    const firstDrink = flatDrinks[0];

    setResult({
      alcGrams: totalAlcoholGrams,
      bac,
      eliminationTime: elimination,
      predictedLevel,
      calibratedLevel,
      levelName: LEVEL_NAMES[calibratedLevel],
      guides,
      emptyStomach: values.emptyStomach,
      drinkCount: flatDrinks.length,
      placeCount: savedPlaces.length,
    });

    setPendingRecord({
      id: generateId(),
      createdAt: new Date().toISOString(),
      nightKey: getNightKey(),
      places: savedPlaces,
      drinkType: firstDrink.drinkType,
      drinkLabel: `${savedPlaces.length}개 술자리 누적`,
      percent: firstDrink.percent,
      volume: flatDrinks.reduce((sum, drink) => sum + drink.volumeMl, 0),
      volumeUnit: 'ml',
      volumeMl: flatDrinks.reduce((sum, drink) => sum + drink.volumeMl, 0),
      hours: wakeHours ?? 0,
      weight: values.weight,
      sex: values.sex as Sex,
      emptyStomach: values.emptyStomach,
      alcGrams: totalAlcoholGrams,
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
    setPlaceName('1차');
    setCurrentDrinks([]);
    setPlaces([]);
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
          <View style={styles.header}>
            <Text style={styles.title}>술기록</Text>
            <Text style={styles.subtitle}>저녁부터 새벽까지의 술자리를 한 번의 밤으로 묶어 누적합니다.</Text>
          </View>

          <Text style={styles.label}>술자리</Text>
          <TextInput style={styles.input} value={placeName} onChangeText={setPlaceName} placeholder="예: 1차, 포차" />

          <Text style={styles.label}>술 종류</Text>
          <View style={styles.chipRow}>
            {DRINK_TYPES.map((d) => (
              <Chip key={d.key} label={d.label} selected={drinkType === d.key} onPress={() => handleSelectDrinkType(d.key)} />
            ))}
          </View>

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
              현재 선택한 술 기준 권장량: {volumeUnit === 'bottle' ? `${Math.round((recommendedDisplayVolume ?? 0) * 10) / 10}병` : `${Math.round(recommendedDisplayVolume ?? 0)}ml`}
              {volumeAdjustmentFactor < 1 && ` · 최근 숙취 기록 반영 ${Math.round(volumeAdjustmentFactor * 100)}%`}
            </Text>
          )}

          <View style={styles.actions}>
            <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={handleAddDrink}>
              <Text style={styles.btnPrimaryText}>술 추가</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btn} onPress={handleSavePlace}>
              <Text style={styles.btnText}>술자리 저장</Text>
            </TouchableOpacity>
          </View>
          {!!errors.drinks && <Text style={styles.error}>{errors.drinks}</Text>}

          {(allPlaces.length > 0 || totalDrinkCount > 0) && (
            <View style={styles.sessionBox}>
              <Text style={styles.sessionTitle}>오늘 밤 누적</Text>
              <Text style={styles.sessionSummary}>
                술자리 {allPlaces.length}곳 · 술 {totalDrinkCount}개 · 순수 알코올 {totalAlcoholGrams.toFixed(1)}g
              </Text>
              {allPlaces.map((place) => (
                <View key={place.id} style={styles.placeBlock}>
                  <Text style={styles.placeName}>{place.name}</Text>
                  {place.drinks.map((drink) => (
                    <Text key={drink.id} style={styles.drinkLine}>
                      {drink.drinkLabel} {formatVolume(drink)} · {drink.percent}% · {drink.alcGrams.toFixed(1)}g
                    </Text>
                  ))}
                </View>
              ))}
            </View>
          )}

          <Text style={styles.label}>다음 기상 시각 (HH:MM)</Text>
          <TextInput style={styles.input} value={wakeTime} onChangeText={setWakeTime} placeholder="예: 08:30" />
          {!!errors.wakeTime && <Text style={styles.error}>{errors.wakeTime}</Text>}
          <Text style={styles.helperText}>오늘 저녁부터 내일 새벽까지 마신 술을 하나의 밤으로 보고 합산합니다.</Text>

          {profileReady ? (
            <Text style={styles.profileSummary}>
              내 정보: {profile.sex === 'male' ? '남성' : '여성'} · {profile.weight}kg
            </Text>
          ) : (
            <View style={styles.caution}>
              <Text style={styles.cautionText}>
                계산을 위해 체중과 성별 정보가 필요합니다. <Link href="/profile" style={styles.cautionLink}>내 정보 탭</Link>에서 먼저 입력해 주세요.
              </Text>
            </View>
          )}
          {!!errors.profile && <Text style={styles.error}>{errors.profile}</Text>}

          <Text style={styles.label}>빈속 음주 여부</Text>
          <View style={styles.chipRow}>
            <Chip label="빈속" selected={emptyStomach === 'fasting'} onPress={() => setEmptyStomach('fasting')} />
            <Chip label="식사함" selected={emptyStomach === 'fed'} onPress={() => setEmptyStomach('fed')} />
          </View>

          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary, !profileReady && styles.btnDisabled]}
              onPress={handleCalculate}
              disabled={!profileReady}
            >
              <Text style={styles.btnPrimaryText}>밤 전체 계산</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btn} onPress={handleReset}>
              <Text style={styles.btnText}>초기화</Text>
            </TouchableOpacity>
          </View>

          {result && (
            <View style={styles.result}>
              <Text style={styles.resultTitle}>누적 결과</Text>
              <Text style={styles.resultLead}>
                술자리 {result.placeCount}곳에서 {result.drinkCount}개 술을 합산했습니다. 더 마실수록 순수 알코올과 BAC가 누적되어 숙취 단계가 올라갈 수 있습니다.
              </Text>
              <View style={styles.resultGrid}>
                <View style={styles.resultCell}>
                  <Text style={styles.resultLabel}>순수 알코올</Text>
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
                  <Text style={styles.resultLabel}>예상 회복 시간</Text>
                  <Text style={styles.resultValue}>{result.eliminationTime.toFixed(1)}시간</Text>
                </View>
              </View>

              {calibrationOffset !== 0 && (
                <Text style={styles.calibrationNote}>
                  이전 실제 숙취 기록을 반영해 기본 예측 {result.predictedLevel}단계를 보정했습니다.
                </Text>
              )}

              {result.emptyStomach === 'fasting' && (
                <View style={styles.caution}>
                  <Text style={styles.cautionText}>빈속 음주는 알코올 흡수가 더 빠르게 느껴질 수 있어 물과 음식을 함께 챙기는 편이 좋습니다.</Text>
                </View>
              )}

              <View style={styles.guide}>
                <Text style={styles.guideTitle}>숙취 관리 가이드</Text>
                {result.guides.map((item) => (
                  <Text key={item} style={styles.guideItem}>· {item}</Text>
                ))}
              </View>

              <TouchableOpacity style={[styles.btn, styles.btnSave, saved && styles.btnSaved]} onPress={handleSaveRecord} disabled={saved}>
                <Text style={saved ? styles.btnSavedText : styles.btnPrimaryText}>{saved ? '기록 저장됨' : '오늘 밤 기록 저장하기'}</Text>
              </TouchableOpacity>

              <Text style={styles.safety}>
                이 결과는 입력값 기반의 단순 추정치입니다. 실제 혈중알코올농도와 숙취 정도는 개인 건강 상태, 음식, 수면, 음주 속도에 따라 달라집니다. 계산 결과와 관계없이 음주 후에는 운전하지 마세요.
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f4f4f2' },
  scroll: { flexGrow: 1, alignItems: 'center', padding: 20 },
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
  header: { alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#e6e6e6', borderStyle: 'dashed', paddingBottom: 12, marginBottom: 12 },
  title: { fontSize: 22, fontWeight: '700', letterSpacing: 1, color: '#2b2b2b' },
  subtitle: { marginTop: 6, fontSize: 13, color: '#6b6b6b', textAlign: 'center' },
  label: { fontWeight: '600', marginTop: 12, marginBottom: 6, color: '#2b2b2b' },
  input: { borderWidth: 1, borderColor: '#d6d6d6', borderStyle: 'dashed', borderRadius: 4, padding: 10, fontSize: 15, color: '#2b2b2b' },
  inputDisabled: { backgroundColor: '#f0f0f0', color: '#999' },
  error: { color: '#c0392b', fontSize: 12, marginTop: 4 },
  recommendHint: { color: '#0a7ea4', fontSize: 12, marginTop: 4 },
  helperText: { color: '#6b6b6b', fontSize: 12, marginTop: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 6, borderWidth: 1, borderColor: '#cfcfcf', backgroundColor: '#fff', marginRight: 6, marginBottom: 6 },
  chipSelected: { backgroundColor: '#111', borderColor: '#111' },
  chipText: { color: '#2b2b2b', fontSize: 13 },
  chipTextSelected: { color: '#fff' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 6, borderWidth: 1, borderColor: '#cfcfcf', backgroundColor: '#fff', alignItems: 'center', marginRight: 8 },
  btnPrimary: { backgroundColor: '#111', borderColor: '#111', marginRight: 0 },
  btnDisabled: { backgroundColor: '#cfcfcf', borderColor: '#cfcfcf' },
  btnText: { color: '#2b2b2b', fontWeight: '600' },
  btnPrimaryText: { color: '#fff', fontWeight: '600' },
  btnSave: { backgroundColor: '#0a7ea4', borderColor: '#0a7ea4', marginTop: 16, marginRight: 0 },
  btnSaved: { backgroundColor: '#e7f3f6', borderColor: '#0a7ea4' },
  btnSavedText: { color: '#0a7ea4', fontWeight: '600' },
  sessionBox: { marginTop: 16, padding: 12, borderWidth: 1, borderColor: '#e6e6e6', borderRadius: 6, backgroundColor: '#fafafa' },
  sessionTitle: { fontSize: 15, fontWeight: '700', color: '#2b2b2b' },
  sessionSummary: { fontSize: 12, color: '#0a7ea4', marginTop: 4, marginBottom: 8 },
  placeBlock: { borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 8, marginTop: 8 },
  placeName: { fontSize: 13, fontWeight: '700', color: '#2b2b2b', marginBottom: 4 },
  drinkLine: { fontSize: 12, color: '#6b6b6b', lineHeight: 18 },
  result: { marginTop: 20, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#eee' },
  resultTitle: { fontSize: 17, fontWeight: '700', marginBottom: 6 },
  resultLead: { fontSize: 13, color: '#6b6b6b', lineHeight: 19, marginBottom: 10 },
  resultGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  resultCell: { width: '47%', backgroundColor: '#fafafa', borderWidth: 1, borderColor: '#eee', borderRadius: 4, padding: 10, marginBottom: 10 },
  resultLabel: { fontSize: 12, fontWeight: '600', color: '#2b2b2b', marginBottom: 4 },
  resultValue: { fontSize: 15, color: '#2b2b2b' },
  calibrationNote: { fontSize: 12, color: '#0a7ea4', marginTop: -2, marginBottom: 10 },
  caution: { backgroundColor: '#fff6f6', borderWidth: 1, borderColor: '#ffd6d6', borderRadius: 6, padding: 10, marginTop: 10 },
  cautionText: { color: '#c0392b', fontSize: 13, lineHeight: 19 },
  cautionLink: { color: '#0a7ea4', fontWeight: '600', textDecorationLine: 'underline' },
  profileSummary: { marginTop: 12, fontSize: 13, color: '#6b6b6b' },
  guide: { marginTop: 12 },
  guideTitle: { fontWeight: '700', marginBottom: 6 },
  guideItem: { fontSize: 13, color: '#2b2b2b', marginBottom: 4, lineHeight: 20 },
  safety: { fontSize: 12, color: '#6b6b6b', marginTop: 12, lineHeight: 18 },
});
