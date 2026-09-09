// ==========================================================
// HCMIS — Print & Share helper
// Opens a clean, branded printable version of a document in a
// new tab, with a Print button and a Share button. Share renders
// the document to an image and hands it to the device's native
// share sheet (navigator.share) — on Android/Chrome this includes
// WhatsApp among the apps offered. If the device doesn't support
// file sharing, it downloads the image instead so it can be
// attached manually.
// ==========================================================

function openPrintDocument(title, facilityName, bodyHtml) {
  const win = window.open('', '_blank');
  if (!win) { alert('Please allow pop-ups to print or share this document.'); return; }

  win.document.write(`
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  body{font-family:'IBM Plex Sans',sans-serif; color:#12211F; max-width:640px; margin:24px auto; padding:0 16px;}
  .doc-header{display:flex; justify-content:space-between; align-items:flex-end; border-bottom:2px solid #0F3A3B; padding-bottom:12px; margin-bottom:20px;}
  .doc-header .facility{font-weight:700; font-size:1.1rem; color:#0F3A3B;}
  .doc-header .doctitle{font-family:'IBM Plex Mono',monospace; font-size:.85rem; color:#4E6360;}
  table{width:100%; border-collapse:collapse; margin:12px 0;}
  th,td{text-align:left; padding:6px 8px; border-bottom:1px solid #DCE6E3; font-size:.92rem;}
  th{color:#4E6360; font-size:.78rem;}
  .mono{font-family:'IBM Plex Mono',monospace;}
  .row{display:flex; justify-content:space-between; margin:4px 0; font-size:.92rem;}
  .label{color:#4E6360;}
  .total-row{font-weight:700; border-top:2px solid #12211F; padding-top:8px; margin-top:8px;}
  .actions{margin-top:28px; display:flex; gap:10px;}
  button{padding:10px 18px; border-radius:6px; border:1px solid #DCE6E3; background:#fff; font-family:'IBM Plex Sans',sans-serif; font-size:.92rem; cursor:pointer;}
  button.primary{background:#175C58; color:#fff; border-color:#175C58;}
  @media print { .actions{display:none;} }
</style>
</head>
<body>
  <div class="doc-header">
    <div class="facility">${facilityName || 'HCMIS'}</div>
    <div class="doctitle">${title}</div>
  </div>
  <div id="printArea">${bodyHtml}</div>
  <div class="actions">
    <button class="primary" onclick="window.print()">Print</button>
    <button onclick="shareDoc()">Share</button>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"></script>
  <script>
    async function shareDoc() {
      const target = document.body;
      const canvas = await html2canvas(target, { backgroundColor: '#ffffff' });
      canvas.toBlob(async (blob) => {
        const file = new File([blob], ${JSON.stringify(title.replace(/[^a-z0-9]+/gi, '_'))} + '.png', { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: ${JSON.stringify(title)} });
            return;
          } catch (e) { /* user cancelled or share failed, fall through to download */ }
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = file.name; a.click();
        alert('Saved as an image — you can attach it manually in WhatsApp or elsewhere.');
      }, 'image/png');
    }
  </script>
</body>
</html>
  `);
  win.document.close();
}
