/**
 * HELOC Calculator
 * Computes max borrowing power, monthly payments, and cost comparison.
 * Uses Prime Rate (Federal Reserve Board, Public Domain) as benchmark.
 *
 * URL params: ?state=VA&county=51065&value=400000&balance=250000
 */

(function () {
  'use strict';

  let primeRate = 8.00;  // Default fallback
  let countyData = null;
  let stateMap = {};

  // ---- Fetch Prime Rate (Public Domain) ----
fetch('/static/fred_prime_rate.json')
  .then(r => r.json())
  .then(d => {
    if (d.latest && d.latest.value) {
      primeRate = d.latest.value;

      // Update both displays (banner + table)
      const bannerEl = document.getElementById('primeRateDisplay');
      if (bannerEl) bannerEl.textContent = primeRate.toFixed(2) + '%';

      const tableEl = document.getElementById('primeRateBenchmarkDisplay');
      if (tableEl) tableEl.textContent = primeRate.toFixed(2) + '%';

      recalculate();
    }
  })
  .catch(() => console.warn('[HELOC] Prime rate unavailable, using fallback'));

  // ---- Load County Data (for pre-fill) ----
  fetch('/static/counties_limits.json')
    .then(r => r.json())
    .then(data => {
      countyData = data.counties;
      buildStateMap();
      populateStateSelect();
      applyUrlParams();
    })
    .catch(err => console.error('[HELOC] County data load failed:', err));

      // 🆕 Load HELOC equity data (for county context)
  let helocEquityData = null;
  fetch('/static/heloc_equity.json')
    .then(r => r.json())
    .then(data => {
      helocEquityData = data.counties || {};
      
      // If county already selected (from URL), update context
      const cSel = document.getElementById('countySelect');
      if (cSel && cSel.value) updateCountyContext(cSel.value);
    })
    .catch(err => console.warn('[HELOC] Equity data not available:', err));

  function buildStateMap() {
    for (const [fips, info] of Object.entries(countyData)) {
      const st = info[1];
      if (!st) continue;
      if (!stateMap[st]) stateMap[st] = [];
      stateMap[st].push({ fips, name: info[0] });
    }
    for (const st in stateMap) {
      stateMap[st].sort((a, b) => a.name.localeCompare(b.name));
    }
  }

  function populateStateSelect() {
    const sel = document.getElementById('stateSelect');
    if (!sel) return;
    sel.innerHTML = '<option value="">-- All States --</option>';
    Object.keys(stateMap).sort().forEach(st => {
      const opt = document.createElement('option');
      opt.value = st;
      opt.textContent = st;
      sel.appendChild(opt);
    });
  }

  function populateCountySelect(state) {
    const sel = document.getElementById('countySelect');
    if (!sel) {
      console.error('[HELOC] countySelect element NOT FOUND in DOM!');
      return;
    }
    sel.innerHTML = '<option value="">-- Select County --</option>';
    if (!state || !stateMap[state]) {
      console.warn('[HELOC] No counties for state:', state);
      return;
    }
    for (const c of stateMap[state]) {
      const opt = document.createElement('option');
      opt.value = c.fips;
      opt.textContent = c.name;
      sel.appendChild(opt);
    }
  }

  // ---- Event Bindings ----
  const inputIds = [
    'homeValue', 'mortgageBalance', 'creditTier', 'ltvLimit',
    'stateSelect', 'countySelect'
  ];
  inputIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    // select: change only (fires once); input[type=number]: input only
    if (el.tagName === 'SELECT') {
      el.addEventListener('change', handleInput);
    } else {
      el.addEventListener('input', handleInput);
    }
  });

  function handleInput(e) {
    if (e && e.target.id === 'stateSelect') {
      populateCountySelect(e.target.value);
      hideCountyContext();
    }
    if (e && e.target.id === 'countySelect') {
      updateCountyContext(e.target.value);
    }
    recalculate();
  }
  // 🆕 Hide county context (when state changes)
  function hideCountyContext() {
    const box = document.getElementById('countyContext');
    if (box) box.style.display = 'none';
  }

  // 🆕 Show county-specific equity context
  function updateCountyContext(fips) {
    const box = document.getElementById('countyContext');
    if (!box) return;

    if (!fips || !helocEquityData || !helocEquityData[fips]) {
      box.style.display = 'none';
      return;
    }

    const eq = helocEquityData[fips];
    const countySel = document.getElementById('countySelect');
    const stateSel = document.getElementById('stateSelect');
    const countyName = countySel.selectedOptions[0]?.textContent || 'this county';
    const stateAbbr = stateSel.value || '';

    // Build sister-site URLs
    const propertyTaxUrl =
      `https://propertytax.dataindp.com/calculator.html?state=${encodeURIComponent(stateAbbr)}&county=${encodeURIComponent(fips)}`;
    const insuranceSlug = (countyName + ' ' + stateAbbr)
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-');
    const insuranceUrl =
      `https://insurance.dataindp.com/counties/${encodeURIComponent(insuranceSlug)}.html`;

    box.innerHTML = `
      <h4 style="margin: 0 0 8px 0; color: var(--primary);">📍 ${countyName}, ${stateAbbr} Reference</h4>
      <p style="font-size: 0.85em; color: #666; margin-bottom: 10px;">
        How does your situation compare to other homeowners in this county?
      </p>
      <table class="breakdown-table">
        <tbody>
          <tr>
            <td>Average home value (mortgaged)</td>
            <td class="amount">$${eq.avg_value_with_mortgage.toLocaleString()}</td>
          </tr>
          <tr>
            <td>Estimated average equity</td>
            <td class="amount">$${eq.est_equity_per_mortgaged_home.toLocaleString()}</td>
          </tr>
          <tr>
            <td>Estimated HELOC capacity</td>
            <td class="amount">$${eq.est_heloc_capacity.toLocaleString()}</td>
          </tr>
        </tbody>
      </table>
      <p style="font-size: 0.85em; color: #666; margin-top: 12px;">
        Source: U.S. Census Bureau ACS 5-Year Estimates (CC0 1.0). Estimates only.
      </p>
      <p style="margin-top: 10px; font-size: 0.9em;">
        <a href="${propertyTaxUrl}" style="color: var(--primary); font-weight: 600; margin-right: 12px;">
          🏛️ Property Tax →
        </a>
        <a href="${insuranceUrl}" style="color: var(--primary); font-weight: 600;">
          🛡️ Insurance Risk →
        </a>
      </p>
    `;
    box.style.display = 'block';
  }
  // ---- Core Calculation ----
  function recalculate() {
    const homeValue = parseFloat((document.getElementById('homeValue') || {}).value) || 0;
    const balance = parseFloat((document.getElementById('mortgageBalance') || {}).value) || 0;
    const creditTier = (document.getElementById('creditTier') || {}).value || '720-759';
    const ltvLimit = parseFloat((document.getElementById('ltvLimit') || {}).value) || 0.85;

    // Credit tier → margin over Prime
    const tierMargins = {
      '760+': 0.005,
      '720-759': 0.010,
      '680-719': 0.015,
      '640-679': 0.020,
      '620-639': 0.025,
    };
    const margin = tierMargins[creditTier] || 0.010;
    const helocRate = (primeRate / 100) + margin;

    // LTV calculation
    const maxTotalDebt = homeValue * ltvLimit;
    const availableCredit = Math.max(0, maxTotalDebt - balance);
    const currentLtv = homeValue > 0 ? balance / homeValue : 0;

    // Interest-only (draw period) vs amortized (repayment)
    const interestOnlyMonthly = availableCredit * helocRate / 12;
    const amortizedMonthly = availableCredit > 0
      ? pAndI(availableCredit, helocRate * 100, 20)  // 20yr repayment
      : 0;

    // ---- Update UI ----
    setText('maxBorrowing', formatMoney(availableCredit));
    setText('currentLtvDisplay', (currentLtv * 100).toFixed(1) + '%');
    setText('helocRateDisplay', (helocRate * 100).toFixed(2) + '%');
    setText('primeRateDisplay', primeRate.toFixed(2) + '%');           // banner
    setText('primeRateBenchmarkDisplay', primeRate.toFixed(2) + '%');  // 🆕 table
    setText('marginDisplay', '+' + (margin * 100).toFixed(2) + '%');
    setText('interestOnlyMonthly', formatMoney(interestOnlyMonthly) + '/mo');
    setText('amortizedMonthly', formatMoney(amortizedMonthly) + '/mo');
    setText('availableCreditInfo', formatMoney(availableCredit));

    // Warning states
    const warnBox = document.getElementById('helocWarn');
    if (warnBox) {
      if (currentLtv > ltvLimit) {
        warnBox.innerHTML =
          '<p class="limit-warn">⚠️ Your current LTV (' +
          (currentLtv * 100).toFixed(1) +
          '%) exceeds the ' + (ltvLimit * 100) +
          '% limit. You may not qualify without paying down the balance.</p>';
      } else if (availableCredit === 0) {
        warnBox.innerHTML =
          '<p class="limit-hint">💡 Enter your home value and current mortgage balance to see your HELOC capacity.</p>';
      } else {
        warnBox.innerHTML =
          '<p class="limit-ok">✅ Based on your inputs, you may qualify for up to ' +
          formatMoney(availableCredit) + ' in HELOC credit.</p>';
      }
    }
  }

  function pAndI(principal, annualRatePct, years) {
    const r = annualRatePct / 100 / 12;
    const n = years * 12;
    if (r === 0) return principal / n;
    return principal * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function formatMoney(n) {
    if (!isFinite(n) || n <= 0) return '$0';
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  // ---- URL Param Pre-fill ----
  function applyUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const state = (params.get('state') || '').toUpperCase();
    const county = (params.get('county') || '').padStart(5, '0');
    const value = params.get('value');
    const balance = params.get('balance');

    if (state) {
      const stateSel = document.getElementById('stateSelect');
      if (stateSel) {
        stateSel.value = state;
        populateCountySelect(state);
      }
      if (county) {
        const countySel = document.getElementById('countySelect');
        if (countySel) countySel.value = county;
      }
    }
    if (value) {
      const el = document.getElementById('homeValue');
      if (el) el.value = value;
    }
    if (balance) {
      const el = document.getElementById('mortgageBalance');
      if (el) el.value = balance;
    }
    recalculate();
  }

  // Initial calculate
  window.addEventListener('DOMContentLoaded', () => {
    setTimeout(recalculate, 400);
  });
})();