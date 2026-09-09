// ==========================================================
// HCMIS — Radiology
// ==========================================================

let meR = null;

(async function init() {
  meR = await requireAuth();
  if (!meR) return;

  document.getElementById('whoName').textContent = meR.full_name;
  document.getElementById('whoRole').textContent = meR.role;
  document.getElementById('facilityName').textContent =
    (meR.facilities && meR.facilities.name) ? meR.facilities.name : 'No facility assigned';
  if (['SUPER_ADMIN', 'FACILITY_ADMIN'].includes(meR.role)) {
    document.getElementById('adminNavGroup').style.display = 'block';
  }

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${btn.dataset.tab}`));
    });
  });

  document.getElementById('reportForm').addEventListener('submit', saveReport);
  document.getElementById('cancelReportBtn').addEventListener('click', () => document.getElementById('reportOverlay').style.display = 'none');
  document.getElementById('serviceForm').addEventListener('submit', addServiceToCatalogue);

  await loadPending();
  await loadCompleted();
  await loadCatalogue();
})();

async function addServiceToCatalogue(e) {
  e.preventDefault();
  const payload = {
    name: document.getElementById('sc_name').value.trim(),
    modality: document.getElementById('sc_modality').value.trim(),
    body_part: document.getElementById('sc_bodypart').value.trim(),
    price: parseFloat(document.getElementById('sc_price').value) || 0
  };
  const { data, error } = await supabaseClient.from('imaging_services').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'RADIOLOGY', 'imaging_services', data.id, null, payload);
  document.getElementById('serviceForm').reset();
  await loadCatalogue();
}

async function loadCatalogue() {
  const { data } = await supabaseClient.from('imaging_services').select('*').order('name');
  const tbody = document.getElementById('catalogueTable');
  if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="3" class="empty">No services in catalogue yet.</td></tr>'; return; }
  tbody.innerHTML = data.map(s => `<tr><td>${s.name}</td><td>${s.modality || '—'}</td><td>${parseFloat(s.price || 0).toLocaleString()}</td></tr>`).join('');
}

async function fetchItems(statuses) {
  const { data } = await supabaseClient
    .from('imaging_order_items')
    .select('*, imaging_orders(order_number, priority, patient_id, patients(first_name, last_name, mrn)), imaging_reports(*)')
    .in('status', statuses)
    .order('id', { ascending: false });
  return data || [];
}

async function loadPending() {
  const items = await fetchItems(['PENDING']);
  const tbody = document.getElementById('pendingTable');
  if (items.length === 0) { tbody.innerHTML = '<tr><td colspan="5" class="empty">No pending imaging.</td></tr>'; return; }
  tbody.innerHTML = items.map(i => `
    <tr>
      <td class="mono">${i.imaging_orders.order_number}</td>
      <td>${i.imaging_orders.patients.first_name} ${i.imaging_orders.patients.last_name} · ${i.imaging_orders.patients.mrn}</td>
      <td>${i.service_name} ${i.modality ? '(' + i.modality + ')' : ''}</td>
      <td>${i.imaging_orders.priority}</td>
      <td><button class="link-btn" onclick="openReportForm('${i.id}','${i.service_name}')">Enter report</button></td>
    </tr>
  `).join('');
}

async function loadCompleted() {
  const items = await fetchItems(['COMPLETED']);
  const tbody = document.getElementById('completedTable');
  if (items.length === 0) { tbody.innerHTML = '<tr><td colspan="4" class="empty">No completed reports yet.</td></tr>'; return; }
  tbody.innerHTML = items.slice(0, 50).map(i => {
    const r = i.imaging_reports && i.imaging_reports[0];
    return `
    <tr>
      <td class="mono">${i.imaging_orders.order_number}</td>
      <td>${i.imaging_orders.patients.first_name} ${i.imaging_orders.patients.last_name} · ${i.imaging_orders.patients.mrn}</td>
      <td>${i.service_name}</td>
      <td>${r ? r.impression || '—' : '—'}</td>
    </tr>`;
  }).join('');
}

function openReportForm(itemId, serviceName) {
  document.getElementById('reportTitle').textContent = `Report — ${serviceName}`;
  document.getElementById('reportForm').reset();
  document.getElementById('rep_item_id').value = itemId;
  document.getElementById('reportOverlay').style.display = 'flex';
}

async function saveReport(e) {
  e.preventDefault();
  const itemId = document.getElementById('rep_item_id').value;
  const payload = {
    imaging_order_item_id: itemId,
    radiologist_id: meR.id,
    findings: document.getElementById('rep_findings').value.trim(),
    impression: document.getElementById('rep_impression').value.trim(),
    recommendations: document.getElementById('rep_recommendations').value.trim(),
    reported_at: new Date().toISOString()
  };

  const { data, error } = await supabaseClient.from('imaging_reports').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await supabaseClient.from('imaging_order_items').update({ status: 'COMPLETED' }).eq('id', itemId);
  await logAudit('CREATE', 'RADIOLOGY', 'imaging_reports', data.id, null, payload);

  document.getElementById('reportOverlay').style.display = 'none';
  await loadPending();
  await loadCompleted();
}
