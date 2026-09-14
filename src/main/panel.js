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
