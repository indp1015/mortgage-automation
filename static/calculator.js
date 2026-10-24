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
    updateCountyLinks(fips, info[0], info[1]);   // 🆕 fips 추가 전달
  }

    // 🆕 Property Tax + Insurance 역방향 링크 생성
  function updateCountyLinks(fips, countyName, stateAbbr) {
    const linkBox = document.getElementById('taxDetailLink');
    if (!linkBox || !fips || !countyName || !stateAbbr) {
      if (linkBox) linkBox.style.display = 'none';
      return;
    }

    // 슬러그 결정: synced 데이터(index 4) 우선, 없으면 이름 기반 생성
    let slug = null;
    if (propertyTaxData && propertyTaxData[fips] && propertyTaxData[fips].length >= 5) {
      slug = propertyTaxData[fips][4];
    }
    if (!slug) {
      slug = (countyName + ' ' + stateAbbr).toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-');
    }

    // 현재 입력된 home price → URL 파라미터로 전달
    const price = parseFloat(document.getElementById('homePrice').value) || 0;
    const qs = `state=${encodeURIComponent(stateAbbr)}`
             + `&county=${encodeURIComponent(fips)}`
             + `&price=${encodeURIComponent(Math.round(price))}`;

    // ✅ property-tax: 계산기 페이지 (county 상세 페이지 아님)
    const propertyTaxUrl = `https://propertytax.dataindp.com/calculator.html?${qs}`;
    // ✅ insurance: 카운티 상세 페이지
    const insuranceUrl = `https://insurance.dataindp.com/counties/${encodeURIComponent(slug)}.html`;

    linkBox.innerHTML = `
      <div style="font-size: 0.85em; color: #666; margin-bottom: 8px;">Continue your research:</div>
      <a href="${propertyTaxUrl}" target="_blank" rel="noopener"
         style="display:block; margin-bottom:6px; color: #1a3d5c; font-weight: 600; text-decoration: none; font-size: 0.95em;">
        🏛️ Calculate property tax for ${countyName} →
      </a>
      <a href="${insuranceUrl}" target="_blank" rel="noopener"
         style="display:block; color: #1a3d5c; font-weight: 600; text-decoration: none; font-size: 0.95em;">
        🛡️ See climate &amp; insurance risk analysis for ${countyName} →
      </a>
    `;
    linkBox.style.display = 'block';
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
    // ═══════════════════════════════════════════
  // PURCHASE / REFINANCE MODE TABS
  // ═══════════════════════════════════════════
  const tabPurchase = document.getElementById('tabPurchase');
  const tabRefinance = document.getElementById('tabRefinance');
  const purchaseMode = document.getElementById('purchaseMode');
  const refinanceMode = document.getElementById('refinanceMode');

  if (tabPurchase && tabRefinance) {
    tabPurchase.addEventListener('click', () => {
      tabPurchase.classList.add('active');
      tabRefinance.classList.remove('active');
      purchaseMode.style.display = '';
      refinanceMode.style.display = 'none';
    });

    tabRefinance.addEventListener('click', () => {
      tabRefinance.classList.add('active');
      tabPurchase.classList.remove('active');
      purchaseMode.style.display = 'none';
      refinanceMode.style.display = '';
      calculateRefinance();
    });
  }

  const refInputIds = [
    'refBalance', 'refCurrentRate', 'refRemainingYears',
    'refNewRate', 'refNewTerm', 'refClosingCosts'
  ];
  refInputIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('input', calculateRefinance);
      el.addEventListener('change', calculateRefinance);
    }
  });

  function monthlyPI(principal, annualRate, years) {
    const r = annualRate / 100 / 12;
    const n = years * 12;
    if (r === 0) return principal / n;
    return principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
  }

  function calculateRefinance() {
    const balance = parseFloat(document.getElementById('refBalance').value) || 0;
    const currentRate = parseFloat(document.getElementById('refCurrentRate').value) || 0;
    const remainYears = parseInt(document.getElementById('refRemainingYears').value) || 25;
    const newRate = parseFloat(document.getElementById('refNewRate').value) || 0;
    const newTerm = parseInt(document.getElementById('refNewTerm').value) || 30;
    const closingCosts = parseFloat(document.getElementById('refClosingCosts').value) || 0;

    if (balance <= 0 || currentRate <= 0 || newRate <= 0) {
      ['refMonthlySavings','refCurrentPI','refNewPI','refMonthlySavings2',
       'refCurrentTotal','refNewTotal','refLifetimeSavings'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '$0';
      });
      document.getElementById('refBreakEven').textContent = 'Break-even: —';
      document.getElementById('refInsight').innerHTML = '';
      return;
    }

    const currentPI = monthlyPI(balance, currentRate, remainYears);
    const newPI = monthlyPI(balance, newRate, newTerm);
    const monthlySavings = currentPI - newPI;
    const currentTotal = currentPI * remainYears * 12;
    const newTotal = newPI * newTerm * 12 + closingCosts;
    const lifetimeSavings = currentTotal - newTotal;

    document.getElementById('refMonthlySavings').textContent = fmt(monthlySavings) + '/mo';
    document.getElementById('refCurrentPI').textContent = fmt(currentPI);
    document.getElementById('refNewPI').textContent = fmt(newPI);
    document.getElementById('refMonthlySavings2').textContent = fmt(monthlySavings);
    document.getElementById('refCurrentTotal').textContent = fmt(currentTotal);
    document.getElementById('refNewTotal').textContent = fmt(newTotal);
    document.getElementById('refLifetimeSavings').textContent = fmt(lifetimeSavings);

    let breakEvenText = '—';
    if (monthlySavings > 0 && closingCosts > 0) {
      const months = Math.ceil(closingCosts / monthlySavings);
      breakEvenText = months + ' months';
    } else if (monthlySavings > 0) {
      breakEvenText = 'Immediate';
    }
    document.getElementById('refBreakEven').textContent = 'Break-even: ' + breakEvenText;

    const insight = document.getElementById('refInsight');
    if (monthlySavings > 0 && lifetimeSavings > 0) {
      insight.innerHTML = `<p class="limit-ok">✅ Refinancing would save ${fmt(monthlySavings)}/month and ${fmt(lifetimeSavings)} over the life of the loan.</p>`;
    } else if (monthlySavings > 0 && lifetimeSavings <= 0) {
      insight.innerHTML = `<p class="limit-warn">⚠️ Monthly savings of ${fmt(monthlySavings)}, but total cost increases by ${fmt(-lifetimeSavings)} due to the extended term.</p>`;
    } else {
      insight.innerHTML = `<p class="limit-warn">⚠️ New loan has higher or equal monthly payment. Refinancing not beneficial at these terms.</p>`;
    }
  }

  // ═══════════════════════════════════════════
  // AMORTIZATION SCHEDULE
  // ═══════════════════════════════════════════
  let amortChart = null;
  let amortData = [];
  let amortView = 'yearly';

  const showAmortBtn = document.getElementById('showAmort');
  const closeAmortBtn = document.getElementById('closeAmort');
  const viewYearlyBtn = document.getElementById('viewYearly');
  const viewMonthlyBtn = document.getElementById('viewMonthly');

  if (showAmortBtn) {
    showAmortBtn.addEventListener('click', () => {
      generateAmortization();
      document.getElementById('amortSection').style.display = 'block';
      showAmortBtn.style.display = 'none';
      document.getElementById('amortSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  if (closeAmortBtn) {
    closeAmortBtn.addEventListener('click', () => {
      document.getElementById('amortSection').style.display = 'none';
      showAmortBtn.style.display = 'block';
    });
  }

  if (viewYearlyBtn) {
    viewYearlyBtn.addEventListener('click', () => {
      amortView = 'yearly';
      viewYearlyBtn.classList.add('active');
      viewMonthlyBtn.classList.remove('active');
      renderAmortTable();
    });
  }

  if (viewMonthlyBtn) {
    viewMonthlyBtn.addEventListener('click', () => {
      amortView = 'monthly';
      viewMonthlyBtn.classList.add('active');
      viewYearlyBtn.classList.remove('active');
      renderAmortTable();
    });
  }

  function generateAmortization() {
    const price = parseFloat(document.getElementById('homePrice').value) || 0;
    const dp = parseFloat(document.getElementById('downPayment').value) || 0;
    const term = parseInt(document.getElementById('loanTerm').value) || 30;
    const rate = parseFloat(document.getElementById('interestRate').value) || 6.85;
    const loanAmount = Math.max(0, price - dp);

    if (loanAmount <= 0 || rate <= 0) return;

    const monthlyRate = rate / 100 / 12;
    const n = term * 12;
    const payment = loanAmount * monthlyRate * Math.pow(1 + monthlyRate, n)
                  / (Math.pow(1 + monthlyRate, n) - 1);

    let balance = loanAmount;
    let totalInterest = 0;
    amortData = [];

    for (let m = 1; m <= n; m++) {
      const interest = balance * monthlyRate;
      const principal = payment - interest;
      balance = Math.max(0, balance - principal);
      totalInterest += interest;

      amortData.push({
        month: m,
        year: Math.ceil(m / 12),
        payment: payment,
        principal: principal,
        interest: interest,
        balance: balance,
        totalInterest: totalInterest,
      });
    }

    // 요약
    document.getElementById('amortFirstPayment').textContent = fmt(payment);
    document.getElementById('amortLastPayment').textContent = fmt(payment);
    document.getElementById('amortTotalInterest').textContent = fmt(totalInterest);

    renderAmortChart();
    renderAmortTable();
  }

  function renderAmortChart() {
    const ctx = document.getElementById('amortChart');
    if (!ctx) return;

    // 연도별 집계
    const yearlyData = [];
    let yearAgg = { principal: 0, interest: 0, balance: 0 };

    amortData.forEach((row, idx) => {
      yearAgg.principal += row.principal;
      yearAgg.interest += row.interest;
      yearAgg.balance = row.balance;

      if ((idx + 1) % 12 === 0 || idx === amortData.length - 1) {
        yearlyData.push({
          year: row.year,
          principal: yearAgg.principal,
          interest: yearAgg.interest,
          balance: yearAgg.balance,
        });
        yearAgg = { principal: 0, interest: 0, balance: 0 };
      }
    });

    const labels = yearlyData.map(d => 'Year ' + d.year);

    if (amortChart) amortChart.destroy();

    amortChart = new Chart(ctx.getContext('2d'), {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Principal',
            data: yearlyData.map(d => d.principal),
            backgroundColor: 'rgba(26, 61, 92, 0.75)',
            stack: 'payments',
          },
          {
            label: 'Interest',
            data: yearlyData.map(d => d.interest),
            backgroundColor: 'rgba(230, 126, 34, 0.75)',
            stack: 'payments',
          },
          {
            label: 'Remaining Balance',
            data: yearlyData.map(d => d.balance),
            type: 'line',
            borderColor: '#27ae60',
            backgroundColor: 'rgba(39, 174, 96, 0.1)',
            borderWidth: 2,
            pointRadius: 3,
            fill: false,
            yAxisID: 'y1',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top' },
          tooltip: {
            callbacks: {
              label: c => c.dataset.label + ': ' + fmt(c.parsed.y),
            },
          },
        },
        scales: {
          y: {
            stacked: true,
            title: { display: true, text: 'Yearly Payment ($)' },
            ticks: { callback: v => '$' + (v / 1000).toFixed(0) + 'k' },
          },
          y1: {
            position: 'right',
            title: { display: true, text: 'Balance ($)' },
            grid: { drawOnChartArea: false },
            ticks: { callback: v => '$' + (v / 1000).toFixed(0) + 'k' },
          },
          x: { grid: { display: false } },
        },
      },
    });
  }

  function renderAmortTable() {
    const thead = document.getElementById('amortThead');
    const tbody = document.getElementById('amortTbody');
    if (!thead || !tbody) return;

    if (amortView === 'yearly') {
      thead.innerHTML = `
        <tr>
          <th>Year</th>
          <th>Principal</th>
          <th>Interest</th>
          <th>Balance</th>
        </tr>
      `;

      // 연도별 집계
      const yearly = [];
      let agg = { principal: 0, interest: 0, balance: 0 };
      amortData.forEach((row, idx) => {
        agg.principal += row.principal;
        agg.interest += row.interest;
        agg.balance = row.balance;
        if ((idx + 1) % 12 === 0 || idx === amortData.length - 1) {
          yearly.push({
            year: row.year,
            principal: agg.principal,
            interest: agg.interest,
            balance: agg.balance,
          });
          agg = { principal: 0, interest: 0, balance: 0 };
        }
      });

      tbody.innerHTML = yearly.map(y => `
        <tr>
          <td><strong>${y.year}</strong></td>
          <td>${fmt(y.principal)}</td>
          <td>${fmt(y.interest)}</td>
          <td>${fmt(y.balance)}</td>
        </tr>
      `).join('');
    } else {
      thead.innerHTML = `
        <tr>
          <th>#</th>
          <th>Payment</th>
          <th>Principal</th>
          <th>Interest</th>
          <th>Balance</th>
        </tr>
      `;
      tbody.innerHTML = amortData.map(row => `
        <tr>
          <td>${row.month}</td>
          <td>${fmt(row.payment)}</td>
          <td>${fmt(row.principal)}</td>
          <td>${fmt(row.interest)}</td>
          <td>${fmt(row.balance)}</td>
        </tr>
      `).join('');
    }
  }
})();