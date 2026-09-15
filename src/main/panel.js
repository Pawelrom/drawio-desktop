// ─── Highlight toggle ────────────────────────────────────────────────────────

var highlightBtn = document.getElementById('highlightToggle');
var highlightEnabled = localStorage.getItem('highlightEnabled') !== 'false';

function applyHighlightState(enabled)
{
  highlightEnabled = enabled;
  localStorage.setItem('highlightEnabled', enabled ? 'true' : 'false');
  highlightBtn.textContent = enabled ? 'Włączone' : 'Wyłączone';
  highlightBtn.className = 'toggle-btn ' + (enabled ? 'on' : 'off');
  window.panelBridge.sendCmd('highlight-toggle', {value: enabled});
}

// Przywróć stan i wyślij do renderera przy otwarciu panelu
applyHighlightState(highlightEnabled);

highlightBtn.addEventListener('click', function ()
{
  applyHighlightState(!highlightEnabled);
});

// ─── Numerowanie ─────────────────────────────────────────────────────────────

var numberBtn = document.getElementById('numberBtn');
var numberStatus = document.getElementById('numberStatus');

function setNumberStatus(text, cssClass)
{
  numberStatus.textContent = text;
  numberStatus.className = 'status ' + (cssClass || '');
  if (cssClass === 'success' || cssClass === 'error')
  {
    setTimeout(function () { numberStatus.textContent = ''; numberStatus.className = 'status'; }, 3000);
  }
}

numberBtn.addEventListener('click', function ()
{
  numberBtn.disabled = true;
  setNumberStatus('Numerowanie...', '');
  window.panelBridge.sendCmd('number', {});
});

window.panelBridge.onResult('number-progress', function (msg)
{
  setNumberStatus('Numerowanie: strona ' + msg.current + '/' + msg.total, '');
});

window.panelBridge.onResult('number-done', function (msg)
{
  numberBtn.disabled = false;
  setNumberStatus('Ponumerowano: ' + msg.count + ' elementów', 'success');
});

window.panelBridge.onResult('number-status', function (msg)
{
  numberBtn.disabled = false;
  setNumberStatus(msg.msg, 'error');
});

// ─── Eksport ──────────────────────────────────────────────────────────────────

var folderInput = document.getElementById('folderInput');
var browseBtn = document.getElementById('browseBtn');
var exportBtn = document.getElementById('exportBtn');
var exportStatus = document.getElementById('exportStatus');
var allPagesCheck = document.getElementById('allPages');
var imagesModeDiv = document.getElementById('imagesMode');

// Przywróć zapisany stan
folderInput.value = localStorage.getItem('exportFolder') || '';
allPagesCheck.checked = localStorage.getItem('exportAllPages') === 'true';
imagesModeDiv.className = 'images-mode' + (allPagesCheck.checked ? ' visible' : '');

var savedImagesMode = localStorage.getItem('exportImagesMode') || 'current';
var imageModeRadios = document.querySelectorAll('input[name="imagesMode"]');
imageModeRadios.forEach(function (r) { r.checked = r.value === savedImagesMode; });

var savedFormats = JSON.parse(localStorage.getItem('exportFormats') || '["xml","json"]');
document.querySelectorAll('.formats-grid input[type="checkbox"]').forEach(function (cb)
{
  cb.checked = savedFormats.indexOf(cb.value) !== -1;
  cb.addEventListener('change', saveFormatState);
});

function saveFormatState()
{
  var checked = [];
  document.querySelectorAll('.formats-grid input[type="checkbox"]').forEach(function (cb)
  {
    if (cb.checked) checked.push(cb.value);
  });
  localStorage.setItem('exportFormats', JSON.stringify(checked));
}

allPagesCheck.addEventListener('change', function ()
{
  localStorage.setItem('exportAllPages', allPagesCheck.checked ? 'true' : 'false');
  imagesModeDiv.className = 'images-mode' + (allPagesCheck.checked ? ' visible' : '');
});

imageModeRadios.forEach(function (r)
{
  r.addEventListener('change', function ()
  {
    localStorage.setItem('exportImagesMode', r.value);
  });
});

folderInput.addEventListener('change', function ()
{
  localStorage.setItem('exportFolder', folderInput.value.trim());
});

browseBtn.addEventListener('click', function ()
{
  window.panelBridge.browseFolder().then(function (folder)
  {
    if (folder)
    {
      folderInput.value = folder;
      localStorage.setItem('exportFolder', folder);
    }
  });
});

function setExportStatus(text, cssClass)
{
  exportStatus.textContent = text;
  exportStatus.className = 'status ' + (cssClass || '');
  if (cssClass === 'success' || cssClass === 'error')
  {
    setTimeout(function () { exportStatus.textContent = ''; exportStatus.className = 'status'; }, 3000);
  }
}

exportBtn.addEventListener('click', function ()
{
  var folder = folderInput.value.trim();
  if (!folder)
  {
    setExportStatus('Wybierz folder eksportu', 'error');
    return;
  }

  var formats = [];
  document.querySelectorAll('.formats-grid input[type="checkbox"]').forEach(function (cb)
  {
    if (cb.checked) formats.push(cb.value);
  });

  if (formats.length === 0)
  {
    setExportStatus('Zaznacz co najmniej jeden format', 'error');
    return;
  }

  var imagesMode = 'current';
  imageModeRadios.forEach(function (r) { if (r.checked) imagesMode = r.value; });

  exportBtn.disabled = true;
  setExportStatus('Eksportowanie...', '');

  window.panelBridge.sendCmd('export',
  {
    formats: formats,
    folder: folder,
    allPages: allPagesCheck.checked,
    imagesMode: imagesMode
  });
});

window.panelBridge.onResult('export-summary', function (msg)
{
  exportBtn.disabled = false;
  var text = '';
  if (msg.succeeded && msg.succeeded.length > 0)
  {
    text = 'Wyeksportowano: ' + msg.succeeded.join(', ');
  }
  if (msg.failed && msg.failed.length > 0)
  {
    text += (text ? '. ' : '') + 'Błąd: ' + msg.failed.join(', ');
  }
  var cssClass = (msg.failed && msg.failed.length > 0) ? 'error' : 'success';
  setExportStatus(text || 'Gotowe', cssClass);
});

window.panelBridge.onResult('export-error', function (msg)
{
  exportBtn.disabled = false;
  setExportStatus(msg.msg || 'Błąd eksportu', 'error');
});
