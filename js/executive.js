// ==========================================================
// HCMIS — Executive Dashboard
// ==========================================================

let meE = null;
const PALETTE = ['#175C58', '#2E8C7D', '#C97A2B', '#B3261E', '#4E6360', '#8FC3B9'];

(async function init() {
  meE = await requireAuth();
  if (!meE) return;

  document.getElementById('whoName').textContent = meE.full_name;
  document.getElementById('whoRole').textContent = meE.role;
  document.getElementById('facilityName').textContent =
    (meE.facilities && meE.facilities.name) ? meE.facilities.name : 'No facility assigned';

  await loadKpis();
  await loadPatientTrend();
  await loadRevenueTrend();
  await loadRevenueBySource();

  document.getElementById('report_month').value = new Date().toISOString().slice(0, 7);
  document.getElementById('generateReportBtn').addEventListener('click', generateMonthlyReport);
})();

function last14Days() {
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

async function loadKpis() {
  const today = new Date().toISOString().slice(0, 10);

  const { count: patientCount } = await supabaseClient.from('patients').select('id', { count: 'exact', head: true }).gte('created_at', today + 'T00:00:00');
  document.getElementById('k_patients').textContent = patientCount ?? 0;

  const { count: opdCount } = await supabaseClient.from('encounters').select('id', { count: 'exact', head: true }).eq('visit_date', today).eq('encounter_type', 'OPD');
  document.getElementById('k_opd').textContent = opdCount ?? 0;

  const { count: admCount } = await supabaseClient.from('admissions').select('id', { count: 'exact', head: true }).eq('status', 'ADMITTED');
  document.getElementById('k_admissions').textContent = admCount ?? 0;

  const { data: beds } = await supabaseClient.from('beds').select('status');
  if (beds && beds.length > 0) {
    const occupied = beds.filter(b => b.status === 'OCCUPIED').length;
    document.getElementById('k_occupancy').textContent = Math.round((occupied / beds.length) * 100) + '%';
  } else {
    document.getElementById('k_occupancy').textContent = '—';
  }

  const { data: payToday } = await supabaseClient.from('payments').select('amount').gte('payment_date', today + 'T00:00:00');
  const revenue = (payToday || []).reduce((s, p) => s + parseFloat(p.amount || 0), 0);
  document.getElementById('k_revenue').textContent = revenue.toLocaleString();

  const { data: openInv } = await supabaseClient.from('invoices').select('balance').neq('status', 'CANCELLED').gt('balance', 0);
  const outstanding = (openInv || []).reduce((s, i) => s + parseFloat(i.balance || 0), 0);
  document.getElementById('k_outstanding').textContent = outstanding.toLocaleString();
}

async function loadPatientTrend() {
  const days = last14Days();
  const { data } = await supabaseClient.from('patients').select('created_at').gte('created_at', days[0] + 'T00:00:00');
  const counts = days.map(d => (data || []).filter(p => p.created_at.slice(0, 10) === d).length);

  new Chart(document.getElementById('chartPatients'), {
    type: 'bar',
    data: { labels: days.map(d => d.slice(5)), datasets: [{ label: 'New patients', data: counts, backgroundColor: PALETTE[1] }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
  });
}

async function loadRevenueTrend() {
  const days = last14Days();
  const { data } = await supabaseClient.from('payments').select('payment_date, amount').gte('payment_date', days[0] + 'T00:00:00').eq('status', 'COMPLETED');
  const totals = days.map(d => (data || []).filter(p => p.payment_date.slice(0, 10) === d).reduce((s, p) => s + parseFloat(p.amount || 0), 0));

  new Chart(document.getElementById('chartRevenue'), {
    type: 'line',
    data: { labels: days.map(d => d.slice(5)), datasets: [{ label: 'Revenue', data: totals, borderColor: PALETTE[0], backgroundColor: 'rgba(23,92,88,0.1)', fill: true, tension: 0.3 }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
  });
}

async function loadRevenueBySource() {
  const { data } = await supabaseClient.from('invoice_items').select('source_module, total').limit(2000);
  const totalsByModule = {};
  (data || []).forEach(i => {
    totalsByModule[i.source_module] = (totalsByModule[i.source_module] || 0) + parseFloat(i.total || 0);
  });
  const labels = Object.keys(totalsByModule);
  const values = Object.values(totalsByModule);

  if (labels.length === 0) { document.getElementById('chartSource').parentElement.innerHTML = '<p class="empty">No billing data yet.</p>'; return; }

  new Chart(document.getElementById('chartSource'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: PALETTE }] },
    options: { plugins: { legend: { position: 'right' } } }
  });
}

// ---------------- MONTHLY FACILITY SUMMARY REPORT ----------------
function ageBand(dob, asOfDate) {
  if (!dob) return 'Unknown';
  const years = (asOfDate - new Date(dob)) / (365.25 * 24 * 3600 * 1000);
  if (years < 5) return 'Under 5';
  if (years < 60) return '5-59';
  return '60+';
}

async function generateMonthlyReport() {
  const monthVal = document.getElementById('report_month').value; // "YYYY-MM"
  if (!monthVal) { alert('Select a month.'); return; }
  const [year, month] = monthVal.split('-').map(Number);
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 1); // first day of next month, exclusive
  const startStr = startDate.toISOString().slice(0, 10);
  const endStr = endDate.toISOString().slice(0, 10);
  const monthLabel = startDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

  const facilityFilter = (q) => meE.facility_id ? q.eq('facility_id', meE.facility_id) : q;

  // OPD attendance by sex + age band
  const { data: encounters } = await facilityFilter(
    supabaseClient.from('encounters').select('id, visit_date, patients(sex, date_of_birth)')
  ).gte('visit_date', startStr).lt('visit_date', endStr);

  const bySex = { MALE: 0, FEMALE: 0 };
  const byAge = { 'Under 5': 0, '5-59': 0, '60+': 0, 'Unknown': 0 };
  (encounters || []).forEach(e => {
    if (e.patients) {
      bySex[e.patients.sex] = (bySex[e.patients.sex] || 0) + 1;
      const band = ageBand(e.patients.date_of_birth, endDate);
      byAge[band] = (byAge[band] || 0) + 1;
    }
  });
  const totalOpd = (encounters || []).length;

  // Referrals made
  const { count: referralCount } = await supabaseClient.from('referrals').select('id', { count: 'exact', head: true })
    .gte('created_at', startStr).lt('created_at', endStr);

  // Top 10 diagnoses
  const { data: diagRows } = await supabaseClient.from('diagnoses').select('diagnosis_name, encounters!inner(visit_date)')
    .gte('encounters.visit_date', startStr).lt('encounters.visit_date', endStr);
  const diagCounts = {};
  (diagRows || []).forEach(d => { diagCounts[d.diagnosis_name] = (diagCounts[d.diagnosis_name] || 0) + 1; });
  const topDiagnoses = Object.entries(diagCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);

  // Immunizations given, by vaccine
  const { data: immRows } = await supabaseClient.from('immunizations_given').select('vaccine_name')
    .gte('date_given', startStr).lt('date_given', endStr);
  const immCounts = {};
  (immRows || []).forEach(i => { immCounts[i.vaccine_name] = (immCounts[i.vaccine_name] || 0) + 1; });
  const totalImmunizations = (immRows || []).length;

  // HIV tests done
  const { count: hivTestCount } = await supabaseClient.from('lab_order_items').select('id, lab_orders!inner(ordered_at)', { count: 'exact', head: true })
    .ilike('test_name', '%HIV%').gte('lab_orders.ordered_at', startStr).lt('lab_orders.ordered_at', endStr);

  // Total lab tests done
  const { count: totalLabTests } = await supabaseClient.from('lab_order_items').select('id, lab_orders!inner(ordered_at)', { count: 'exact', head: true })
    .gte('lab_orders.ordered_at', startStr).lt('lab_orders.ordered_at', endStr);

  // Admissions and deliveries
  const { count: admissionCount } = await facilityFilter(
    supabaseClient.from('admissions').select('id', { count: 'exact', head: true })
  ).gte('admission_date', startStr).lt('admission_date', endStr);

  const { count: deliveryCount } = await supabaseClient.from('deliveries').select('id', { count: 'exact', head: true })
    .gte('delivery_time', startStr).lt('delivery_time', endStr);

  // Revenue collected
  const { data: paymentRows } = await supabaseClient.from('payments').select('amount, payment_method')
    .eq('status', 'COMPLETED').gte('payment_date', startStr).lt('payment_date', endStr);
  const totalRevenue = (paymentRows || []).reduce((sum, p) => sum + parseFloat(p.amount || 0), 0);
  const revenueByMethod = {};
  (paymentRows || []).forEach(p => { revenueByMethod[p.payment_method] = (revenueByMethod[p.payment_method] || 0) + parseFloat(p.amount || 0); });

  const html = `
    <h2 style="margin-top:0;">Monthly Facility Summary — ${monthLabel}</h2>

    <h3>1. OPD Attendance</h3>
    <table><tbody>
      <tr><td>Total OPD attendances</td><td class="mono">${totalOpd}</td></tr>
      <tr><td>Male</td><td class="mono">${bySex.MALE || 0}</td></tr>
      <tr><td>Female</td><td class="mono">${bySex.FEMALE || 0}</td></tr>
      <tr><td>Under 5 years</td><td class="mono">${byAge['Under 5']}</td></tr>
      <tr><td>5-59 years</td><td class="mono">${byAge['5-59']}</td></tr>
      <tr><td>60+ years</td><td class="mono">${byAge['60+']}</td></tr>
      <tr><td>Referrals made</td><td class="mono">${referralCount || 0}</td></tr>
    </tbody></table>

    <h3>2. Top Diagnoses</h3>
    <table><thead><tr><th>Diagnosis</th><th>Count</th></tr></thead><tbody>
      ${topDiagnoses.length ? topDiagnoses.map(([name, count]) => `<tr><td>${name}</td><td class="mono">${count}</td></tr>`).join('') : '<tr><td colspan="2" class="empty">No diagnoses recorded this month.</td></tr>'}
    </tbody></table>

    <h3>3. Maternal & Child Health</h3>
    <table><tbody>
      <tr><td>Deliveries</td><td class="mono">${deliveryCount || 0}</td></tr>
      <tr><td>Total immunizations given</td><td class="mono">${totalImmunizations}</td></tr>
      <tr><td>Antenatal care visits</td><td class="mono" style="color:var(--hc-ink-soft);">Not tracked as a distinct module — use ANC register</td></tr>
      <tr><td>Family planning services</td><td class="mono" style="color:var(--hc-ink-soft);">Not tracked as a distinct module — use FP register</td></tr>
    </tbody></table>
    ${Object.keys(immCounts).length ? `
    <table><thead><tr><th>Vaccine</th><th>Count</th></tr></thead><tbody>
      ${Object.entries(immCounts).map(([name, count]) => `<tr><td>${name}</td><td class="mono">${count}</td></tr>`).join('')}
    </tbody></table>` : ''}

    <h3>4. HIV/AIDS Testing Services</h3>
    <table><tbody>
      <tr><td>HIV tests performed</td><td class="mono">${hivTestCount || 0}</td></tr>
    </tbody></table>

    <h3>5. Laboratory</h3>
    <table><tbody>
      <tr><td>Total lab tests performed</td><td class="mono">${totalLabTests || 0}</td></tr>
    </tbody></table>

    <h3>6. Inpatient</h3>
    <table><tbody>
      <tr><td>Admissions</td><td class="mono">${admissionCount || 0}</td></tr>
    </tbody></table>

    <h3>7. Financial Summary</h3>
    <table><tbody>
      <tr><td>Total revenue collected</td><td class="mono">${totalRevenue.toLocaleString()}</td></tr>
      ${Object.entries(revenueByMethod).map(([method, amt]) => `<tr><td>&nbsp;&nbsp;${method}</td><td class="mono">${amt.toLocaleString()}</td></tr>`).join('')}
    </tbody></table>
  `;

  document.getElementById('reportOutput').innerHTML = html +
    `<button class="btn btn-secondary" style="margin-top:12px;" onclick='printMonthlyReport(${JSON.stringify(monthLabel)}, ${JSON.stringify(html)})'>Print / Export</button>`;
}

function printMonthlyReport(monthLabel, html) {
  openPrintDocument('Monthly Facility Summary — ' + monthLabel, meE.facilities, html, { signedBy: meE.full_name, signedRole: 'Prepared by' });
}
