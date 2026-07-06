// 계산 관련 함수들을 역할별로 분리합니다.
// getDistributionRatio: 성별에 따라 위드마크 분포계수 r 반환
function getDistributionRatio(sex){
  return sex === 'male' ? 0.68 : 0.55;
}

// calculateAlcoholGrams: 섭취량(ml)과 도수(%)로 순수 알코올(g) 계산
// 공식: 알코올량(g) = 섭취량(ml) × (도수 / 100) × 0.789
function calculateAlcoholGrams(volumeMl, percent){
  return volumeMl * (percent / 100) * 0.789;
}

// calculateBAC: 알코올그램, 체중(kg), r -> BAC(%) 계산
// 체중은 kg -> g 변환
// BAC(%) = (알코올량(g) / (체중(g) × r)) × 100
function calculateBAC(alcoholGrams, weightKg, r){
  const weightG = weightKg * 1000;
  return (alcoholGrams / (weightG * r)) * 100;
}

// calculateEliminationTime: BAC를 시간으로 변환 (h)
// 공식: 예상 해소 시간(h) = BAC / 0.015
function calculateEliminationTime(bac){
  return bac / 0.015;
}

// classifyHangoverLevel: BAC를 1~5 단계로 분류
function classifyHangoverLevel(bac){
  if (bac < 0.03) return 1;
  if (bac < 0.06) return 2;
  if (bac < 0.10) return 3;
  if (bac < 0.15) return 4;
  return 5;
}

// getRecoveryGuide: 단계별 관리 가이드 반환
function getRecoveryGuide(level){
  const guides = {
    1:["물을 충분히 마시기","가벼운 식사하기","평소 수면 시간 확보하기"],
    2:["물이나 이온 음료 마시기","자극적이지 않은 음식 섭취하기","충분한 수면 취하기"],
    3:["수분과 전해질을 천천히 보충하기","죽, 바나나, 토스트 등 부담이 적은 음식 먹기","추가 음주를 피하고 충분히 휴식하기"],
    4:["무리한 운동과 운전을 피하기","조금씩 자주 수분을 섭취하기","심한 구토나 어지럼증이 지속되면 주변 사람에게 알리기"],
    5:["혼자 있지 않기","운전이나 위험한 활동을 절대 하지 않기","의식 저하, 호흡 이상, 반복적인 구토 등의 증상이 있으면 즉시 119 또는 의료기관의 도움을 받기"]
  };
  return guides[level] || [];
}

// validateInputs: 입력값 검증 후 에러 객체 반환
function validateInputs(values){
  const errors = {};
  if (values.percent === '' || values.percent === null || isNaN(values.percent)){
    errors.percent = '도수를 입력해 주세요.';
  } else if (values.percent <= 0 || values.percent > 100){
    errors.percent = '도수는 0보다 크고 100 이하여야 합니다.';
  }
  if (values.volume === '' || values.volume === null || isNaN(values.volume) || values.volume <= 0){
    errors.volume = '섭취량은 0보다 커야 합니다.';
  }
  if (values.hours === '' || values.hours === null || isNaN(values.hours) || values.hours <= 0){
    errors.hours = '음주 시간은 0보다 커야 합니다.';
  }
  if (values.weight === '' || values.weight === null || isNaN(values.weight) || values.weight <= 0){
    errors.weight = '체중을 정확히 입력해 주세요.';
  }
  if (!values.sex){
    errors.sex = '성별을 선택해 주세요.';
  }
  return errors;
}

// renderResult: 계산 결과를 화면에 표시
function renderResult(data){
  document.getElementById('alcGrams').textContent = data.alcGrams.toFixed(1) + ' g';
  document.getElementById('bac').textContent = data.bac.toFixed(3) + ' %';
  document.getElementById('level').textContent = data.level;
  document.getElementById('levelName').textContent = data.levelName;
  document.getElementById('elimination').textContent = data.eliminationTime.toFixed(1) + ' 시간';

  const guideList = document.getElementById('guideList');
  guideList.innerHTML = '';
  data.guides.forEach(item => {
    const li = document.createElement('li');
    li.textContent = item;
    guideList.appendChild(li);
  });

  // 공복 경고 문구
  const emptyWarning = document.getElementById('emptyWarning');
  if (data.emptyStomach === 'fasting'){
    emptyWarning.textContent = '공복 음주는 알코올 흡수가 더 빠르게 느껴질 수 있으므로 충분한 식사와 수분 섭취가 필요합니다.';
    emptyWarning.hidden = false;
  } else {
    emptyWarning.hidden = true;
  }

  document.getElementById('result').hidden = false;
}

// resetForm: 폼 초기화 및 결과 숨기기
function resetForm(){
  document.getElementById('drinkForm').reset();
  document.getElementById('result').hidden = true;
  document.getElementById('form-error').textContent = '';
  ['percent','volume','hours','weight','sex'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.classList && el.classList.remove('invalid');
  });
  // clear error messages
  ['error-percent','error-volume','error-hours','error-weight','error-sex'].forEach(id => {
    const e = document.getElementById(id);
    if (e) e.textContent = '';
  });
}

// 초기화: 도수 자동 입력 처리 및 이벤트 연결
document.addEventListener('DOMContentLoaded', ()=>{
  const drinkType = document.getElementById('drinkType');
  const percent = document.getElementById('percent');
  const calculateBtn = document.getElementById('calculateBtn');
  const resetBtn = document.getElementById('resetBtn');

  // 기본 선택 값 설정
  function applyDefaultPercent(){
    const opt = drinkType.selectedOptions[0];
    const p = opt.dataset.percent;
    if (p !== undefined && p !== ''){
      percent.value = p;
    } else {
      percent.value = '';
    }
  }
  applyDefaultPercent();

  drinkType.addEventListener('change', ()=>{
    applyDefaultPercent();
  });

  // 계산 버튼 클릭
  calculateBtn.addEventListener('click', ()=>{
    // clear previous errors
    ['error-percent','error-volume','error-hours','error-weight','error-sex'].forEach(id=>{
      const e = document.getElementById(id); if(e) e.textContent = '';
    });

    const values = {
      drinkType: drinkType.value,
      percent: parseFloat(percent.value),
      volume: parseFloat(document.getElementById('volume').value),
      hours: parseFloat(document.getElementById('hours').value),
      weight: parseFloat(document.getElementById('weight').value),
      sex: (document.querySelector('input[name="sex"]:checked') || {}).value,
      emptyStomach: (document.querySelector('input[name="emptyStomach"]:checked') || {}).value
    };

    const errors = validateInputs(values);
    if (Object.keys(errors).length > 0){
      // show errors inline
      if (errors.percent) document.getElementById('error-percent').textContent = errors.percent;
      if (errors.volume) document.getElementById('error-volume').textContent = errors.volume;
      if (errors.hours) document.getElementById('error-hours').textContent = errors.hours;
      if (errors.weight) document.getElementById('error-weight').textContent = errors.weight;
      if (errors.sex) document.getElementById('error-sex').textContent = errors.sex;
      document.getElementById('result').hidden = true;
      return;
    }

    // 계산 수행
    const alcGrams = calculateAlcoholGrams(values.volume, values.percent);
    const r = getDistributionRatio(values.sex);
    const bac = calculateBAC(alcGrams, values.weight, r);
    const elimination = calculateEliminationTime(bac);
    const level = classifyHangoverLevel(bac);
    const levelNames = {1:'거의 없음',2:'경미',3:'보통',4:'심함',5:'매우 심함'};
    const guides = getRecoveryGuide(level);

    const data = {
      alcGrams: alcGrams,
      bac: bac,
      eliminationTime: elimination,
      level: level,
      levelName: levelNames[level],
      guides: guides,
      emptyStomach: values.emptyStomach
    };

    renderResult(data);
  });

  resetBtn.addEventListener('click', ()=>{
    resetForm();
    applyDefaultPercent();
  });
});
