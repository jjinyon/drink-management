import { useFocusEffect } from '@react-navigation/native';
import React, { useCallback, useMemo, useState } from 'react';
import {
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { LEVEL_NAMES } from '@/lib/hangover';
import { DrinkEntry, DrinkRecord, getNightKey, getRecords, setRecordFeedback, summarizePlaces } from '@/lib/records';

const CHART_MAX_HEIGHT = 100;

function formatNightLabel(key: string) {
  const [year, month, day] = key.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  const weekday = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
  return `${month}월 ${day}일(${weekday}) 밤`;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatShortDate(record: DrinkRecord) {
  const key = record.nightKey ?? getNightKey(new Date(record.createdAt));
  const [, month, day] = key.split('-');
  return `${Number(month)}/${Number(day)}`;
}

function formatVolume(entry: DrinkEntry) {
  return entry.volumeUnit === 'bottle' ? `${entry.volume}병` : `${entry.volume}ml`;
}

function Chart({ records }: { records: DrinkRecord[] }) {
  const recent = records.slice(-14);
  if (recent.length === 0) return null;

  return (
    <View style={styles.chartCard}>
      <Text style={styles.chartTitle}>숙취 지수 추이 (최근 {recent.length}건)</Text>
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#cfd8dc' }]} />
          <Text style={styles.legendText}>예측 지수</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, { backgroundColor: '#0a7ea4' }]} />
          <Text style={styles.legendText}>실제 지수</Text>
        </View>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.chartRow}>
          {recent.map((r) => (
            <View key={r.id} style={styles.chartCol}>
              <View style={styles.barGroup}>
                <View style={[styles.bar, styles.barPredicted, { height: Math.max(4, (r.calibratedLevel / 5) * CHART_MAX_HEIGHT) }]} />
                <View style={[styles.bar, styles.barActual, { height: r.actualLevel ? Math.max(4, (r.actualLevel / 5) * CHART_MAX_HEIGHT) : 0 }]} />
              </View>
              <Text style={styles.chartDate}>{formatShortDate(r)}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function RecordItem({ record, onRate }: { record: DrinkRecord; onRate: (id: string, level: number) => void }) {
  const summary = summarizePlaces(record);
  const hasPlaces = !!record.places && record.places.length > 0;

  return (
    <View style={styles.recordItem}>
      <View style={styles.recordHeader}>
        <Text style={styles.recordDrink}>
          {hasPlaces ? `술자리 ${summary.placeCount}곳 · 술 ${summary.drinkCount}개` : `${record.drinkLabel} · ${record.volumeUnit === 'bottle' ? `${record.volume}병` : `${record.volume}ml`}`}
        </Text>
        <Text style={styles.recordTime}>{formatTime(record.createdAt)}</Text>
      </View>
      <Text style={styles.recordSub}>
        순수 알코올 {record.alcGrams.toFixed(1)}g · 예상 숙취 {record.calibratedLevel}단계 ({LEVEL_NAMES[record.calibratedLevel]}) · BAC {record.bac.toFixed(3)}%
      </Text>

      {record.places?.map((place) => (
        <View key={place.id} style={styles.placeBlock}>
          <Text style={styles.placeName}>{place.name}</Text>
          {place.drinks.map((drink) => (
            <Text key={drink.id} style={styles.drinkLine}>
              {drink.drinkLabel} {formatVolume(drink)} · {drink.percent}% · {drink.alcGrams.toFixed(1)}g
            </Text>
          ))}
        </View>
      ))}

      {typeof record.actualLevel === 'number' ? (
        <Text style={styles.recordActual}>실제 숙취: {record.actualLevel}단계 ({LEVEL_NAMES[record.actualLevel]})</Text>
      ) : (
        <View style={styles.feedbackRow}>
          <Text style={styles.feedbackLabel}>실제 숙취는 어땠나요?</Text>
          <View style={styles.feedbackChips}>
            {[1, 2, 3, 4, 5].map((lvl) => (
              <TouchableOpacity key={lvl} style={styles.feedbackChip} onPress={() => onRate(record.id, lvl)}>
                <Text style={styles.feedbackChipText}>{lvl}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}
    </View>
  );
}

export default function HistoryScreen() {
  const [records, setRecords] = useState<DrinkRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const data = await getRecords();
    data.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    setRecords(data);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function handleRate(id: string, level: number) {
    await setRecordFeedback(id, level);
    load();
  }

  const grouped = useMemo(() => {
    const byNight = new Map<string, DrinkRecord[]>();
    [...records].reverse().forEach((r) => {
      const key = r.nightKey ?? getNightKey(new Date(r.createdAt));
      if (!byNight.has(key)) byNight.set(key, []);
      byNight.get(key)!.push(r);
    });
    return Array.from(byNight.entries());
  }, [records]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>기록 히스토리</Text>
            <Text style={styles.subtitle}>저녁부터 새벽까지를 한 번의 밤으로 묶어 확인합니다.</Text>
          </View>

          {!loading && records.length === 0 && <Text style={styles.empty}>아직 저장된 기록이 없어요. 홈에서 오늘 밤 기록을 저장해 보세요.</Text>}

          {records.length > 0 && (
            <>
              <Chart records={records} />
              {grouped.map(([nightKey, nightRecords]) => (
                <View key={nightKey} style={styles.daySection}>
                  <Text style={styles.dayLabel}>{formatNightLabel(nightKey)}</Text>
                  {nightRecords.map((r) => (
                    <RecordItem key={r.id} record={r} onRate={handleRate} />
                  ))}
                </View>
              ))}
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f4f4f2' },
  scroll: { flexGrow: 1, alignItems: 'center', padding: 20 },
  card: {
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
  empty: { fontSize: 13, color: '#6b6b6b', textAlign: 'center', marginTop: 20 },
  chartCard: { marginTop: 6, marginBottom: 16, paddingBottom: 4 },
  chartTitle: { fontSize: 15, fontWeight: '700', color: '#2b2b2b', marginBottom: 8 },
  legendRow: { flexDirection: 'row', gap: 14, marginBottom: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11, color: '#6b6b6b' },
  chartRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 14, paddingBottom: 4 },
  chartCol: { alignItems: 'center', width: 36 },
  barGroup: { flexDirection: 'row', alignItems: 'flex-end', height: CHART_MAX_HEIGHT, gap: 4 },
  bar: { width: 10, borderRadius: 3 },
  barPredicted: { backgroundColor: '#cfd8dc' },
  barActual: { backgroundColor: '#0a7ea4' },
  chartDate: { fontSize: 10, color: '#8a8a8a', marginTop: 6 },
  daySection: { marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#eee' },
  dayLabel: { fontSize: 14, fontWeight: '700', color: '#2b2b2b', marginBottom: 8 },
  recordItem: { backgroundColor: '#fafafa', borderWidth: 1, borderColor: '#eee', borderRadius: 6, padding: 12, marginBottom: 10 },
  recordHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  recordDrink: { flex: 1, fontSize: 14, fontWeight: '600', color: '#2b2b2b' },
  recordTime: { fontSize: 12, color: '#8a8a8a' },
  recordSub: { fontSize: 12, color: '#6b6b6b', marginTop: 4, lineHeight: 18 },
  placeBlock: { borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 8, marginTop: 8 },
  placeName: { fontSize: 13, fontWeight: '700', color: '#2b2b2b', marginBottom: 4 },
  drinkLine: { fontSize: 12, color: '#6b6b6b', lineHeight: 18 },
  recordActual: { fontSize: 12, color: '#0a7ea4', fontWeight: '600', marginTop: 8 },
  feedbackRow: { marginTop: 8 },
  feedbackLabel: { fontSize: 12, color: '#2b2b2b', marginBottom: 6 },
  feedbackChips: { flexDirection: 'row', gap: 8 },
  feedbackChip: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: '#0a7ea4', alignItems: 'center', justifyContent: 'center' },
  feedbackChipText: { color: '#0a7ea4', fontWeight: '600', fontSize: 13 },
});
