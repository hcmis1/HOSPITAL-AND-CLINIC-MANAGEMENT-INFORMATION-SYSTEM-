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
