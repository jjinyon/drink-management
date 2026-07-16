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

function formatVolume(entry: DrinkEntry) {
  return entry.volumeUnit === 'bottle' ? `${entry.volume}병` : `${entry.volume}ml`;
}

const HOUR_MS = 1000 * 60 * 60;

function getDrinkingDurationHours(places: DrinkingPlace[]): number {
  const timestamps = places
    .flatMap((place) => place.drinks.map((drink) => drink.recordedAt ?? place.startedAt))
    .map((value) => new Date(value).getTime())
    .filter((value) => !Number.isNaN(value));

  if (timestamps.length === 0) return 1;

  const firstRecordedAt = Math.min(...timestamps);
  const lastRecordedAt = Math.max(...timestamps);
  return Math.max(1, (lastRecordedAt - firstRecordedAt) / HOUR_MS + 1);
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

type Prediction = {
  result: Result;
  record: DrinkRecord;
};

export default function App() {
  const [screenMode, setScreenMode] = useState<'record' | 'prediction'>('record');
  const [drinkType, setDrinkType] = useState('soju');
  const [percent, setPercent] = useState('16');
  const [volume, setVolume] = useState('');
  const [volumeUnit, setVolumeUnit] = useState<VolumeUnit>('ml');
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

  function buildPrediction(nextPlaces: DrinkingPlace[]): Prediction | null {
    if (!profileReady) {
      setErrors({ profile: '[내 정보] 탭에서 체중과 성별을 먼저 입력해 주세요.' });
      return null;
    }

    const flatDrinks = nextPlaces.flatMap((place) => place.drinks);
    if (flatDrinks.length === 0) {
      setErrors({ drinks: '오늘 밤 마신 술을 하나 이상 추가해 주세요.' });
      return null;
    }

    const drinkingDurationHours = getDrinkingDurationHours(nextPlaces);
    const values = {
      percent: 1,
      volume: 1,
      hours: drinkingDurationHours,
      weight: profile.weight as number,
      sex: profile.sex,
      emptyStomach,
    };
    const newErrors = validateInputs(values);
    delete newErrors.percent;
    delete newErrors.volume;
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return null;
    }

    const alcoholGrams = nextPlaces.reduce(
      (sum, place) => sum + place.drinks.reduce((drinkSum, drink) => drinkSum + drink.alcGrams, 0),
      0,
    );
    const r = getDistributionRatio(values.sex as Sex);
    const bac = calculateBAC(alcoholGrams, values.weight, r);
    const bacEliminationTime = calculateEliminationTime(bac);
    const elimination = Math.max(bacEliminationTime, drinkingDurationHours);
    const predictedLevel = classifyHangoverLevel(bac);
    const calibratedLevel = applyCalibration(predictedLevel, calibrationOffset);
    const guides = getRecoveryGuide(calibratedLevel);
    const savedPlaces: DrinkingPlace[] = nextPlaces.map((place) => ({
      ...place,
      id: place.id === 'draft' ? generateId() : place.id,
    }));
    const savedDrinks = savedPlaces.flatMap((place) => place.drinks);
    const firstDrink = savedDrinks[0];

    return {
      result: {
        alcGrams: alcoholGrams,
        bac,
        eliminationTime: elimination,
        predictedLevel,
        calibratedLevel,
        levelName: LEVEL_NAMES[calibratedLevel],
        guides,
        emptyStomach: values.emptyStomach,
        drinkCount: savedDrinks.length,
        placeCount: savedPlaces.length,
      },
      record: {
        id: generateId(),
        createdAt: new Date().toISOString(),
        nightKey: getNightKey(),
        places: savedPlaces,
        drinkType: firstDrink.drinkType,
        drinkLabel: `${savedPlaces.length}개 술자리 누적`,
        percent: firstDrink.percent,
        volume: savedDrinks.reduce((sum, drink) => sum + drink.volumeMl, 0),
        volumeUnit: 'ml',
        volumeMl: savedDrinks.reduce((sum, drink) => sum + drink.volumeMl, 0),
        hours: drinkingDurationHours,
        weight: values.weight,
        sex: values.sex as Sex,
        emptyStomach: values.emptyStomach,
        alcGrams: alcoholGrams,
        bac,
        eliminationTime: elimination,
        predictedLevel,
        calibratedLevel,
      },
    };
  }

  function applyPrediction(nextPlaces: DrinkingPlace[]) {
    const prediction = buildPrediction(nextPlaces);
    if (!prediction) {
      setResult(null);
      setPendingRecord(null);
      return;
    }

    setResult(prediction.result);
    setPendingRecord(prediction.record);
    setSaved(false);
    setErrors({});
    setScreenMode('prediction');
  }

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
    const nextDrink: DrinkEntry = {
      id: generateId(),
      recordedAt: new Date().toISOString(),
      drinkType: found ? found.key : 'custom',
      drinkLabel: found ? found.label : '직접 입력',
      percent: values.percent,
      volume: values.volume,
      volumeUnit,
      volumeMl,
      alcGrams,
    };
    const nextCurrentDrinks = [...currentDrinks, nextDrink];
    const trimmedName = placeName.trim() || `${places.length + 1}차`;
    const nextAllPlaces: DrinkingPlace[] = [
      ...places,
      { id: 'draft', name: trimmedName, startedAt: new Date().toISOString(), drinks: nextCurrentDrinks },
    ];
    setCurrentDrinks(nextCurrentDrinks);
    setVolume('');
    applyPrediction(nextAllPlaces);
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
    setScreenMode('record');
  }

  function handleCalculate() {
    applyPrediction(allPlaces);
  }

  function handleContinueDrinking() {
    if (currentDrinks.length > 0) {
      handleSavePlace();
      return;
    }
    setScreenMode('record');
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
    setPlaceName('1차');
    setCurrentDrinks([]);
    setPlaces([]);
    setEmptyStomach(null);
    setErrors({});
    setResult(null);
    setPendingRecord(null);
    setSaved(false);
    setScreenMode('record');
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.receipt}>
          <View style={styles.header}>
            <Text style={styles.title}>술기록</Text>
            <Text style={styles.subtitle}>
              {screenMode === 'record' ? '술자리에서 마신 술의 양을 기록하세요.' : '지금까지 마신 술을 기준으로 예측했습니다.'}
            </Text>
          </View>

          {screenMode === 'record' ? (
            <View>
              <Text style={styles.screenLabel}>기록 화면</Text>

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
                <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={handleAddDrink}>
                  <Text style={styles.btnPrimaryText}>기록하고 예측 보기</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.btn} onPress={handleSavePlace}>
                  <Text style={styles.btnText}>다음 술자리</Text>
                </TouchableOpacity>
              </View>
              {!!errors.drinks && <Text style={styles.error}>{errors.drinks}</Text>}

              {(allPlaces.length > 0 || totalDrinkCount > 0) && (
                <View style={styles.sessionBox}>
                  <Text style={styles.sessionTitle}>지금까지 기록</Text>
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

              <Text style={styles.helperText}>시간은 첫 기록부터 마지막 기록까지의 차이에 기본 술자리 1시간을 더해 계산합니다.</Text>

              <View style={styles.actions}>
                <TouchableOpacity
                  style={[styles.btn, !profileReady && styles.btnDisabled]}
                  onPress={handleCalculate}
                  disabled={!profileReady}
                >
                  <Text style={styles.btnText}>누적 예측만 보기</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.btn} onPress={handleReset}>
                  <Text style={styles.btnText}>초기화</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : result ? (
            <View style={styles.result}>
              <Text style={styles.screenLabel}>예측 화면</Text>
              <Text style={styles.resultTitle}>지금 기준 예상 숙취</Text>
              <Text style={styles.resultLead}>
                지금까지 술자리 {result.placeCount}곳에서 {result.drinkCount}개 술을 기록했습니다. 이 정도 숙취면 더 마실지, 여기서 멈출지 판단해 보세요.
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

              <View style={styles.lastCallBox}>
                <Text style={styles.lastCallTitle}>마지막 술자리인가요?</Text>
                <Text style={styles.lastCallText}>더 먹어도 되겠다 싶으면 계속 기록하고, 여기서 멈추려면 오늘 밤 기록을 저장하세요.</Text>
                <View style={styles.actions}>
                  <TouchableOpacity style={styles.btn} onPress={handleContinueDrinking}>
                    <Text style={styles.btnText}>더 기록하기</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.btn, styles.btnSave, styles.btnSaveInline, saved && styles.btnSaved]} onPress={handleSaveRecord} disabled={saved}>
                    <Text style={saved ? styles.btnSavedText : styles.btnPrimaryText}>{saved ? '기록 저장됨' : '마지막, 저장'}</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <Text style={styles.safety}>
                이 결과는 입력값 기반의 단순 추정치입니다. 실제 혈중알코올농도와 숙취 정도는 개인 건강 상태, 음식, 수면, 음주 속도에 따라 달라집니다. 계산 결과와 관계없이 음주 후에는 운전하지 마세요.
              </Text>
            </View>
          ) : (
            <View>
              <Text style={styles.error}>예측할 기록이 없습니다. 먼저 술을 기록해 주세요.</Text>
              <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={() => setScreenMode('record')}>
                <Text style={styles.btnPrimaryText}>기록 화면으로</Text>
              </TouchableOpacity>
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
  screenLabel: { alignSelf: 'flex-start', paddingVertical: 5, paddingHorizontal: 8, borderRadius: 4, backgroundColor: '#f0f7fa', color: '#0a7ea4', fontSize: 12, fontWeight: '700', overflow: 'hidden' },
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
  btnSaveInline: { marginTop: 0 },
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
  lastCallBox: { marginTop: 14, padding: 12, borderWidth: 1, borderColor: '#d7e8ee', borderRadius: 6, backgroundColor: '#f4fbfd' },
  lastCallTitle: { fontSize: 14, fontWeight: '700', color: '#2b2b2b', marginBottom: 4 },
  lastCallText: { fontSize: 12, color: '#6b6b6b', lineHeight: 18 },
  safety: { fontSize: 12, color: '#6b6b6b', marginTop: 12, lineHeight: 18 },
});
