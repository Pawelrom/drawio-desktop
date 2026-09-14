# Control Panel + Extension 3 (Numerowanie) — Spec

**Data:** 2026-09-14  
**Projekt:** draw.io Desktop fork — rozszerzenia Pawła  
**Repo:** `c:/Projects/drawio-desktop` (branch `dev`) + submoduł `drawio` (branch `extensions`)

---

## Cel

Dodanie:
1. **Panelu kontrolnego** (BrowserWindow) otwieranego z menu, z kontrolkami dla wszystkich rozszerzeń
2. **Extension 3 — Numerowanie elementów** według topologii połączeń (DFS z priorytetem najdłuższej ścieżki)
3. **Rozszerzenie eksportu** na 7 formatów (PDF, XML, JSON, SVG, PNG, JPEG, HTML) z wyborem przez checkboxy

---

## Architektura ogólna

```
┌─────────────────────────┐        ┌──────────────────────────────┐
│  control-panel.html     │        │  draw.io renderer window     │
│  (BrowserWindow)        │        │                              │
│                         │  IPC   │  highlight-selection.js      │
│  panelBridge.sendCmd()──┼──────▶─┼─ ext-cmd handler            │
│  panelBridge.onResult() │◀───────┼─ ext-result                 │
│                         │        │  numbering.js                │
└─────────────────────────┘        │  export-all.js               │
           │                       └──────────────────────────────┘
           │ ipcRenderer
           ▼
┌─────────────────────────┐
│  electron.js (main)     │
│  ipcMain.on('ext-cmd')  │
│  router → mainWindow    │
│  .webContents.send()    │
└─────────────────────────┘
```

**Kanały IPC:**
- `ext-cmd` — Panel → Main → Renderer (komendy)
- `ext-result` — Renderer → Main → Panel (odpowiedzi, opcjonalnie)

Każde rozszerzenie w rendererze rejestruje jeden handler na `ext-cmd` i filtruje po `type`. Dodanie nowego rozszerzenia nie wymaga zmian w `electron.js`.

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
- Rozmiar: 280×360px, `resizable: false`
- Tytuł: `"Panel rozszerzeń"`
- Singleton: jeśli okno już istnieje → `focus()`, nie tworzy nowego
- `alwaysOnTop: false`
- Menu entry: nowe menu **"Rozszerzenia"** → pozycja **"Panel rozszerzeń"**
- Działa na Windows i macOS (menu "Rozszerzenia" przed "Help")

### UI layout
```
┌──────────────────────────────┐
│  Panel rozszerzeń            │
├──────────────────────────────┤
│  Podświetlenie zaznaczenia   │
│  [●  Włączone          ]     │
├──────────────────────────────┤
│  Numerowanie elementów       │
│  [ Numeruj ]                 │
├──────────────────────────────┤
│  Eksportuj...                │
│  ☑ PDF    ☑ XML    ☑ JSON   │
│  ☑ SVG    ☑ PNG    ☑ JPEG  │
│  ☑ HTML                     │
│                              │
│  [ Eksportuj ]               │
└──────────────────────────────┘
```

### Implementacja
- Czysty HTML/CSS/JS, bez frameworka
- Stan checkboxów i toggle persystowany w `localStorage` panelu
- Styl: dopasowany do draw.io Desktop (czcionka systemowa, szare tło)

### `control-panel-preload.js`
Eksponuje `window.panelBridge` przez `contextBridge`:
```javascript
panelBridge.sendCmd(type, payload)   // ipcRenderer.send('ext-cmd', {type, payload})
panelBridge.onResult(type, callback) // ipcRenderer.on('ext-result', filter by type)
```

### Routing w `electron.js`
```javascript
ipcMain.on('ext-cmd', (e, msg) => {
  if (msg.type === 'export') {
    // pokaż folder picker → dołącz folder do payload → wyślij do mainWindow
  } else {
    // highlight-toggle, number → forward bezpośrednio
    mainWindow.webContents.send('ext-cmd', msg);
  }
});
```

---

## Extension 3 — Numerowanie elementów

### Plik
`drawio/src/main/webapp/js/extensions/numbering.js`

### Wyzwalanie
`ext-cmd {type: 'number'}` → uruchamia algorytm → modyfikuje model lokalnie, brak odpowiedzi IPC.

### Reguły kwalifikacji węzła
Węzeł **wchodzi** do zbioru numerowanych jeśli spełnia WSZYSTKIE warunki:
1. Jest wierzchołkiem (`cell.isVertex() === true`)
2. Nie jest ramką (`graph.isSwimlane(cell) === false`)
3. Ma co najmniej jedną krawędź wchodzącą LUB wychodzącą
4. Posiada child cell z `align=right` ORAZ `verticalAlign=top` w stylu

Warunek 4 decyduje też czy numer zostanie faktycznie wpisany. Węzły bez child cella są **pomijane w numeracji** (numer nie przypisany), ale DFS **przechodzi przez nie dalej** — węzeł jest odwiedzany i nie wraca się do niego ponownie.

### Węzeł startowy
Spośród węzłów spełniających warunki 1–3 (pomijamy warunek 4 przy wyborze startu): ten z najmniejszym `geometry.x + geometry.y`. Remis → mniejsze `x`.

### Algorytm DFS
```
counter = 1
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
    neighbors.sort((a, b) => downstreamLength(b, visited) - downstreamLength(a, visited))
    // remis → kolejność z modelu (indeks w cells)

  for each neighbor in neighbors:
    dfs(neighbor)
```

**`downstreamLength(node, visited)`** — DFS liczący osiągalne nieodwiedzone węzły. Wywoływany tylko gdy `neighbors.length >= 2` (optymalizacja).

### Modyfikacja modelu
```javascript
graph.model.beginUpdate();
try {
  // wszystkie model.setValue(...)
} finally {
  graph.model.endUpdate();
}
```
Pojedyncze Ctrl+Z cofa całe numerowanie.

---

## Eksport — 7 formatów

### Przepływ
1. Panel → `ext-cmd {type: 'export', formats: [...]}` → main
2. Main → `dialog.showOpenDialog` (folder picker, JEDEN raz)
3. Main → renderer: `ext-cmd {type: 'export', formats, folder}`
4. Renderer (`export-all.js`) → per format: pobiera dane → `sendMessage('ext-result', {type: 'export-data', format, data})`
5. Main → zapisuje `{nazwa}.{format}` do folderu

### Pobieranie danych per format (renderer)

| Format | API | Wynik |
|--------|-----|-------|
| XML | `ui.getFileData(true)` | string UTF-8 |
| JSON | konwersja XML → JSON (istniejąca) | string UTF-8 |
| SVG | `ui.editor.graph.getSvg()` → `new XMLSerializer().serializeToString(svgEl)` | string UTF-8 |
| PNG | canvas API: `mxUtils.exportToCanvas` → `canvas.toDataURL('image/png')` | base64 (bez prefix) |
| JPEG | j.w. → `canvas.toDataURL('image/jpeg', 0.9)` | base64 (bez prefix) |
| PDF | `webContents.printToPDF({})` w main, bez angażowania renderera | Buffer |
| HTML | `ui.downloadFile('html')` — natywny dialog (nie do folderu zbiorczego) | — |

**HTML jako wyjątek:** w tej iteracji HTML używa natywnego dialogu draw.io zamiast eksportu do folderu. Pozostałe 6 formatów trafia do wybranego folderu.

### Zapis w main (electron.js)
- `fsProm.writeFile(path.join(folder, name + '.' + format), data, encoding)`
- PNG/JPEG: `encoding = 'base64'`
- Reszta: `encoding = 'utf8'`
- PDF: `fsProm.writeFile(..., pdfBuffer)` (Buffer z `printToPDF`)
- Błąd zapisu → `dialog.showErrorBox`

### Integracja z istniejącym kodem
Istniejący `exportAllFn` (Ctrl+Shift+E) pozostaje bez zmian — działa równolegle. Nowy eksport z panelu używa tego samego `export-all.js`, ale przez `ext-cmd` zamiast `exportAllToFolder`.

---

## Modyfikacje istniejących rozszerzeń

### `highlight-selection.js`
Dodanie handlera `ext-cmd`:
```javascript
window.electron.registerMsgListener('ext-cmd', function(msg) {
  if (msg.type !== 'highlight-toggle') return;
  highlightEnabled = msg.value;
  if (!highlightEnabled) clearHighlights();
});
```
Nowa zmienna `var highlightEnabled = true` — `onSelectionChange` sprawdza ją przed działaniem.

### `export-all.js`
- Dodanie handlera `ext-cmd {type: 'export'}` obok istniejącego `exportAllToFolder`
- Nowe funkcje: `getSvgString(ui)`, `getPngBase64(ui)`, `getJpegBase64(ui)`
- Istniejące funkcje: `getXmlString`, `getDiagramName`, `xmlNodeToJson` — bez zmian

---

## Testy

| Co | Jak |
|----|-----|
| `xmlNodeToJson` | istniejące testy (src/test/export-all.test.js) — bez zmian |
| Algorytm numerowania | nowy plik `src/test/numbering.test.js` — testy jednostkowe na mock graph: liniowa ścieżka, rozwidlenie (dłuższa gałąź pierwsza), cykl, węzły bez child cella, izolowane węzły |
| Panel + IPC | test manualny (wymaga uruchomienia app) |
| Eksport 7 formatów | test manualny: każdy format osobno |

---

## Ograniczenia i decyzje

| Decyzja | Uzasadnienie |
|---------|-------------|
| HTML eksportuje natywnym dialogiem | Przechwycenie HTML stringa z `downloadFile` wymaga hooków; odłożone na później |
| `downstream_length` tylko przy rozwidleniu | Optymalizacja — brak kosztownego BFS dla węzłów bez rozwidlenia |
| Ramki zawsze pomijane (`isSwimlane`) | Ramki są kontenerami, nie elementami przepływu |
| Węzły bez child cell top-right pomijane w numeracji, ale odwiedzane | DFS nie zatrzymuje się — tylko nie przypisuje numeru |
| Ctrl+Z cofa całe numerowanie jedną operacją | `beginUpdate/endUpdate` grupuje wszystkie setValue |
