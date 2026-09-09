// ==========================================================
// HCMIS — Insurance & Claims
// ==========================================================

let meIns = null;

(async function init() {
  meIns = await requireAuth();
  if (!meIns) return;

  document.getElementById('whoName').textContent = meIns.full_name;
  document.getElementById('whoRole').textContent = meIns.role;
  document.getElementById('facilityName').textContent =
    (meIns.facilities && meIns.facilities.name) ? meIns.facilities.name : 'No facility assigned';

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${btn.dataset.tab}`));
    });
  });

  document.getElementById('providerForm').addEventListener('submit', submitProvider);
  document.getElementById('policyForm').addEventListener('submit', submitPolicy);
  document.getElementById('claimForm').addEventListener('submit', submitClaim);
  document.getElementById('cl_invoice').addEventListener('change', updateClaimAmountHint);

  let clTimer, plTimer;
  document.getElementById('cl_patient_search').addEventListener('input', (e) => {
    clearTimeout(clTimer);
    const term = e.target.value.trim();
    if (!term) { document.getElementById('cl_patientResults').innerHTML = ''; return; }
    clTimer = setTimeout(() => searchPatientsFor(term, 'cl'), 250);
  });
  document.getElementById('pl_patient_search').addEventListener('input', (e) => {
    clearTimeout(plTimer);
    const term = e.target.value.trim();
    if (!term) { document.getElementById('pl_patientResults').innerHTML = ''; return; }
    plTimer = setTimeout(() => searchPatientsFor(term, 'pl'), 250);
  });

  await loadProviders();
  await loadPolicies();
  await loadClaims();
})();

async function searchPatientsFor(term, prefix) {
  const { data } = await supabaseClient.from('patients').select('*')
    .or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,phone.ilike.%${term}%,mrn.ilike.%${term}%`).limit(8);
  const box = document.getElementById(`${prefix}_patientResults`);
  if (!data || data.length === 0) { box.innerHTML = '<div class="empty">No matches</div>'; return; }
  box.innerHTML = data.map(p => `
    <div class="link-btn" style="display:block; padding:6px 0;" onclick='selectPatientFor(${JSON.stringify(p).replace(/'/g, "&apos;")}, "${prefix}")'>
      ${p.first_name} ${p.last_name} · ${p.mrn}
    </div>
  `).join('');
}

async function selectPatientFor(p, prefix) {
  document.getElementById(`${prefix}_patient_id`).value = p.id;
  document.getElementById(`${prefix}_selectedPatient`).innerHTML = `<span class="pill active">${p.first_name} ${p.last_name} · ${p.mrn}</span>`;
  document.getElementById(`${prefix}_patientResults`).innerHTML = '';
  document.getElementById(`${prefix}_patient_search`).value = '';

  if (prefix === 'cl') {
    const { data: policies } = await supabaseClient.from('patient_policies').select('*, insurance_providers(name)').eq('patient_id', p.id).eq('status', 'ACTIVE');
    document.getElementById('cl_policy').innerHTML = (policies || []).map(pol => `<option value="${pol.provider_id}">${pol.insurance_providers.name} — ${pol.membership_number || ''}</option>`).join('') || '<option value="">No active policy — add one first</option>';

    const { data: invoices } = await supabaseClient.from('invoices').select('*').eq('patient_id', p.id).order('created_at', { ascending: false });
    document.getElementById('cl_invoice').innerHTML = (invoices || []).map(i => `<option value="${i.id}" data-total="${i.total}" data-encounter="${i.encounter_id || ''}">${i.invoice_number} — ${parseFloat(i.total).toLocaleString()}</option>`).join('') || '<option value="">No invoices for this patient</option>';
    updateClaimAmountHint();
  }
}

function updateClaimAmountHint() {
  const sel = document.getElementById('cl_invoice');
  const opt = sel.options[sel.selectedIndex];
  if (opt && opt.dataset.total) document.getElementById('cl_amount').value = opt.dataset.total;
}

// ---------------- PROVIDERS ----------------
async function submitProvider(e) {
  e.preventDefault();
  const payload = {
    name: document.getElementById('pv_name').value.trim(),
    contact_person: document.getElementById('pv_contact').value.trim(),
    phone: document.getElementById('pv_phone').value.trim(),
    email: document.getElementById('pv_email').value.trim()
  };
  const { data, error } = await supabaseClient.from('insurance_providers').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'INSURANCE', 'insurance_providers', data.id, null, payload);
  document.getElementById('providerForm').reset();
  await loadProviders();
}

async function loadProviders() {
  const { data } = await supabaseClient.from('insurance_providers').select('*').order('name');
  const tbody = document.getElementById('providersTable');
  document.getElementById('pl_provider').innerHTML = (data || []).map(p => `<option value="${p.id}">${p.name}</option>`).join('') || '<option value="">Add a provider first</option>';
  if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="3" class="empty">No providers yet.</td></tr>'; return; }
  tbody.innerHTML = data.map(p => `<tr><td>${p.name}</td><td>${p.contact_person || '—'}</td><td>${p.phone || '—'}</td></tr>`).join('');
}

// ---------------- POLICIES ----------------
async function submitPolicy(e) {
  e.preventDefault();
  const patientId = document.getElementById('pl_patient_id').value;
  if (!patientId) { alert('Search for and select a patient first.'); return; }
  const payload = {
    patient_id: patientId,
    provider_id: document.getElementById('pl_provider').value,
    membership_number: document.getElementById('pl_membership').value.trim(),
    scheme: document.getElementById('pl_scheme').value.trim(),
    relationship: document.getElementById('pl_relationship').value.trim() || 'SELF',
    start_date: document.getElementById('pl_start').value || null,
    expiry_date: document.getElementById('pl_expiry').value || null
  };
  const { data, error } = await supabaseClient.from('patient_policies').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'INSURANCE', 'patient_policies', data.id, null, payload);
  document.getElementById('policyForm').reset();
  document.getElementById('pl_patient_id').value = '';
  document.getElementById('pl_selectedPatient').innerHTML = '';
  await loadPolicies();
}

async function loadPolicies() {
  const { data } = await supabaseClient.from('patient_policies').select('*, patients(first_name, last_name, mrn), insurance_providers(name)').order('created_at', { ascending: false }).limit(50);
  const tbody = document.getElementById('policiesTable');
  if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="4" class="empty">No policies linked yet.</td></tr>'; return; }
  tbody.innerHTML = data.map(p => `
    <tr>
      <td>${p.patients.first_name} ${p.patients.last_name} · ${p.patients.mrn}</td>
      <td>${p.insurance_providers.name}</td>
      <td class="mono">${p.membership_number || '—'}</td>
      <td><span class="pill ${p.status === 'ACTIVE' ? 'active' : 'inactive'}">${p.status}</span></td>
    </tr>
  `).join('');
}

// ---------------- CLAIMS ----------------
async function submitClaim(e) {
  e.preventDefault();
  const patientId = document.getElementById('cl_patient_id').value;
  const providerId = document.getElementById('cl_policy').value;
  const invoiceId = document.getElementById('cl_invoice').value;
  if (!patientId || !providerId || !invoiceId) { alert('Select patient, policy and invoice first.'); return; }

  const encounterId = document.getElementById('cl_invoice').selectedOptions[0]?.dataset.encounter || null;
  const payload = {
    patient_id: patientId,
    encounter_id: encounterId || null,
    invoice_id: invoiceId,
    provider_id: providerId,
    claim_amount: parseFloat(document.getElementById('cl_amount').value) || 0,
    created_by: meIns.id
  };
  const { data, error } = await supabaseClient.from('insurance_claims').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'INSURANCE', 'insurance_claims', data.id, null, payload);

  document.getElementById('claimForm').reset();
  document.getElementById('cl_patient_id').value = '';
  document.getElementById('cl_selectedPatient').innerHTML = '';
  await loadClaims();
}

async function loadClaims() {
  const { data } = await supabaseClient.from('insurance_claims').select('*, patients(first_name, last_name, mrn), insurance_providers(name)').order('created_at', { ascending: false }).limit(50);
  const box = document.getElementById('claimsBody');
  if (!data || data.length === 0) { box.innerHTML = '<p class="empty">No claims yet.</p>'; return; }

  box.innerHTML = data.map(c => `
    <div class="panel" style="margin-bottom:10px;">
      <div class="panel-body">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <div>
            <strong class="mono">${c.claim_number}</strong> — ${c.patients.first_name} ${c.patients.last_name} · ${c.patients.mrn}
            <br><span style="font-size:.9rem; color:var(--hc-ink-soft);">${c.insurance_providers.name} · Claimed ${parseFloat(c.claim_amount).toLocaleString()}${c.approved_amount ? ' · Approved ' + parseFloat(c.approved_amount).toLocaleString() : ''}${c.paid_amount > 0 ? ' · Paid ' + parseFloat(c.paid_amount).toLocaleString() : ''}</span>
          </div>
          <span class="pill ${['PAID','APPROVED'].includes(c.status) ? 'active' : (c.status === 'REJECTED' ? 'inactive' : 'inactive')}">${c.status}</span>
        </div>
        <div style="margin-top:10px;">
          ${c.status === 'DRAFT' ? `<button class="link-btn" onclick="submitToInsurer('${c.id}')">Submit</button>` : ''}
          ${['SUBMITTED', 'UNDER_REVIEW'].includes(c.status) ? `
            <button class="link-btn" onclick="approveClaim('${c.id}')">Approve</button> ·
            <button class="link-btn danger" onclick="rejectClaim('${c.id}')">Reject</button>` : ''}
          ${c.status === 'APPROVED' ? `<button class="link-btn" onclick="markClaimPaid('${c.id}','${c.invoice_id}','${c.patient_id}')">Mark paid</button>` : ''}
          ${c.rejection_reason ? `<div style="margin-top:6px; font-size:.85rem; color:var(--hc-red);">Rejected: ${c.rejection_reason}</div>` : ''}
        </div>
      </div>
    </div>
  `).join('');
}

async function submitToInsurer(id) {
  await supabaseClient.from('insurance_claims').update({ status: 'SUBMITTED', submission_date: new Date().toISOString().slice(0, 10) }).eq('id', id);
  await logAudit('UPDATE', 'INSURANCE', 'insurance_claims', id, null, { status: 'SUBMITTED' });
  await loadClaims();
}

async function approveClaim(id) {
  const amountStr = prompt('Approved amount:');
  if (amountStr === null) return;
  const amount = parseFloat(amountStr) || 0;
  await supabaseClient.from('insurance_claims').update({ status: 'APPROVED', approved_amount: amount }).eq('id', id);
  await logAudit('UPDATE', 'INSURANCE', 'insurance_claims', id, null, { status: 'APPROVED', approved_amount: amount });
  await loadClaims();
}

async function rejectClaim(id) {
  const reason = prompt('Rejection reason:');
  if (reason === null) return;
  await supabaseClient.from('insurance_claims').update({ status: 'REJECTED', rejection_reason: reason }).eq('id', id);
  await logAudit('UPDATE', 'INSURANCE', 'insurance_claims', id, null, { status: 'REJECTED', rejection_reason: reason });
  await loadClaims();
}

async function markClaimPaid(claimId, invoiceId, patientId) {
  const paidStr = prompt('Amount paid by insurer:');
  if (paidStr === null) return;
  const paid = parseFloat(paidStr) || 0;

  const { data: claim } = await supabaseClient.from('insurance_claims').select('claim_number').eq('id', claimId).single();

  await supabaseClient.from('insurance_claims').update({
    status: 'PAID', paid_amount: paid, payment_date: new Date().toISOString().slice(0, 10)
  }).eq('id', claimId);

  const { data: payment, error } = await supabaseClient.from('payments').insert({
    invoice_id: invoiceId, patient_id: patientId, amount: paid, payment_method: 'INSURANCE',
    transaction_reference: claim ? claim.claim_number : null, received_by: meIns.id
  }).select().single();
  if (error) { alert(error.message); return; }

  const { data: allPayments } = await supabaseClient.from('payments').select('amount').eq('invoice_id', invoiceId).eq('status', 'COMPLETED');
  const totalPaid = (allPayments || []).reduce((s, p) => s + parseFloat(p.amount || 0), 0);
  await supabaseClient.from('invoices').update({ amount_paid: totalPaid }).eq('id', invoiceId);
  await recalcInvoiceTotals(invoiceId);

  await logAudit('UPDATE', 'INSURANCE', 'insurance_claims', claimId, null, { status: 'PAID', paid_amount: paid });
  await loadClaims();
}
