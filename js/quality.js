// ==========================================================
// HCMIS — Quality
// ==========================================================

let meQ = null;

(async function init() {
  meQ = await requireAuth();
  if (!meQ) return;

  document.getElementById('whoName').textContent = meQ.full_name;
  document.getElementById('whoRole').textContent = meQ.role;
  document.getElementById('facilityName').textContent =
    (meQ.facilities && meQ.facilities.name) ? meQ.facilities.name : 'No facility assigned';

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${btn.dataset.tab}`));
    });
  });

  document.getElementById('incidentForm').addEventListener('submit', reportIncident);
  document.getElementById('complaintForm').addEventListener('submit', logComplaint);
  document.getElementById('updateForm').addEventListener('submit', saveUpdate);
  document.getElementById('cancelUpdateBtn').addEventListener('click', () => document.getElementById('updateOverlay').style.display = 'none');

  await loadIncidents();
  await loadComplaints();
})();

// ---------------- INCIDENTS ----------------
async function reportIncident(e) {
  e.preventDefault();
  const payload = {
    facility_id: meQ.facility_id || null,
    incident_type: document.getElementById('in_type').value.trim(),
    severity: document.getElementById('in_severity').value,
    description: document.getElementById('in_description').value.trim(),
    reported_by: meQ.id
  };
  const { data, error } = await supabaseClient.from('incidents').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'QUALITY', 'incidents', data.id, null, payload);
  document.getElementById('incidentForm').reset();
  await loadIncidents();
}

async function loadIncidents() {
  const { data } = await supabaseClient.from('incidents').select('*').order('created_at', { ascending: false }).limit(50);
  const box = document.getElementById('incidentsBody');
  if (!data || data.length === 0) { box.innerHTML = '<p class="empty">No incidents reported.</p>'; return; }

  box.innerHTML = data.map(i => `
    <div class="panel" style="margin-bottom:10px;">
      <div class="panel-body">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <div>
            <strong class="mono">${i.incident_number}</strong> — ${i.incident_type || 'Incident'}
            <br><span style="font-size:.9rem;">${i.description}</span>
          </div>
          <div style="display:flex; gap:8px; align-items:center;">
            <span class="pill ${i.severity === 'CRITICAL' || i.severity === 'HIGH' ? 'inactive' : 'active'}">${i.severity}</span>
            <span class="pill ${i.status === 'CLOSED' || i.status === 'RESOLVED' ? 'active' : 'inactive'}">${i.status}</span>
          </div>
        </div>
        ${i.investigation || i.corrective_action ? `<div style="margin-top:8px; font-size:.88rem; color:var(--hc-ink-soft);">
          ${i.investigation ? 'Investigation: ' + i.investigation + '<br>' : ''}${i.corrective_action ? 'Action: ' + i.corrective_action : ''}
        </div>` : ''}
        ${i.status !== 'CLOSED' ? `<button class="link-btn" style="margin-top:8px;" onclick="openUpdate('incident','${i.id}','${i.status}')">Update</button>` : ''}
      </div>
    </div>
  `).join('');
}

// ---------------- COMPLAINTS ----------------
async function logComplaint(e) {
  e.preventDefault();
  const payload = {
    complainant_name: document.getElementById('cm_name').value.trim(),
    category: document.getElementById('cm_category').value.trim(),
    description: document.getElementById('cm_description').value.trim()
  };
  const { data, error } = await supabaseClient.from('complaints').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'QUALITY', 'complaints', data.id, null, payload);
  document.getElementById('complaintForm').reset();
  await loadComplaints();
}

async function loadComplaints() {
  const { data } = await supabaseClient.from('complaints').select('*').order('received_at', { ascending: false }).limit(50);
  const box = document.getElementById('complaintsBody');
  if (!data || data.length === 0) { box.innerHTML = '<p class="empty">No complaints logged.</p>'; return; }

  box.innerHTML = data.map(c => `
    <div class="panel" style="margin-bottom:10px;">
      <div class="panel-body">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <div>
            <strong class="mono">${c.complaint_number}</strong> — ${c.category || 'General'} ${c.complainant_name ? '(' + c.complainant_name + ')' : ''}
            <br><span style="font-size:.9rem;">${c.description}</span>
          </div>
          <span class="pill ${c.status === 'CLOSED' || c.status === 'RESOLVED' ? 'active' : 'inactive'}">${c.status}</span>
        </div>
        ${c.response ? `<div style="margin-top:8px; font-size:.88rem; color:var(--hc-ink-soft);">Response: ${c.response}</div>` : ''}
        ${c.status !== 'CLOSED' ? `<button class="link-btn" style="margin-top:8px;" onclick="openUpdate('complaint','${c.id}','${c.status}')">Update</button>` : ''}
      </div>
    </div>
  `).join('');
}

// ---------------- SHARED UPDATE WORKFLOW ----------------
function openUpdate(type, id, currentStatus) {
  document.getElementById('up_type').value = type;
  document.getElementById('up_id').value = id;
  document.getElementById('updateForm').reset();
  document.getElementById('up_status').value = currentStatus === 'REPORTED' || currentStatus === 'RECEIVED' ? 'INVESTIGATING' : currentStatus;
  document.getElementById('updateTitle').textContent = type === 'incident' ? 'Update incident' : 'Update complaint';
  document.getElementById('up_rootcause_field').style.display = type === 'incident' ? 'block' : 'none';
  document.getElementById('up_response_field').style.display = type === 'complaint' ? 'block' : 'none';
  document.getElementById('updateOverlay').style.display = 'flex';
}

async function saveUpdate(e) {
  e.preventDefault();
  const type = document.getElementById('up_type').value;
  const id = document.getElementById('up_id').value;
  const status = document.getElementById('up_status').value;
  const isClosing = status === 'CLOSED';

  if (type === 'incident') {
    const payload = {
      investigation: document.getElementById('up_investigation').value.trim(),
      root_cause: document.getElementById('up_rootcause').value.trim(),
      corrective_action: document.getElementById('up_action').value.trim(),
      status,
      assigned_to: meQ.id,
      closed_at: isClosing ? new Date().toISOString() : null
    };
    await supabaseClient.from('incidents').update(payload).eq('id', id);
    await logAudit('UPDATE', 'QUALITY', 'incidents', id, null, payload);
    await loadIncidents();
  } else {
    const payload = {
      investigation: document.getElementById('up_investigation').value.trim(),
      response: document.getElementById('up_response').value.trim(),
      corrective_action: document.getElementById('up_action').value.trim(),
      status,
      assigned_to: meQ.id,
      closed_at: isClosing ? new Date().toISOString() : null
    };
    await supabaseClient.from('complaints').update(payload).eq('id', id);
    await logAudit('UPDATE', 'QUALITY', 'complaints', id, null, payload);
    await loadComplaints();
  }

  document.getElementById('updateOverlay').style.display = 'none';
}
