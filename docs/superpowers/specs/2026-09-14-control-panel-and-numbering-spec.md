# Control Panel + Extension 3 (Numerowanie) — Spec

**Data:** 2026-09-14  
**Projekt:** draw.io Desktop fork — rozszerzenia Pawła  
**Repo:** `c:/Projects/drawio-desktop` (branch `dev`) + submoduł `drawio` (branch `extensions`)

---

## Cel

Dodanie:
1. **Panelu kontrolnego** (BrowserWindow) otwieranego z menu "Rozszerzenia"
2. **Extension 3 — Numerowanie elementów** według topologii połączeń (DFS z priorytetem najdłuższej ścieżki)
3. **Rozszerzenie eksportu** na 7 formatów (PDF, XML, JSON, SVG, PNG, JPEG, HTML) z wyborem przez checkboxy

---

## Architektura ogólna

```
┌─────────────────────────┐        ┌──────────────────────────────┐
│  control-panel.html     │        │  draw.io renderer window     │
│  (BrowserWindow)        │        │                              │
│  panelBridge.sendCmd()──┼──IPC──▶┼─ ext-cmd handler            │
│  panelBridge.onResult() │◀───────┼─ ext-result                 │
└─────────────────────────┘        │  highlight-selection.js      │
           │                       │  numbering.js                │
           │ ipcRenderer           │  export-all.js               │
           ▼                       └──────────────────────────────┘
┌─────────────────────────┐
│  electron.js (main)     │
│  ipcMain.on('ext-cmd')  │
│  router → focused win   │
│  .webContents.send()    │
└─────────────────────────┘
```

**Kanały IPC:**
- `ext-cmd` — Panel → Main → Renderer (komendy)
- `ext-result` — Renderer → Main → Panel (odpowiedzi)

Każde rozszerzenie rejestruje jeden handler na `ext-cmd` i filtruje po `type`. Dodanie nowego rozszerzenia nie wymaga zmian w `electron.js`.

**Aktywne okno:** panel kontroluje **ostatnio aktywne** okno draw.io (`BrowserWindow.getFocusedWindow()` lub śledzone przez `focus` event). Panel zamyka się razem z ostatnim oknem draw.io.

---

## Pliki — zmiany

| Plik | Akcja |
|------|-------|
| `src/main/control-panel.html` | NOWY |
| `src/main/control-panel-preload.js` | NOWY |
| `src/main/electron.js` | MODYFIKACJA |
| `drawio/src/main/webapp/js/extensions/numbering.js` | NOWY |
| `drawio/src/main/webapp/js/extensions/highlight-selection.js` | MODYFIKACJA |
| `drawio/src/main/webapp/js/extensions/export-all.js` | MODYFIKACJA |
| `drawio/src/main/webapp/index.html` | MODYFIKACJA |

---

## Panel kontrolny (BrowserWindow)

### Okno
- Rozmiar: 280×420px, `resizable: false`
- Tytuł: `"Panel rozszerzeń"`
- Singleton: jeśli okno już istnieje → `focus()`, nie tworzy nowego
- `alwaysOnTop: false`
- Zamyka się razem z ostatnim oknem draw.io
- **Menu entry:** nowe menu **"Rozszerzenia"** (przed "Help") → **"Panel rozszerzeń"**

### UI layout

```
┌──────────────────────────────────┐
│  Panel rozszerzeń                │
├──────────────────────────────────┤
│  Podświetlenie zaznaczenia       │
│  [●  Włączone              ]     │  ← toggle
├──────────────────────────────────┤
│  Numerowanie elementów           │
│  [ Numeruj ]                     │
│  "Numerowanie: strona 2/4..."    │  ← status (znika po 3s lub stały podczas operacji)
├──────────────────────────────────┤
│  Eksportuj...                    │
│  Folder: [C:\exports\___] [...]  │  ← edytowalne pole + Przeglądaj
│                                  │
│  ☑ PDF    ☑ XML    ☑ JSON       │
│  ☑ SVG    ☑ PNG    ☑ JPEG      │
│  ☑ HTML                         │
│                                  │
│  ☑ Wszystkie strony              │
│    Obrazki: ◉ per strona         │  ← radio, widoczne gdy "Wszystkie strony" ON
│             ○ tylko bieżąca      │
│                                  │
│  [ Eksportuj ]                   │
│  "Wyeksportowano: XML, JSON..."  │  ← status (znika po 3s)
└──────────────────────────────────┘
```

### Implementacja
- Czysty HTML/CSS/JS, bez frameworka
- **localStorage panelu** — persystuje: stan toggle highlight, ścieżka folderu, zaznaczone formaty, checkbox "Wszystkie strony", radio obrazków
- Styl: czcionka systemowa, szare tło, dopasowane do draw.io Desktop

### Zachowanie przycisków i walidacja

| Sytuacja | Zachowanie |
|----------|-----------|
| Folder pusty + klik "Eksportuj" | Status: "Wybierz folder eksportu" (nie eksportuje) |
| Ścieżka wpisana ręcznie nie istnieje | Status: "Folder nie istnieje" (przy kliknięciu Eksportuj) |
| Klik "Eksportuj" podczas eksportu | Przycisk zablokowany, tekst "Eksportowanie..." |
| Eksport zakończony sukcesem | Status: "Wyeksportowano do: {ścieżka}" — znika po 3s |
| Eksport częściowy (niektóre formaty nie udały się) | "Wyeksportowano: XML, JSON. Błąd: PNG" — znika po 3s |
| Klik "Przeglądaj" | Folder picker dialog, wynik wpisany do pola |

### `control-panel-preload.js`
Eksponuje `window.panelBridge` przez `contextBridge`:
```javascript
panelBridge.sendCmd(type, payload)    // ipcRenderer.send('ext-cmd', {type, payload})
panelBridge.onResult(type, callback)  // ipcRenderer.on('ext-result', filter by type)
```

### Routing w `electron.js`
```javascript
let controlPanelWin = null;
let lastFocusedDrawioWin = null;

// Śledź aktywne okno draw.io
app.on('browser-window-focus', (e, win) => {
  if (win !== controlPanelWin) lastFocusedDrawioWin = win;
});

ipcMain.on('ext-cmd', (e, msg) => {
  const target = lastFocusedDrawioWin;
  if (!target || target.isDestroyed()) return;

  if (msg.type === 'export') {
    // Folder pochodzi z panelu (msg.payload.folder) — brak dialogu
    target.webContents.send('ext-cmd', msg);
  } else {
    target.webContents.send('ext-cmd', msg);
  }
});

// Forwarding ext-result z renderera do panelu
ipcMain.on('ext-result', (e, msg) => {
  if (controlPanelWin && !controlPanelWin.isDestroyed()) {
    controlPanelWin.webContents.send('ext-result', msg);
  }
});
```

---

## Extension 3 — Numerowanie elementów

### Plik
`drawio/src/main/webapp/js/extensions/numbering.js`

### Wyzwalanie
`ext-cmd {type: 'number'}` → uruchamia algorytm na wszystkich stronach → wysyła postęp i wynik przez `ext-result`.

### Zakres — wszystkie strony, licznik ciągły
- Numerujemy wszystkie strony diagramu w kolejności zakładek (lewa → prawa)
- Licznik globalny ciągnie się przez strony (strona 1: 1–5, strona 2: 6–12 itd.)
- Bieżąca strona na końcu pozostaje aktywna

### Dostęp do modelu strony
Preferowane: bezpośredni dostęp do `ui.pages[i].graph` bez wywołania `ui.selectPage`.  
Fallback (jeśli API nie pozwala): `ui.selectPage(page)` + numerowanie + powrót do strony startowej.  
Implementer weryfikuje dostępność API w trakcie implementacji.

### Postęp
```javascript
// Przed każdą stroną:
window.electron.sendMessage('ext-result', {type: 'number-progress', current: i+1, total: pages.length});
// Po zakończeniu:
window.electron.sendMessage('ext-result', {type: 'number-done', count: totalNumbered});
// Brak kwalifikujących węzłów:
window.electron.sendMessage('ext-result', {type: 'number-status', msg: 'Nie znaleziono elementów do numerowania'});
```

### Reguły kwalifikacji węzła
Węzeł **wchodzi** do zbioru numerowanych jeśli spełnia WSZYSTKIE:
1. Jest wierzchołkiem (`cell.isVertex() === true`)
2. Nie jest ramką (`graph.isSwimlane(cell) === false`)
3. Ma co najmniej jedną krawędź wchodzącą LUB wychodzącą

Węzły spełniające 1–3 uczestniczą w DFS. Numer jest przypisywany tylko węzłom które **dodatkowo** mają child cell z `align=right` AND `verticalAlign=top` w stylu. Węzły bez takiego child cella są odwiedzane (nie wracamy do nich), ale nie dostają numeru.

### Węzeł startowy (per podgraf, per strona)
- Spośród węzłów spełniających warunki 1–3
- Pozycja **absolutna**: dla węzłów wewnątrz ramki = `frame.geometry.x + node.geometry.x`, analogicznie Y
- Startowy = min(`absoluteX + absoluteY`), remis → min(`absoluteX`)
- Wiele rozłącznych podgrafów: każdy dostaje własny start, przetwarzane w kolejności od lewego górnego rogu, licznik globalny

### Algorytm DFS
```
counter = 1  (globalny przez strony)
visited = new Set()

function dfs(node):
  if node in visited: return
  visited.add(node)

  child = findTopRightChild(node)   // align=right + verticalAlign=top
  if child:
    model.setValue(child, String(counter))
    counter++

  outEdges = graph.getEdges(node, null, false, true, false)
  neighbors = outEdges
    .map(e → e.target)
    .filter(n → n != null && !visited.has(n) && !graph.isSwimlane(n))

  if neighbors.length >= 2:
    // downstream_length: DFS liczący wszystkie osiągalne nieodwiedzone węzły (1–3), pomija ramki
    neighbors.sort((a, b) => downstreamLength(b, visited) - downstreamLength(a, visited))
    // remis → kolejność z modelu

  for each neighbor in neighbors:
    dfs(neighbor)
```

### Modyfikacja modelu
```javascript
graph.model.beginUpdate();
try {
  // Najpierw wyczyść istniejące numery (setValue(child, ''))
  // Potem DFS z przypisywaniem
} finally {
  graph.model.endUpdate();
}
```
- Czyści poprzednie numery przed nowym przebiegiem (nadpisuje od zera)
- Pojedyncze Ctrl+Z cofa całe numerowanie

### Krawędzie bez targetu
`edge.target === null` → pomijamy cicho, DFS nie idzie tym kierunkiem.

---

## Eksport — 7 formatów

### Przepływ
1. Panel → `ext-cmd {type: 'export', formats: [...], folder: '...', allPages: bool, imagesMode: 'perPage'|'current'}`
2. Main → forward do aktywnego renderera (brak dialogu — folder w payloadzie)
3. Renderer (`export-all.js`) → per format: pobiera dane → `sendMessage('ext-result', {type: 'export-data', format, data, pageName, pageIndex})`
4. Main → zapisuje pliki do folderu → `ext-result {type: 'export-done', succeeded: [...], failed: [...]}`
5. Panel → wyświetla status

### Pobieranie danych per format (renderer)

| Format | API | Wynik | allPages |
|--------|-----|-------|---------|
| XML | `ui.getFileData(true)` | string UTF-8 | wszystkie strony w jednym pliku |
| JSON | konwersja XML → JSON | string UTF-8 | wszystkie strony w jednym pliku |
| SVG | `graph.getSvg()` → `XMLSerializer.serializeToString()` | string UTF-8 | wg `imagesMode` |
| PNG | canvas API → `toDataURL('image/png')` (bez prefix) | base64 | wg `imagesMode` |
| JPEG | canvas API → `toDataURL('image/jpeg', 0.9)` (bez prefix) | base64 | wg `imagesMode` |
| PDF | `ui.downloadFile('pdf')` | natywny dialog draw.io | osobny dialog |
| HTML | `ui.downloadFile('html')` | natywny dialog draw.io | osobny dialog |

**PDF i HTML** — wyjątki: otwierają natywny dialog draw.io (nie do folderu zbiorczego). Jeśli zaznaczone w checkboxach, otwierają się po eksporcie pozostałych formatów.

### Nazewnictwo plików

| Sytuacja | Nazwa |
|----------|-------|
| Jeden plik (XML, JSON) | `{nazwaDiagramu}.xml` |
| Obraz, jedna strona | `{nazwaDiagramu}.png` |
| Obraz, wszystkie strony (perPage) | `{nazwaDiagramu}-1.png`, `{nazwaDiagramu}-2.png` |
| Niezapisany diagram | fallback: `diagram` |

### Zapis w main
- `fsProm.writeFile(path.join(folder, name + '.' + format), data, encoding)`
- PNG/JPEG: `encoding = 'base64'`
- Reszta: `encoding = 'utf8'`
- Błąd zapisu → kontynuuj pozostałe, dodaj do listy `failed`

### Integracja
Istniejący `exportAllFn` (Ctrl+Shift+E) pozostaje bez zmian. Nowy eksport z panelu dodaje handler `ext-cmd {type: 'export'}` obok istniejącego `exportAllToFolder`.

---

## Modyfikacje istniejących rozszerzeń

### `highlight-selection.js`
```javascript
var highlightEnabled = true;  // domyślnie włączone

// Na starcie: odczyt stanu z localStorage NIE jest tu potrzebny
// — panel jest źródłem prawdy, wysyła stan przy każdej zmianie

window.electron.registerMsgListener('ext-cmd', function(msg) {
  if (msg.type !== 'highlight-toggle') return;
  highlightEnabled = msg.value;
  if (!highlightEnabled) clearHighlights();
});

// onSelectionChange sprawdza highlightEnabled przed działaniem
function onSelectionChange() {
  if (!highlightEnabled) return;
  // ... istniejąca logika
}
```

**Przy starcie aplikacji:** highlight zawsze włączony domyślnie. Panel przy otwarciu odczytuje własny localStorage i jeśli zapisany stan = wyłączony, wysyła `ext-cmd {type: 'highlight-toggle', value: false}`.

### `export-all.js`
- Nowe funkcje: `getSvgString(ui)`, `getPngBase64(ui)`, `getJpegBase64(ui)`
- Nowy handler: `ext-cmd {type: 'export'}` → obsługuje 7 formatów
- Istniejące funkcje: `getXmlString`, `getDiagramName`, `xmlNodeToJson` — bez zmian
- Istniejący handler `exportAllToFolder` — bez zmian

---

## Testy

| Co | Jak |
|----|-----|
| `xmlNodeToJson` | istniejące (src/test/export-all.test.js) — bez zmian |
| Algorytm numerowania | `src/test/numbering.test.js` — mock graph: liniowa ścieżka, rozwidlenie (dłuższa gałąź pierwsza), cykl, węzły bez child cella, izolowane węzły, wiele podgrafów, krawędź bez targetu |
| Panel + IPC | test manualny |
| Eksport 7 formatów | test manualny (każdy format osobno) |

---

## Decyzje projektowe

| Decyzja | Uzasadnienie |
|---------|-------------|
| Nadpisuje numery od zera bez pytania | Prosto i przewidywalnie |
| Wiele podgrafów — wszystkie numerowane, licznik globalny | Użytkownik może mieć wiele przepływów na stronie |
| Wszystkie strony, licznik ciągły przez strony | Numery unikalne w całym dokumencie |
| Pozycja absolutna (offset ramki + węzła) | Węzły w przesuniętych ramkach mogłyby błędnie wygrać jako startowe |
| Strony w kolejności zakładek | Naturalny porządek czytania |
| Panel zamyka się z ostatnim oknem | Domyślne zachowanie Electron `app.quit()` |
| HTML i PDF — natywny dialog (wyjątek) | Ich pipeline renderowania nie daje stringa do przechwycenia |
| Ramki zawsze pomijane (`isSwimlane`) | Są kontenerami, nie elementami przepływu |
| Węzły bez child cell odwiedzane, ale nie numerowane | DFS nie zatrzymuje się na nich |
| Ctrl+Z cofa całe numerowanie | `beginUpdate/endUpdate` grupuje setValue |
| localStorage panelu = źródło prawdy dla highlight | Tylko panel kontroluje ten stan |
| Eksport kontynuuje przy błędzie formatu | Użytkownik dostaje maksimum z możliwego |
| Postęp numerowania per strona | Widoczny w status text podczas operacji |
