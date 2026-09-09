// ==========================================================
// HCMIS — Billing helpers (shared across encounter, pharmacy, billing pages)
// ==========================================================

async function findOrCreateInvoice(patientId, encounterId, facilityId, createdBy) {
  if (encounterId) {
    const { data } = await supabaseClient.from('invoices').select('*')
      .eq('encounter_id', encounterId).neq('status', 'CANCELLED')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (data) return data;
  }
  const { data: inv, error } = await supabaseClient.from('invoices').insert({
    patient_id: patientId, encounter_id: encounterId || null, facility_id: facilityId || null, created_by: createdBy
  }).select().single();
  if (error) { console.error(error); return null; }
  return inv;
}

async function addInvoiceItem(invoiceId, item) {
  const total = (item.quantity || 1) * (item.unit_price || 0);
  const { data, error } = await supabaseClient.from('invoice_items').insert({
    invoice_id: invoiceId,
    description: item.description,
    quantity: item.quantity || 1,
    unit_price: item.unit_price || 0,
    total,
    source_module: item.source_module || 'MANUAL',
    source_record_id: item.source_record_id || null
  }).select().single();
  if (error) { console.error(error); return null; }
  await recalcInvoiceTotals(invoiceId);
  return data;
}

async function recalcInvoiceTotals(invoiceId) {
  const { data: items } = await supabaseClient.from('invoice_items').select('total').eq('invoice_id', invoiceId);
  const subtotal = (items || []).reduce((sum, i) => sum + parseFloat(i.total || 0), 0);
  const { data: inv } = await supabaseClient.from('invoices').select('*').eq('id', invoiceId).single();
  if (!inv) return;
  const total = subtotal - (inv.discount || 0) + (inv.tax || 0);
  const balance = total - (inv.amount_paid || 0);
  let status = 'PENDING';
  if (total > 0 && balance <= 0) status = 'PAID';
  else if (inv.amount_paid > 0 && balance > 0) status = 'PARTIALLY_PAID';
  await supabaseClient.from('invoices').update({
    subtotal, total, balance, status, updated_at: new Date().toISOString()
  }).eq('id', invoiceId);
}

async function findCatalogueService(nameHint, category) {
  let query = supabaseClient.from('service_catalogue').select('*').eq('status', 'ACTIVE');
  if (category) query = query.eq('category', category);
  const { data } = await query;
  if (!data || data.length === 0) return null;
  const lower = nameHint.toLowerCase();
  return data.find(s =>
    lower.includes(s.service_name.toLowerCase()) || s.service_name.toLowerCase().includes(lower)
  ) || null;
}
