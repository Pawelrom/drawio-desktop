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
