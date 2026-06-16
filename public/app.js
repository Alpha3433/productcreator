'use strict';

// --- element refs ----------------------------------------------------------
const form = document.getElementById('launch-form');
const btn = document.getElementById('launch-btn');
const formErrors = document.getElementById('form-errors');
const resultEl = document.getElementById('result');
const sessionCard = document.getElementById('session-card');
const sessionList = document.getElementById('session-list');

const existingField = document.getElementById('existing-field');
const imagesField = document.getElementById('images-field');
const imgReq = document.getElementById('img-req');
const scheduleField = document.getElementById('schedule-field');
const statusSel = document.getElementById('status');

let appConfig = {};

// --- load non-secret config ------------------------------------------------
fetch('/api/config')
  .then((r) => r.json())
  .then((cfg) => {
    appConfig = cfg;
    const store = document.getElementById('cfg-store');
    if (cfg.store) store.textContent = `— ${cfg.store}`;
    if (!cfg.hasToken) {
      showFormErrors([
        'No admin token configured (.env). Live launches will fail — but you can still use Dry run.',
      ]);
    }
  })
  .catch(() => {});

// --- conditional fields ----------------------------------------------------
function currentMode() {
  return document.querySelector('input[name="mode"]:checked').value;
}

function syncMode() {
  const existing = currentMode() === 'EXISTING';
  existingField.classList.toggle('hidden', !existing);
  // In EXISTING mode images (and the master title) are optional.
  imgReq.classList.toggle('hidden', existing);
}

function syncStatus() {
  scheduleField.classList.toggle('hidden', statusSel.value !== 'SCHEDULE');
}

document.querySelectorAll('input[name="mode"]').forEach((el) =>
  el.addEventListener('change', syncMode)
);
statusSel.addEventListener('change', syncStatus);
syncMode();
syncStatus();

// --- submit ----------------------------------------------------------------
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  hide(formErrors);
  hide(resultEl);

  const mode = currentMode();
  const title = document.getElementById('title').value.trim();
  const existingProductId = document.getElementById('existingProductId').value.trim();
  const images = document.getElementById('images').files;
  const status = statusSel.value;
  const publishDateRaw = document.getElementById('publishDate').value;
  const dryRun = document.getElementById('dryRun').checked;

  // Inline validation.
  const errs = [];
  if (mode === 'DUPLICATE' && !title) errs.push('Title is required.');
  if (mode === 'EXISTING' && !existingProductId) errs.push('Existing product ID is required.');
  if (mode !== 'EXISTING' && images.length === 0) errs.push('At least one image is required.');
  if (status === 'SCHEDULE' && !publishDateRaw) errs.push('Pick a date/time to schedule.');
  if (errs.length) return showFormErrors(errs);

  // Build the multipart payload.
  const fd = new FormData();
  fd.append('mode', mode);
  fd.append('title', title);
  fd.append('existingProductId', existingProductId);
  fd.append('priceOverride', document.getElementById('priceOverride').value.trim());
  fd.append('status', status);
  fd.append('dryRun', String(dryRun));
  fd.append('async', String(document.getElementById('async').checked));
  if (publishDateRaw) {
    // Convert the local datetime to an ISO string (with the browser's tz).
    fd.append('publishDate', new Date(publishDateRaw).toISOString());
  }
  for (const f of images) fd.append('images', f);

  setLoading(true);
  try {
    const res = await fetch('/api/launch', { method: 'POST', body: fd });
    const data = await res.json();
    if (!data.ok) return renderError(data);
    if (data.dryRun) return renderDryRun(data);
    renderSuccess(data);
    addToSession(data);
  } catch (err) {
    renderError({ error: 'Could not reach the server.', details: { reason: err.message } });
  } finally {
    setLoading(false);
  }
});

// --- rendering -------------------------------------------------------------
function renderSuccess(data) {
  const warnings = (data.warnings || []).filter(Boolean);
  resultEl.className = 'card result ok';
  resultEl.innerHTML = `
    <h2>✅ Launched <span class="badge ${data.status}">${data.status}</span></h2>
    <p><strong>${escapeHtml(data.title || '')}</strong></p>
    <p class="links">
      ${data.adminUrl ? `<a href="${data.adminUrl}" target="_blank" rel="noopener">Open in admin →</a>` : ''}
      ${data.storefrontUrl ? `<a href="${data.storefrontUrl}" target="_blank" rel="noopener">View on storefront →</a>` : ''}
    </p>
    ${warnings.length ? warnBlock(warnings) : ''}
  `;
  show(resultEl);
}

function renderDryRun(data) {
  resultEl.className = 'card result ok';
  resultEl.innerHTML = `
    <h2>🧪 Dry run — no changes made</h2>
    <p class="muted">These calls would run, in order:</p>
    <pre class="plan">${escapeHtml(JSON.stringify(data.plan, null, 2))}</pre>
    ${(data.warnings || []).length ? warnBlock(data.warnings) : ''}
  `;
  show(resultEl);
}

function renderError(data) {
  resultEl.className = 'card result bad';
  let detail = '';
  if (data.errors) detail = `<ul>${data.errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul>`;
  else if (data.details) detail = `<pre class="plan">${escapeHtml(JSON.stringify(data.details, null, 2))}</pre>`;
  resultEl.innerHTML = `
    <h2>❌ Launch failed</h2>
    <p>${escapeHtml(data.error || 'Something went wrong.')}</p>
    ${detail}
  `;
  show(resultEl);
}

function warnBlock(warnings) {
  return `<div class="warnlist"><strong>⚠️ Reminders</strong><ul>${warnings
    .map((w) => `<li>${escapeHtml(w)}</li>`)
    .join('')}</ul></div>`;
}

function addToSession(data) {
  show(sessionCard);
  const li = document.createElement('li');
  const time = new Date().toLocaleTimeString();
  li.innerHTML = `<span class="muted">${time}</span> —
    ${data.adminUrl ? `<a href="${data.adminUrl}" target="_blank" rel="noopener">${escapeHtml(data.title || data.productId)}</a>` : escapeHtml(data.title || data.productId)}
    <span class="badge ${data.status}">${data.status}</span>`;
  sessionList.prepend(li);
}

// --- helpers ---------------------------------------------------------------
function setLoading(on) {
  btn.disabled = on;
  btn.innerHTML = on ? '<span class="spinner"></span>Launching…' : 'Launch product';
}
function show(el) { el.classList.remove('hidden'); }
function hide(el) { el.classList.add('hidden'); }
function showFormErrors(list) {
  formErrors.innerHTML = `<strong>Please fix:</strong><ul>${list
    .map((e) => `<li>${escapeHtml(e)}</li>`)
    .join('')}</ul>`;
  show(formErrors);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
