import { useFocusEffect } from '@react-navigation/native';
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
  calculateAlcoholGrams,
  calculateBAC,
  calculateEliminationTime,
  classifyHangoverLevel,
  getDistributionRatio,
  getRecoveryGuide,
  validateInputs,
} from '@/lib/hangover';
import {
  DrinkRecord,
  addRecord,
  applyCalibration,
  generateId,
  getCalibrationOffset,
  getRecords,
} from '@/lib/records';

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
  const [hours, setHours] = useState('');
  const [weight, setWeight] = useState('');
  const [sex, setSex] = useState<Sex | null>(null);
  const [emptyStomach, setEmptyStomach] = useState<StomachState | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [calibrationOffset, setCalibrationOffset] = useState(0);
  const [pendingRecord, setPendingRecord] = useState<DrinkRecord | null>(null);
  const [saved, setSaved] = useState(false);

  useFocusEffect(
    useCallback(() => {
      getRecords().then((records) => setCalibrationOffset(getCalibrationOffset(records)));
    }, []),
  );

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
    const values = {
      percent: parseFloat(percent),
      volume: parseFloat(volume),
      hours: parseFloat(hours),
      weight: parseFloat(weight),
      sex,
      emptyStomach,
    };

    const newErrors = validateInputs(values);
    setErrors(newErrors);

    if (Object.keys(newErrors).length > 0) {
      setResult(null);
      setPendingRecord(null);
      return;
    }

    const alcGrams = calculateAlcoholGrams(values.volume, values.percent);
    const r = getDistributionRatio(values.sex as Sex);
    const bac = calculateBAC(alcGrams, values.weight, r);
    const elimination = calculateEliminationTime(bac);
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
      hours: values.hours,
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
    setHours('');
    setWeight('');
    setSex(null);
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
          <Text style={styles.label}>섭취량 (ml)</Text>
          <TextInput
            style={styles.input}
            keyboardType="decimal-pad"
            value={volume}
            onChangeText={setVolume}
            placeholder="예: 360"
          />
          {!!errors.volume && <Text style={styles.error}>{errors.volume}</Text>}

          {/* 음주 시간 */}
          <Text style={styles.label}>음주 시간 (시간)</Text>
          <TextInput
            style={styles.input}
            keyboardType="decimal-pad"
            value={hours}
            onChangeText={setHours}
            placeholder="예: 2"
          />
          {!!errors.hours && <Text style={styles.error}>{errors.hours}</Text>}

          {/* 체중 */}
          <Text style={styles.label}>체중 (kg)</Text>
          <TextInput
            style={styles.input}
            keyboardType="decimal-pad"
            value={weight}
            onChangeText={setWeight}
            placeholder="예: 65"
          />
          {!!errors.weight && <Text style={styles.error}>{errors.weight}</Text>}

          {/* 성별 */}
          <Text style={styles.label}>성별</Text>
          <View style={styles.chipRow}>
            <Chip label="남성" selected={sex === 'male'} onPress={() => setSex('male')} />
            <Chip label="여성" selected={sex === 'female'} onPress={() => setSex('female')} />
          </View>
          {!!errors.sex && <Text style={styles.error}>{errors.sex}</Text>}

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
            <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={handleCalculate}>
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
                  <Text style={styles.resultLabel}>예상 알코올 해소 시간</Text>
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
