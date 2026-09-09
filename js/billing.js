// ==========================================================
// HCMIS — Billing
// ==========================================================

let meB = null;
let invoicesCache = [];
let currentInvoiceId = null;

(async function init() {
  meB = await requireAuth();
  if (!meB) return;

  document.getElementById('whoName').textContent = meB.full_name;
  document.getElementById('whoRole').textContent = meB.role;
  document.getElementById('facilityName').textContent =
    (meB.facilities && meB.facilities.name) ? meB.facilities.name : 'No facility assigned';
  if (['SUPER_ADMIN', 'FACILITY_ADMIN'].includes(meB.role)) {
    document.getElementById('adminNavGroup').style.display = 'block';
  }

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${btn.dataset.tab}`));
    });
  });

  document.getElementById('serviceForm').addEventListener('submit', addService);
  document.getElementById('addManualItemBtn').addEventListener('click', addManualItem);
  document.getElementById('recordPaymentBtn').addEventListener('click', recordPayment);

  let searchTimer;
  document.getElementById('invSearch').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => renderInvoices(e.target.value.trim()), 250);
  });

  await loadStats();
  await loadInvoices();
  await loadServices();
})();

async function loadStats() {
  const today = new Date().toISOString().slice(0, 10);
  const { data: payToday } = await supabaseClient.from('payments').select('amount').gte('payment_date', today + 'T00:00:00');
  const collected = (payToday || []).reduce((s, p) => s + parseFloat(p.amount || 0), 0);

  const { data: openInvs } = await supabaseClient.from('invoices').select('balance').neq('status', 'CANCELLED').gt('balance', 0);
  const outstanding = (openInvs || []).reduce((s, i) => s + parseFloat(i.balance || 0), 0);

  document.getElementById('statToday').textContent = collected.toLocaleString();
  document.getElementById('statOutstanding').textContent = outstanding.toLocaleString();
  document.getElementById('statOpen').textContent = (openInvs || []).length;
}

// ---------------- INVOICES ----------------
async function loadInvoices() {
  const { data } = await supabaseClient.from('invoices').select('*, patients(first_name, last_name, mrn)')
    .order('created_at', { ascending: false }).limit(200);
  invoicesCache = data || [];
  renderInvoices();
}

function renderInvoices(term) {
  let list = invoicesCache;
  if (term) {
    const t = term.toLowerCase();
    list = list.filter(inv => inv.patients && (
      (inv.patients.first_name + ' ' + inv.patients.last_name).toLowerCase().includes(t) ||
      (inv.patients.mrn || '').toLowerCase().includes(t)
    ));
  }
  const tbody = document.getElementById('invoicesTable');
  if (list.length === 0) { tbody.innerHTML = '<tr><td colspan="7" class="empty">No invoices found.</td></tr>'; return; }
  tbody.innerHTML = list.slice(0, 50).map(inv => `
    <tr>
      <td class="mono">${inv.invoice_number}</td>
      <td>${inv.patients ? inv.patients.first_name + ' ' + inv.patients.last_name + ' · ' + inv.patients.mrn : '—'}</td>
      <td class="mono">${inv.invoice_date}</td>
      <td>${parseFloat(inv.total).toLocaleString()}</td>
      <td>${parseFloat(inv.balance).toLocaleString()}</td>
      <td><span class="pill ${inv.status === 'PAID' ? 'active' : 'inactive'}">${inv.status}</span></td>
      <td><button class="link-btn" onclick="openInvoiceDetail('${inv.id}')">Open</button></td>
    </tr>
  `).join('');
}

async function openInvoiceDetail(id) {
  currentInvoiceId = id;
  const { data: inv } = await supabaseClient.from('invoices').select('*, patients(first_name, last_name, mrn)').eq('id', id).single();
  if (!inv) return;

  document.getElementById('invTitle').textContent = inv.invoice_number;
  document.getElementById('invMeta').innerHTML = `
    <div class="grid-2">
      <div><strong>Patient:</strong> ${inv.patients.first_name} ${inv.patients.last_name} · ${inv.patients.mrn}</div>
      <div><strong>Date:</strong> ${inv.invoice_date}</div>
      <div><strong>Subtotal:</strong> ${parseFloat(inv.subtotal).toLocaleString()}</div>
      <div><strong>Total:</strong> ${parseFloat(inv.total).toLocaleString()}</div>
      <div><strong>Paid:</strong> ${parseFloat(inv.amount_paid).toLocaleString()}</div>
      <div><strong>Balance:</strong> ${parseFloat(inv.balance).toLocaleString()}</div>
    </div>
    <span class="pill ${inv.status === 'PAID' ? 'active' : 'inactive'}" style="margin-top:8px; display:inline-block;">${inv.status}</span>
  `;

  const { data: items } = await supabaseClient.from('invoice_items').select('*').eq('invoice_id', id).order('created_at');
  document.getElementById('invItemsTable').innerHTML = (items || []).map(i => `
    <tr>
      <td>${i.description}</td>
      <td>${i.quantity}</td>
      <td>${parseFloat(i.unit_price).toLocaleString()}</td>
      <td>${parseFloat(i.total).toLocaleString()}</td>
      <td>${i.source_module}</td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="empty">No line items yet.</td></tr>';

  const { data: payments } = await supabaseClient.from('payments').select('*').eq('invoice_id', id).order('payment_date', { ascending: false });
  if (payments && payments.length > 0) {
    document.getElementById('invItemsTable').innerHTML += `
      <tr><td colspan="5" style="border:none; padding-top:16px;"><strong>Payments</strong></td></tr>` +
      payments.map(p => `
        <tr><td colspan="3" class="mono">${p.payment_number} · ${new Date(p.payment_date).toLocaleString('en-GB')}</td><td>${p.payment_method}</td><td>${parseFloat(p.amount).toLocaleString()}</td></tr>
      `).join('');
  }

  document.getElementById('invFieldset').disabled = (inv.status === 'CANCELLED');
  document.getElementById('invoiceDetail').style.display = 'block';
  document.getElementById('invoiceDetail').scrollIntoView({ behavior: 'smooth' });
}

function closeInvoiceDetail() {
  document.getElementById('invoiceDetail').style.display = 'none';
  currentInvoiceId = null;
}

async function addManualItem() {
  const description = document.getElementById('mi_desc').value.trim();
  const quantity = parseFloat(document.getElementById('mi_qty').value) || 1;
  const unit_price = parseFloat(document.getElementById('mi_price').value) || 0;
  if (!description || !currentInvoiceId) return;

  const item = await addInvoiceItem(currentInvoiceId, { description, quantity, unit_price, source_module: 'MANUAL' });
  if (!item) { alert('Could not add item.'); return; }
  await logAudit('CREATE', 'BILLING', 'invoice_items', item.id, null, { description, quantity, unit_price });

  document.getElementById('mi_desc').value = '';
  document.getElementById('mi_qty').value = '1';
  document.getElementById('mi_price').value = '';
  await openInvoiceDetail(currentInvoiceId);
  await loadInvoices();
  await loadStats();
}

async function recordPayment() {
  const amount = parseFloat(document.getElementById('pay_amount').value);
  if (!amount || amount <= 0 || !currentInvoiceId) { alert('Enter a valid amount.'); return; }

  const payload = {
    invoice_id: currentInvoiceId,
    amount,
    payment_method: document.getElementById('pay_method').value,
    transaction_reference: document.getElementById('pay_ref').value.trim(),
    received_by: meB.id
  };
  const { data: inv } = await supabaseClient.from('invoices').select('patient_id').eq('id', currentInvoiceId).single();
  payload.patient_id = inv ? inv.patient_id : null;

  const { data, error } = await supabaseClient.from('payments').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'BILLING', 'payments', data.id, null, payload);

  const { data: allPayments } = await supabaseClient.from('payments').select('amount').eq('invoice_id', currentInvoiceId).eq('status', 'COMPLETED');
  const totalPaid = (allPayments || []).reduce((s, p) => s + parseFloat(p.amount || 0), 0);
  await supabaseClient.from('invoices').update({ amount_paid: totalPaid }).eq('id', currentInvoiceId);
  await recalcInvoiceTotals(currentInvoiceId);

  document.getElementById('pay_amount').value = '';
  document.getElementById('pay_ref').value = '';
  alert(`Payment ${data.payment_number} recorded.`);

  await openInvoiceDetail(currentInvoiceId);
  await loadInvoices();
  await loadStats();
}

// ---------------- SERVICE CATALOGUE ----------------
async function loadServices() {
  const { data } = await supabaseClient.from('service_catalogue').select('*').order('category').order('service_name');
  const tbody = document.getElementById('serviceTable');
  if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="3" class="empty">No services yet.</td></tr>'; return; }
  tbody.innerHTML = data.map(s => `
    <tr><td>${s.service_name}</td><td>${s.category}</td><td>${parseFloat(s.standard_price).toLocaleString()}</td></tr>
  `).join('');
}

async function addService(e) {
  e.preventDefault();
  const payload = {
    service_name: document.getElementById('sv_name').value.trim(),
    category: document.getElementById('sv_category').value,
    standard_price: parseFloat(document.getElementById('sv_price').value) || 0
  };
  const { data, error } = await supabaseClient.from('service_catalogue').insert(payload).select().single();
  if (error) { alert(error.message); return; }
  await logAudit('CREATE', 'BILLING', 'service_catalogue', data.id, null, payload);
  document.getElementById('serviceForm').reset();
  await loadServices();
}
