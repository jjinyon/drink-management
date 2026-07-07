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

import { Sex } from '@/lib/hangover';
import { UserProfile, getProfile, saveProfile } from '@/lib/profile';

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function ProfileScreen() {
  const [height, setHeight] = useState('');
  const [weight, setWeight] = useState('');
  const [sex, setSex] = useState<Sex | null>(null);
  const [tolerance, setTolerance] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  useFocusEffect(
    useCallback(() => {
      getProfile().then((profile) => {
        setHeight(profile.height !== null ? String(profile.height) : '');
        setWeight(profile.weight !== null ? String(profile.weight) : '');
        setSex(profile.sex);
        setTolerance(profile.tolerance !== null ? String(profile.tolerance) : '');
        setSaved(false);
      });
    }, []),
  );

  async function handleSave() {
    const heightVal = parseFloat(height);
    const weightVal = parseFloat(weight);
    const toleranceVal = parseFloat(tolerance);

    const newErrors: Record<string, string> = {};
    if (!height || Number.isNaN(heightVal) || heightVal <= 0) {
      newErrors.height = '키를 정확히 입력해 주세요.';
    }
    if (!weight || Number.isNaN(weightVal) || weightVal <= 0) {
      newErrors.weight = '체중을 정확히 입력해 주세요.';
    }
    if (!sex) {
      newErrors.sex = '성별을 선택해 주세요.';
    }
    if (!tolerance || Number.isNaN(toleranceVal) || toleranceVal <= 0) {
      newErrors.tolerance = '본인 주량을 정확히 입력해 주세요.';
    }

    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) {
      setSaved(false);
      return;
    }

    const profile: UserProfile = {
      height: heightVal,
      weight: weightVal,
      sex,
      tolerance: toleranceVal,
    };
    await saveProfile(profile);
    setSaved(true);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.receipt}>
          <View style={styles.header}>
            <Text style={styles.title}>내 정보</Text>
            <Text style={styles.subtitle}>정확한 숙취 예측을 위해 나의 정보를 저장해 주세요.</Text>
          </View>

          <Text style={styles.label}>키 (cm)</Text>
          <TextInput
            style={styles.input}
            keyboardType="decimal-pad"
            value={height}
            onChangeText={(v) => {
              setHeight(v);
              setSaved(false);
            }}
            placeholder="예: 170"
          />
          {!!errors.height && <Text style={styles.error}>{errors.height}</Text>}

          <Text style={styles.label}>체중 (kg)</Text>
          <TextInput
            style={styles.input}
            keyboardType="decimal-pad"
            value={weight}
            onChangeText={(v) => {
              setWeight(v);
              setSaved(false);
            }}
            placeholder="예: 65"
          />
          {!!errors.weight && <Text style={styles.error}>{errors.weight}</Text>}

          <Text style={styles.label}>성별</Text>
          <View style={styles.chipRow}>
            <Chip
              label="남성"
              selected={sex === 'male'}
              onPress={() => {
                setSex('male');
                setSaved(false);
              }}
            />
            <Chip
              label="여성"
              selected={sex === 'female'}
              onPress={() => {
                setSex('female');
                setSaved(false);
              }}
            />
          </View>
          {!!errors.sex && <Text style={styles.error}>{errors.sex}</Text>}

          <Text style={styles.label}>본인 주량 (소주 기준, 병)</Text>
          <TextInput
            style={styles.input}
            keyboardType="decimal-pad"
            value={tolerance}
            onChangeText={(v) => {
              setTolerance(v);
              setSaved(false);
            }}
            placeholder="예: 1.5"
          />
          {!!errors.tolerance && <Text style={styles.error}>{errors.tolerance}</Text>}

          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary, saved && styles.btnSaved]}
              onPress={handleSave}
            >
              <Text style={saved ? styles.btnSavedText : styles.btnPrimaryText}>
                {saved ? '저장됨 ✓' : '저장하기'}
              </Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.safety}>
            저장된 정보는 이 기기에만 보관되며, 홈 화면에서 숙취 지수를 계산할 때 자동으로
            사용됩니다.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

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
  btnPrimaryText: {
    color: '#fff',
    fontWeight: '600',
  },
  btnSaved: {
    backgroundColor: '#e7f3f6',
    borderColor: '#0a7ea4',
  },
  btnSavedText: {
    color: '#0a7ea4',
    fontWeight: '600',
  },
  safety: {
    fontSize: 12,
    color: '#6b6b6b',
    marginTop: 16,
    lineHeight: 18,
  },
});
