/**
 * 모기지 계산기 - 2026
 * - FHA / VA / USDA / Conventional 지원
 * - 카운티별 자동 한도 적용
 * - MIP / PMI 자동 계산
 */

(function() {
  'use strict';

  // ─── 카운티 데이터 캐시 ───
  let countyData = null;
  let stateMap = {};  // {state: [[fips, name, fha, conf], ...]}

  // ─── 초기 로드 ───
  // ─── 초기 로드 ───
  fetch('/static/counties_limits.json')
    .then(r => r.json())
    .then(data => {
      countyData = data.counties;
      buildStateMap();
      populateStateSelect();
    })
    .catch(err => console.error('카운티 데이터 로드 실패:', err));

  function buildStateMap() {
    for (const [fips, info] of Object.entries(countyData)) {
      const state = info[1];
      if (!stateMap[state]) stateMap[state] = [];
      stateMap[state].push([fips, ...info]);
    }
    // 각 주별로 카운티 이름순 정렬
    for (const state in stateMap) {
      stateMap[state].sort((a, b) => a[1].localeCompare(b[1]));
    }
  }

  function populateStateSelect() {
    const sel = document.getElementById('stateSelect');
    const states = Object.keys(stateMap).sort();
    for (const s of states) {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s;
      sel.appendChild(opt);
    }
  }

  // ─── 이벤트 바인딩 ───
  const inputs = [
    'homePrice', 'downPayment', 'downPct', 'loanTerm', 'interestRate',
    'propertyTax', 'homeInsurance', 'hoa', 'loanType', 'stateSelect', 'countySelect'
  ];

  inputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', handleInput);
      el.addEventListener('change', handleInput);
    }
  });

  // ─── 입력 처리 ───
  function handleInput(e) {
    // 다운페이 비율 ↔ 금액 동기화
    if (e && e.target.id === 'downPct') {
      const price = parseFloat(document.getElementById('homePrice').value) || 0;
      const pct = parseFloat(document.getElementById('downPct').value) || 0;
      document.getElementById('downPayment').value = Math.round(price * pct / 100);
    } else if (e && e.target.id === 'downPayment') {
      const price = parseFloat(document.getElementById('homePrice').value) || 0;
      const dp = parseFloat(document.getElementById('downPayment').value) || 0;
      document.getElementById('downPct').value = price > 0
        ? (dp / price * 100).toFixed(2) : 0;
    } else if (e && e.target.id === 'homePrice') {
      // 가격 바뀌면 다운페이 재계산
      const price = parseFloat(document.getElementById('homePrice').value) || 0;
      const pct = parseFloat(document.getElementById('downPct').value) || 0;
      document.getElementById('downPayment').value = Math.round(price * pct / 100);
    } else if (e && e.target.id === 'loanType') {
      // 대출 타입별 최소 다운페이 자동 조정
      applyMinDownPayment(e.target.value);
    } else if (e && e.target.id === 'stateSelect') {
      populateCountySelect(e.target.value);
    }

    calculate();
  }

  function applyMinDownPayment(type) {
    const minPct = { conventional: 5, fha: 3.5, va: 0, usda: 0 }[type] || 3.5;
    const price = parseFloat(document.getElementById('homePrice').value) || 0;
    document.getElementById('downPct').value = minPct;
    document.getElementById('downPayment').value = Math.round(price * minPct / 100);
  }

  function populateCountySelect(state) {
    const sel = document.getElementById('countySelect');
    sel.innerHTML = '<option value="">-- Select County --</option>';

    if (!state || !stateMap[state]) return;

    for (const [fips, name, st, fha, conf] of stateMap[state]) {
      const opt = document.createElement('option');
      opt.value = fips;
      opt.textContent = name;
      opt.dataset.fha = fha;
      opt.dataset.conf = conf;
      sel.appendChild(opt);
    }
  }

  // ─── 계산 ───
  function calculate() {
    const price = parseFloat(document.getElementById('homePrice').value) || 0;
    const dp = parseFloat(document.getElementById('downPayment').value) || 0;
    const term = parseInt(document.getElementById('loanTerm').value) || 30;
    const rate = parseFloat(document.getElementById('interestRate').value) || 6.85;
    const taxPct = parseFloat(document.getElementById('propertyTax').value) || 0;
    const insYr = parseFloat(document.getElementById('homeInsurance').value) || 0;
    const hoaMo = parseFloat(document.getElementById('hoa').value) || 0;
    const loanType = document.getElementById('loanType').value;

    const loanAmount = Math.max(0, price - dp);

    if (loanAmount <= 0 || rate <= 0 || term <= 0) {
      resetOutputs();
      return;
    }

    // 월 이자율
    const monthlyRate = rate / 100 / 12;
    const n = term * 12;

    // P&I (원리금)
    const pi = loanAmount * monthlyRate * Math.pow(1 + monthlyRate, n)
             / (Math.pow(1 + monthlyRate, n) - 1);

    // 세금/보험
    const taxMo = price * taxPct / 100 / 12;
    const insMo = insYr / 12;

    // MIP/PMI 계산
    let mipMo = 0;
    let mipLabel = '';
    if (loanType === 'fha') {
      // FHA MIP: 연 0.55% (기본), LTV > 95%시 0.85%
      const ltv = loanAmount / price;
      const mipRate = ltv > 0.95 ? 0.0085 : 0.0055;
      mipMo = loanAmount * mipRate / 12;
      mipLabel = 'FHA MIP';
    } else if (loanType === 'conventional') {
      // PMI: LTV > 80%시 연 0.5~1.5%. 0.7% 가정
      const ltv = loanAmount / price;
      if (ltv > 0.8) {
        mipMo = loanAmount * 0.007 / 12;
        mipLabel = 'PMI (est.)';
      }
    }
    // VA, USDA는 MIP 없음

    const totalMonthly = pi + taxMo + insMo + mipMo + hoaMo;

    // 총 이자
    const totalPaid = pi * n;
    const totalInterest = totalPaid - loanAmount;

    // ─── 출력 ───
    document.getElementById('monthlyPayment').textContent = fmt(totalMonthly);
    document.getElementById('loanAmountInfo').textContent = 'Loan Amount: ' + fmt(loanAmount);

    document.getElementById('piAmount').textContent = fmt(pi);
    document.getElementById('taxAmount').textContent = fmt(taxMo);
    document.getElementById('insAmount').textContent = fmt(insMo);

    // MIP
    const mipRow = document.getElementById('mipRow');
    if (mipMo > 0) {
      mipRow.style.display = '';
      document.getElementById('mipLabel').textContent = mipLabel;
      document.getElementById('mipAmount').textContent = fmt(mipMo);
    } else {
      mipRow.style.display = 'none';
    }

    // HOA
    const hoaRow = document.getElementById('hoaRow');
    if (hoaMo > 0) {
      hoaRow.style.display = '';
      document.getElementById('hoaAmount').textContent = fmt(hoaMo);
    } else {
      hoaRow.style.display = 'none';
    }

    document.getElementById('totalMonthly').textContent = fmt(totalMonthly);
    document.getElementById('summaryLoan').textContent = fmt(loanAmount);
    document.getElementById('summaryInterest').textContent = fmt(totalInterest);
    document.getElementById('summaryTotal').textContent = fmt(totalPaid);

    // ─── 한도 체크 ───
    checkLoanLimit(loanType, loanAmount, price);
  }

  function checkLoanLimit(loanType, loanAmount, price) {
    const countySel = document.getElementById('countySelect');
    const box = document.getElementById('limitBox');
    const info = document.getElementById('limitInfo');

    if (!countySel.value) {
      box.innerHTML = '<p class="limit-hint">💡 Select a county above to verify loan limits.</p>';
      info.textContent = '';
      return;
    }

    const opt = countySel.options[countySel.selectedIndex];
    const fhaLimit = parseInt(opt.dataset.fha) || 524225;
    const confLimit = parseInt(opt.dataset.conf) || 832750;

    const limit = (loanType === 'fha') ? fhaLimit : confLimit;
    const limitLabel = (loanType === 'fha') ? 'FHA' : 'Conforming';

    info.textContent = `${limitLabel} limit: ${fmt(limit)}`;

    // VA/USDA는 한도 없음
    if (loanType === 'va' || loanType === 'usda') {
      box.innerHTML = `<p class="limit-ok">✅ ${loanType.toUpperCase()} loans have no county limit for eligible borrowers.</p>`;
      return;
    }

    if (loanAmount > limit) {
      box.innerHTML = `<p class="limit-warn">⚠️ Your loan (${fmt(loanAmount)}) exceeds the ${limitLabel} limit (${fmt(limit)}). You may need a jumbo loan or larger down payment.</p>`;
    } else {
      box.innerHTML = `<p class="limit-ok">✅ Your loan is within the ${limitLabel} limit (${fmt(limit)}).</p>`;
    }
  }

  function resetOutputs() {
    ['monthlyPayment', 'piAmount', 'taxAmount', 'insAmount', 'totalMonthly',
     'summaryLoan', 'summaryInterest', 'summaryTotal', 'mipAmount', 'hoaAmount']
      .forEach(id => document.getElementById(id).textContent = '$0');
    document.getElementById('mipRow').style.display = 'none';
    document.getElementById('hoaRow').style.display = 'none';
  }

  function fmt(n) {
    if (!isFinite(n) || n <= 0) return '$0';
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  // 초기 계산 (페이지 로드 시)
  window.addEventListener('DOMContentLoaded', () => {
    // URL에서 자동 채우기 (예: ?price=500000&county=06037)
    const params = new URLSearchParams(window.location.search);
    if (params.get('price')) document.getElementById('homePrice').value = params.get('price');
    if (params.get('rate')) document.getElementById('interestRate').value = params.get('rate');

    setTimeout(calculate, 500);
  });

})();