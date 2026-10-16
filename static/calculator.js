/**
 * 모기지 계산기 - 2026
 * - FHA / VA / USDA / Conventional 지원
 * - 카운티별 자동 한도 적용
 * - MIP / PMI 자동 계산
 * - URL 파라미터: ?state=MI&county=26071&price=109100&rate=7.4&type=fha
 */

(function() {
  'use strict';

  let countyData = null;
  let stateMap = {};  // {state: [{fips, name, fha, conf}, ...]}
  let propertyTaxData = null;   // 🆕 {fips: [name, state, median_tax, rate]}

  // ─── 초기 로드 ───
  fetch('/static/counties_limits.json')
    .then(r => r.json())
    .then(data => {
      countyData = data.counties;
      buildStateMap();
      populateStateSelect();
      applyUrlParams();
    })
    .catch(err => console.error('카운티 데이터 로드 실패:', err));

  // 🆕 세율 데이터 로드
  fetch('/static/counties_tax_rates.json')
    .then(r => r.json())
    .then(data => {
      propertyTaxData = data.counties || {};
      console.log('[Calculator] Tax rates loaded:', Object.keys(propertyTaxData).length);
      const cSel = document.getElementById('countySelect');
      if (cSel && cSel.value) applyCountyTaxRate(cSel.value);
    })
    .catch(err => console.warn('세율 데이터 로드 실패 (선택):', err));

  // ─── State Map 구성 (배열 구조 대응) ───
  function buildStateMap() {
    for (const [fips, info] of Object.entries(countyData)) {
      const state = info[1];   // ["Moore","TN",541287,832750] → info[1] = "TN"
      if (!state) continue;

      if (!stateMap[state]) stateMap[state] = [];
      stateMap[state].push({
        fips: fips,
        name: info[0],
        fha: info[2] || 0,
        conf: info[3] || 0,
      });
    }
    // 카운티 이름순 정렬
    for (const state in stateMap) {
      stateMap[state].sort((a, b) => a.name.localeCompare(b.name));
    }
    console.log('[Calculator] State map:', Object.keys(stateMap).length, 'states');
  }

  function populateStateSelect() {
    const sel = document.getElementById('stateSelect');
    if (!sel) {
      console.error('[Calculator] stateSelect 요소를 찾을 수 없음');
      return;
    }
    sel.innerHTML = '<option value="">-- All States --</option>';

    const states = Object.keys(stateMap).sort();
    for (const s of states) {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s;
      sel.appendChild(opt);
    }
  }

  function populateCountySelect(state) {
    const sel = document.getElementById('countySelect');
    if (!sel) return;
    sel.innerHTML = '<option value="">-- Select County --</option>';

    if (!state || !stateMap[state]) return;

    for (const c of stateMap[state]) {
      const opt = document.createElement('option');
      opt.value = c.fips;
      opt.textContent = c.name;
      opt.dataset.fha = c.fha;
      opt.dataset.conf = c.conf;
      sel.appendChild(opt);
    }
  }

  // ─── URL 파라미터 적용 (핵심) ───
  function applyUrlParams() {
    const params = new URLSearchParams(window.location.search);

    // 1) State
    const stateParam = params.get('state');
    if (stateParam) {
      const stateSel = document.getElementById('stateSelect');
      if (stateSel) {
        stateSel.value = stateParam;
        populateCountySelect(stateParam);

        // 2) County (FIPS 또는 이름으로 매칭)
        const countyParam = params.get('county');
        if (countyParam) {
          const countySel = document.getElementById('countySelect');
          if (countySel) {
            let found = false;
            for (const opt of countySel.options) {
              if (opt.value === countyParam) {
                countySel.value = countyParam;
                found = true;
                break;
              }
            }
            if (!found) {
              for (const opt of countySel.options) {
                if (opt.textContent.toUpperCase().includes(countyParam.toUpperCase())) {
                  countySel.value = opt.value;
                  break;
                }
              }
            }
            // 🆕 세율 적용 (데이터가 아직 로드 안 됐으면 나중에 자동 재시도)
            if (countySel.value) applyCountyTaxRate(countySel.value);
          }
        }
      }
    }

    // 3) Home Price
    const priceParam = params.get('price');
    if (priceParam) {
      const priceInput = document.getElementById('homePrice');
      if (priceInput) {
        priceInput.value = priceParam;
        const price = parseFloat(priceParam) || 0;
        const pct = parseFloat(document.getElementById('downPct').value) || 3.5;
        document.getElementById('downPayment').value = Math.round(price * pct / 100);
      }
    }

    // 4) Interest Rate
    const rateParam = params.get('rate');
    if (rateParam) {
      const rateInput = document.getElementById('interestRate');
      if (rateInput) rateInput.value = rateParam;
    }

    // 5) Loan Type
    const typeParam = params.get('type');
    if (typeParam) {
      const loanSel = document.getElementById('loanType');
      if (loanSel) {
        loanSel.value = typeParam;
        applyMinDownPayment(typeParam);
      }
    }

    // 6) 계산 실행
    calculate();
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
      const price = parseFloat(document.getElementById('homePrice').value) || 0;
      const pct = parseFloat(document.getElementById('downPct').value) || 0;
      document.getElementById('downPayment').value = Math.round(price * pct / 100);
    } else if (e && e.target.id === 'loanType') {
      applyMinDownPayment(e.target.value);
    } else if (e && e.target.id === 'stateSelect') {
      populateCountySelect(e.target.value);
    } else if (e && e.target.id === 'countySelect') {
      applyCountyTaxRate(e.target.value);   // 🆕
    }
    calculate();
  }
  // 🆕 카운티 선택 시 세율 자동 반영
  function applyCountyTaxRate(fips) {
    if (!propertyTaxData || !fips) return;
    const info = propertyTaxData[fips];
    if (!info || !Array.isArray(info)) return;
    // 구조: [name, state, median_tax, effective_rate]
    const rate = parseFloat(info[3]);
    if (isNaN(rate) || rate <= 0) return;
    const taxInput = document.getElementById('propertyTax');
    if (taxInput) {
      taxInput.value = rate.toFixed(2);
      calculate();
      console.log('[Calculator] Applied tax rate for', fips, ':', rate + '%');
    }
  }

  function applyMinDownPayment(type) {
    const minPct = { conventional: 5, fha: 3.5, va: 0, usda: 0 }[type] || 3.5;
    const price = parseFloat(document.getElementById('homePrice').value) || 0;
    document.getElementById('downPct').value = minPct;
    document.getElementById('downPayment').value = Math.round(price * minPct / 100);
  }

  // ─── 계산 (기존과 동일) ───
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

    const monthlyRate = rate / 100 / 12;
    const n = term * 12;
    const pi = loanAmount * monthlyRate * Math.pow(1 + monthlyRate, n)
             / (Math.pow(1 + monthlyRate, n) - 1);

    const taxMo = price * taxPct / 100 / 12;
    const insMo = insYr / 12;

    let mipMo = 0;
    let mipLabel = '';
    if (loanType === 'fha') {
      const ltv = loanAmount / price;
      const mipRate = ltv > 0.95 ? 0.0085 : 0.0055;
      mipMo = loanAmount * mipRate / 12;
      mipLabel = 'FHA MIP';
    } else if (loanType === 'conventional') {
      const ltv = loanAmount / price;
      if (ltv > 0.8) {
        mipMo = loanAmount * 0.007 / 12;
        mipLabel = 'PMI (est.)';
      }
    }

    const totalMonthly = pi + taxMo + insMo + mipMo + hoaMo;
    const totalPaid = pi * n;
    const totalInterest = totalPaid - loanAmount;

    document.getElementById('monthlyPayment').textContent = fmt(totalMonthly);
    document.getElementById('loanAmountInfo').textContent = 'Loan Amount: ' + fmt(loanAmount);
    document.getElementById('piAmount').textContent = fmt(pi);
    document.getElementById('taxAmount').textContent = fmt(taxMo);
    document.getElementById('insAmount').textContent = fmt(insMo);

    const mipRow = document.getElementById('mipRow');
    if (mipMo > 0) {
      mipRow.style.display = '';
      document.getElementById('mipLabel').textContent = mipLabel;
      document.getElementById('mipAmount').textContent = fmt(mipMo);
    } else {
      mipRow.style.display = 'none';
    }

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

    checkLoanLimit(loanType, loanAmount, price);
  }

  function checkLoanLimit(loanType, loanAmount, price) {
    const countySel = document.getElementById('countySelect');
    const box = document.getElementById('limitBox');
    const info = document.getElementById('limitInfo');

    if (!countySel || !countySel.value) {
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
      .forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '$0';
      });
    const mipRow = document.getElementById('mipRow');
    const hoaRow = document.getElementById('hoaRow');
    if (mipRow) mipRow.style.display = 'none';
    if (hoaRow) hoaRow.style.display = 'none';
  }

  function fmt(n) {
    if (!isFinite(n) || n <= 0) return '$0';
    return '$' + Math.round(n).toLocaleString('en-US');
  }

})();