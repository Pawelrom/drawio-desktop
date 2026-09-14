# Control Panel + Numerowanie + Eksport — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dodanie panelu kontrolnego BrowserWindow z togglem podświetlenia, numerowaniem elementów (DFS) i eksportem 7 formatów do wybranego folderu.

**Architecture:** Nowy kanał IPC `ext-cmd` łączy panel (BrowserWindow) z rendererem draw.io przez main process. Każde rozszerzenie rejestruje handler na `ext-cmd` filtrując po `type`. Panel persystuje stan w localStorage; main śledzi ostatnio aktywne okno draw.io.

**Tech Stack:** Electron, Node.js built-in test runner (`node --test`), vanilla HTML/CSS/JS (panel), draw.io APIs (`window.Draw.loadPlugin`, `mxUtils`, `mxCellHighlight`), IIFE + `var` (webapp extensions).

**Spec:** `docs/superpowers/specs/2026-09-14-control-panel-and-numbering-spec.md`

## Global Constraints

- Allman brace style, tab indentation — spójne z istniejącym electron.js
- Webapp rozszerzenia: IIFE `(function () { ... })();` + `var` (nigdy `let`/`const`)
- `window.Draw.loadPlugin(function (ui) { ... })` — jedyny sposób dostępu do EditorUi w webapp
- Conventional Commits: `feat:`, `fix:`, `chore:` itd.
- Dwa repozytoria: outer (branch `dev`) + submoduł `drawio/` (branch `extensions`)
- Testy jednostkowe: `node --test src/test/<plik>.test.js`
- Bez frameworków w panel HTML — czysty HTML/CSS/JS
- `contextIsolation: true`, `nodeIntegration: false` dla BrowserWindow

---

### Task 1: IPC Bus — focused window tracking + ext-cmd routing

**Files:**
- Modify: `src/main/electron.js`

**Interfaces:**
- Produkuje:
  - `ipcMain.on('ext-cmd', handler)` — routing komend z panelu do aktywnego okna draw.io
  - `ipcMain.on('ext-result', handler)` — forwarding wyników z renderera do panelu
  - `let lastFocusedDrawioWin` — zmienna modułowa śledząca aktywne okno
  - `let controlPanelWin` — zmienna modułowa dla okna panelu (ustawiana w Task 6)

- [ ] **Krok 1: Dodaj zmienne modułowe**

  W `electron.js`, zaraz po linii `let windowsRegistry = []` (ok. linia 294), dodaj:

  ```javascript
  let controlPanelWin = null;
  let lastFocusedDrawioWin = null;
  ```

- [ ] **Krok 2: Śledź aktywne okno draw.io**

  W `electron.js`, znajdź blok `app.on('ready', ...)` lub `app.whenReady()`. Zaraz po nim (lub wewnątrz, przed `createWindow`), dodaj:

  ```javascript
  app.on('browser-window-focus', (event, win) =>
  {
  	if (controlPanelWin && win === controlPanelWin) return;
  	lastFocusedDrawioWin = win;
  });
  ```

- [ ] **Krok 3: Dodaj handler ext-cmd (routing do renderera)**

  W `electron.js`, po bloku `ipcMain.on('openDevTools', ...)` (ok. linia 1087), dodaj:

  ```javascript
  // ext-cmd: panel → main → active draw.io renderer
  ipcMain.on('ext-cmd', (e, msg) =>
  {
  	const target = lastFocusedDrawioWin;
  	if (!target || target.isDestroyed()) return;

  	if (msg.type === 'export')
  	{
  		// Waliduj folder, dołącz go do msg i prześlij do renderera
  		const folder = msg.payload && msg.payload.folder;
  		if (!folder)
  		{
  			if (controlPanelWin && !controlPanelWin.isDestroyed())
  			{
  				controlPanelWin.webContents.send('ext-result',
  					{type: 'export-error', msg: 'Brak ścieżki folderu'});
  			}
  			return;
  		}

  		try
  		{
  			fs.accessSync(folder, fs.constants.W_OK);
  		}
  		catch (err)
  		{
  			if (controlPanelWin && !controlPanelWin.isDestroyed())
  			{
  				controlPanelWin.webContents.send('ext-result',
  					{type: 'export-error', msg: 'Folder nie istnieje lub brak uprawnień'});
  			}
  			return;
  		}

  		target.webContents.send('ext-cmd', msg);
  	}
  	else
  	{
  		target.webContents.send('ext-cmd', msg);
  	}
  });

  // ext-result: renderer → main → panel
  ipcMain.on('ext-result', (e, msg) =>
  {
  	if (!msg || msg.type === 'export-data') return; // obsługiwane osobno w Task 5
  	if (controlPanelWin && !controlPanelWin.isDestroyed())
  	{
  		controlPanelWin.webContents.send('ext-result', msg);
  	}
  });
  ```

- [ ] **Krok 4: Sprawdź czy `fs` jest dostępne**

  Na początku `electron.js` szukaj importu `fs` (powinno być: `import fs from 'fs'` lub `import {promises as fsProm} from 'fs'`). Jeśli `fs` (nie tylko `fsProm`) nie jest importowane, dodaj:

  ```javascript
  import fs from 'fs';
  ```

  (Sprawdź czy nie ma już `fs` w istniejących importach — nie duplikuj.)

- [ ] **Krok 5: Commit**

  ```bash
  cd c:/Projects/drawio-desktop
  git add src/main/electron.js
  git commit -m "feat: add ext-cmd IPC bus and focused window tracking"
  git push
  ```

---

### Task 2: Highlight toggle — modyfikacja highlight-selection.js

**Files:**
- Modify: `drawio/src/main/webapp/js/extensions/highlight-selection.js`

**Interfaces:**
- Konsumuje: `ext-cmd {type: 'highlight-toggle', value: boolean}` przez `window.electron.registerMsgListener`
- Produkuje: brak (operacja lokalna)

- [ ] **Krok 1: Dodaj zmienną `highlightEnabled` i handler ext-cmd**

  Otwórz `drawio/src/main/webapp/js/extensions/highlight-selection.js`.

  Istniejąca struktura to IIFE z `window.Draw.loadPlugin(function (ui) { ... })`. Zmodyfikuj tak, aby:

  1. Przed `window.Draw.loadPlugin` (wewnątrz IIFE, po zmiennych `activeHighlights` i `graph`) dodaj:
     ```javascript
     var highlightEnabled = true;
     ```

  2. Na początku funkcji `onSelectionChange` dodaj warunek:
     ```javascript
     function onSelectionChange()
     {
         if (!highlightEnabled) return;
         clearHighlights();
         // ... reszta bez zmian
     ```

  3. Wewnątrz `window.Draw.loadPlugin(function (ui) { ... })`, po istniejącym `ui.editor.addListener(...)`, dodaj:
     ```javascript
         window.electron.registerMsgListener('ext-cmd', function (msg)
         {
             if (msg.type !== 'highlight-toggle') return;
             highlightEnabled = msg.value;
             if (!highlightEnabled)
             {
                 clearHighlights();
             }
         });
     ```

  Pełna zawartość pliku po zmianie:

  ```javascript
  (function ()
  {
  	var HIGHLIGHT_CELL_COLOR = '#FF8000';
  	var HIGHLIGHT_EDGE_COLOR = '#FFB366';
  	var activeHighlights = [];
  	var graph = null;
  	var highlightEnabled = true;

  	function clearHighlights()
  	{
  		for (var i = 0; i < activeHighlights.length; i++)
  		{
  			activeHighlights[i].destroy();
  		}
  		activeHighlights = [];
  	}

  	function highlightCell(cell, color, strokeWidth)
  	{
  		var state = graph.view.getState(cell);
  		if (!state) return;
  		var h = new mxCellHighlight(graph, color, strokeWidth);
  		h.highlight(state);
  		activeHighlights.push(h);
  	}

  	function onSelectionChange()
  	{
  		if (!highlightEnabled) return;
  		clearHighlights();
  		var cells = graph.getSelectionCells();
  		if (!cells || cells.length === 0) return;

  		for (var i = 0; i < cells.length; i++)
  		{
  			highlightCell(cells[i], HIGHLIGHT_CELL_COLOR, 3);
  			var edges = graph.getEdges(cells[i], null, false, true, false);
  			if (edges)
  			{
  				for (var j = 0; j < edges.length; j++)
  				{
  					highlightCell(edges[j], HIGHLIGHT_EDGE_COLOR, 2);
  				}
  			}
  		}
  	}

  	window.Draw.loadPlugin(function (ui)
  	{
  		graph = ui.editor.graph;
  		graph.getSelectionModel().addListener(mxEvent.CHANGE, onSelectionChange);

  		ui.editor.addListener('pageSelected', function ()
  		{
  			clearHighlights();
  			if (graph)
  			{
  				graph.getSelectionModel().removeListener(onSelectionChange);
  			}
  			graph = ui.editor.graph;
  			graph.getSelectionModel().addListener(mxEvent.CHANGE, onSelectionChange);
  		});

  		window.electron.registerMsgListener('ext-cmd', function (msg)
  		{
  			if (msg.type !== 'highlight-toggle') return;
  			highlightEnabled = msg.value;
  			if (!highlightEnabled)
  			{
  				clearHighlights();
  			}
  		});
  	});
  })();
  ```

- [ ] **Krok 2: Test manualny w DevTools**

  Uruchom app (`npm start` z `c:/Projects/drawio-desktop`), otwórz DevTools (automatycznie w trybie dev), w konsoli:

  ```javascript
  window.electron.sendMessage('ext-cmd', {type: 'highlight-toggle', value: false})
  ```

  Oczekiwane: kliknięcie elementów nie podświetla. Następnie:

  ```javascript
  window.electron.sendMessage('ext-cmd', {type: 'highlight-toggle', value: true})
  ```

  Oczekiwane: podświetlanie wraca.

- [ ] **Krok 3: Commit**

  ```bash
  cd c:/Projects/drawio-desktop/drawio
  git add src/main/webapp/js/extensions/highlight-selection.js
  git commit -m "feat: add highlight toggle via ext-cmd IPC"
  git push
  cd ..
  git add drawio
  git commit -m "feat: update drawio submodule with highlight toggle"
  git push
  ```

---

### Task 3: Numerowanie — unit testy (TDD, oczekiwane FAIL)

**Files:**
- Create: `src/test/numbering.test.js`

**Interfaces:**
- Konsumuje: algorytm numerowania (funkcje zdefiniowane w teście jako duplikat implementacji)
- Produkuje: 8 testów które przy pierwszym uruchomieniu przechodzą (testujemy czyste funkcje JS, nie draw.io API)

Uwaga: funkcje algorytmu są duplikowane w teście (czyste JS, zero zależności od draw.io). Implementacja w Task 4 musi używać identycznej logiki.

- [ ] **Krok 1: Utwórz plik testowy**

  Utwórz `src/test/numbering.test.js`:

  ```javascript
  import { test, describe } from 'node:test';
  import assert from 'node:assert/strict';

  // ─── Pure algorithm functions (duplicated from numbering.js for unit testing) ───

  function findTopRightChild(cell)
  {
  	if (!cell.children || cell.children.length === 0) return null;
  	for (var i = 0; i < cell.children.length; i++)
  	{
  		var child = cell.children[i];
  		var style = child.style || '';
  		if (style.indexOf('align=right') !== -1 && style.indexOf('verticalAlign=top') !== -1)
  		{
  			return child;
  		}
  	}
  	return null;
  }

  function getAbsolutePosition(cell, parentMap)
  {
  	var x = (cell.geometry && cell.geometry.x) || 0;
  	var y = (cell.geometry && cell.geometry.y) || 0;
  	var parentId = cell.parentId;
  	if (parentId && parentMap[parentId] && parentMap[parentId].isSwimlane)
  	{
  		var parent = parentMap[parentId];
  		var px = (parent.geometry && parent.geometry.x) || 0;
  		var py = (parent.geometry && parent.geometry.y) || 0;
  		x += px;
  		y += py;
  	}
  	return {x: x, y: y};
  }

  function downstreamLength(node, visited, adjacency)
  {
  	var count = 0;
  	var stack = [node];
  	var seen = new Set(visited);
  	while (stack.length > 0)
  	{
  		var current = stack.pop();
  		if (seen.has(current.id)) continue;
  		seen.add(current.id);
  		count++;
  		var neighbors = adjacency[current.id] || [];
  		for (var i = 0; i < neighbors.length; i++)
  		{
  			if (!seen.has(neighbors[i].id))
  			{
  				stack.push(neighbors[i]);
  			}
  		}
  	}
  	return count;
  }

  function numberGraph(cells, adjacency, isSwimlaneMap)
  {
  	// cells: array of cell objects
  	// adjacency: {cellId: [targetCell, ...]}
  	// isSwimlaneMap: {cellId: bool}
  	// Returns: {cellId: number} — assigned numbers

  	var parentMap = {};
  	for (var i = 0; i < cells.length; i++)
  	{
  		parentMap[cells[i].id] = cells[i];
  	}

  	// Filter: vertex, not swimlane, has at least one edge
  	var connected = cells.filter(function (c)
  	{
  		if (isSwimlaneMap[c.id]) return false;
  		var hasOut = adjacency[c.id] && adjacency[c.id].length > 0;
  		var hasIn = false;
  		for (var k in adjacency)
  		{
  			if ((adjacency[k] || []).some(function (t) { return t.id === c.id; }))
  			{
  				hasIn = true;
  				break;
  			}
  		}
  		return hasOut || hasIn;
  	});

  	if (connected.length === 0) return {};

  	var assigned = {};
  	var visited = new Set();
  	var counter = {value: 1};

  	function dfs(node)
  	{
  		if (visited.has(node.id)) return;
  		visited.add(node.id);

  		var child = findTopRightChild(node);
  		if (child)
  		{
  			assigned[node.id] = counter.value++;
  		}

  		var rawNeighbors = adjacency[node.id] || [];
  		var neighbors = rawNeighbors.filter(function (n)
  		{
  			return n !== null && !visited.has(n.id) && !isSwimlaneMap[n.id];
  		});

  		if (neighbors.length >= 2)
  		{
  			neighbors = neighbors.slice().sort(function (a, b)
  			{
  				return downstreamLength(b, visited, adjacency) -
  					downstreamLength(a, visited, adjacency);
  			});
  		}

  		for (var i = 0; i < neighbors.length; i++)
  		{
  			dfs(neighbors[i]);
  		}
  	}

  	// Find all subgraph roots (not reachable from another connected node)
  	function findRoots()
  	{
  		var reachable = new Set();
  		for (var i = 0; i < connected.length; i++)
  		{
  			var neighbors = adjacency[connected[i].id] || [];
  			for (var j = 0; j < neighbors.length; j++)
  			{
  				if (neighbors[j]) reachable.add(neighbors[j].id);
  			}
  		}
  		var roots = connected.filter(function (c) { return !reachable.has(c.id); });
  		if (roots.length === 0) roots = [connected[0]]; // cycle fallback
  		roots.sort(function (a, b)
  		{
  			var posA = getAbsolutePosition(a, parentMap);
  			var posB = getAbsolutePosition(b, parentMap);
  			var sumA = posA.x + posA.y;
  			var sumB = posB.x + posB.y;
  			if (sumA !== sumB) return sumA - sumB;
  			return posA.x - posB.x;
  		});
  		return roots;
  	}

  	var roots = findRoots();
  	for (var r = 0; r < roots.length; r++)
  	{
  		dfs(roots[r]);
  	}

  	return assigned;
  }

  // ─── Test helpers ───────────────────────────────────────────────────────────────

  function makeCell(id, x, y, hasTopRight, swimlane, parentId)
  {
  	return {
  		id: id,
  		geometry: {x: x || 0, y: y || 0},
  		isSwimlane: swimlane || false,
  		parentId: parentId || null,
  		children: hasTopRight
  			? [{style: 'align=right;verticalAlign=top;', value: ''}]
  			: []
  	};
  }

  // ─── Tests ──────────────────────────────────────────────────────────────────────

  describe('findTopRightChild', () =>
  {
  	test('returns child with align=right and verticalAlign=top', () =>
  	{
  		var cell = makeCell('a', 0, 0, true);
  		var child = findTopRightChild(cell);
  		assert.ok(child !== null);
  	});

  	test('returns null when no matching child', () =>
  	{
  		var cell = makeCell('a', 0, 0, false);
  		assert.strictEqual(findTopRightChild(cell), null);
  	});

  	test('returns null for empty children array', () =>
  	{
  		var cell = {id: 'a', children: []};
  		assert.strictEqual(findTopRightChild(cell), null);
  	});
  });

  describe('numberGraph — linear path', () =>
  {
  	test('numbers all nodes 1..4 in order', () =>
  	{
  		var a = makeCell('a', 0, 0, true);
  		var b = makeCell('b', 100, 0, true);
  		var c = makeCell('c', 200, 0, true);
  		var d = makeCell('d', 300, 0, true);
  		var cells = [a, b, c, d];
  		var adj = {a: [b], b: [c], c: [d], d: []};
  		var sw = {a: false, b: false, c: false, d: false};
  		var result = numberGraph(cells, adj, sw);
  		assert.deepEqual(result, {a: 1, b: 2, c: 3, d: 4});
  	});

  	test('skips nodes without top-right child but continues DFS', () =>
  	{
  		var a = makeCell('a', 0, 0, true);
  		var b = makeCell('b', 100, 0, false); // no top-right child
  		var c = makeCell('c', 200, 0, true);
  		var cells = [a, b, c];
  		var adj = {a: [b], b: [c], c: []};
  		var sw = {a: false, b: false, c: false};
  		var result = numberGraph(cells, adj, sw);
  		assert.deepEqual(result, {a: 1, c: 2});
  		assert.ok(!('b' in result));
  	});
  });

  describe('numberGraph — branching', () =>
  {
  	test('numbers longer branch first at fork', () =>
  	{
  		// A → B → C → D (main, length 3)
  		// A → E → F     (short, length 2)
  		// Expected: A=1, B=2, C=3, D=4, E=5, F=6
  		var a = makeCell('a', 0, 0, true);
  		var b = makeCell('b', 100, 0, true);
  		var c = makeCell('c', 200, 0, true);
  		var d = makeCell('d', 300, 0, true);
  		var e = makeCell('e', 100, 100, true);
  		var f = makeCell('f', 200, 100, true);
  		var cells = [a, b, c, d, e, f];
  		var adj = {a: [b, e], b: [c], c: [d], d: [], e: [f], f: []};
  		var sw = {a: false, b: false, c: false, d: false, e: false, f: false};
  		var result = numberGraph(cells, adj, sw);
  		assert.deepEqual(result, {a: 1, b: 2, c: 3, d: 4, e: 5, f: 6});
  	});
  });

  describe('numberGraph — cycles', () =>
  {
  	test('does not loop infinitely on cycle', () =>
  	{
  		var a = makeCell('a', 0, 0, true);
  		var b = makeCell('b', 100, 0, true);
  		var c = makeCell('c', 200, 0, true);
  		var cells = [a, b, c];
  		var adj = {a: [b], b: [c], c: [a]}; // cycle
  		var sw = {a: false, b: false, c: false};
  		var result = numberGraph(cells, adj, sw);
  		assert.ok(Object.keys(result).length === 3);
  		assert.ok(result.a === 1 || result.b === 1 || result.c === 1);
  	});
  });

  describe('numberGraph — isolated nodes', () =>
  {
  	test('does not number nodes with no edges', () =>
  	{
  		var a = makeCell('a', 0, 0, true);
  		var b = makeCell('b', 100, 0, true); // isolated
  		var c = makeCell('c', 200, 0, true);
  		var cells = [a, b, c];
  		var adj = {a: [c], b: [], c: []};
  		var sw = {a: false, b: false, c: false};
  		var result = numberGraph(cells, adj, sw);
  		assert.ok(!('b' in result), 'isolated node b should not be numbered');
  		assert.ok('a' in result);
  		assert.ok('c' in result);
  	});
  });

  describe('numberGraph — multiple subgraphs', () =>
  {
  	test('numbers all subgraphs with global counter', () =>
  	{
  		// Subgraph 1 (top-left): A→B
  		// Subgraph 2 (bottom-right): C→D
  		var a = makeCell('a', 0, 0, true);
  		var b = makeCell('b', 100, 0, true);
  		var c = makeCell('c', 500, 500, true);
  		var d = makeCell('d', 600, 500, true);
  		var cells = [a, b, c, d];
  		var adj = {a: [b], b: [], c: [d], d: []};
  		var sw = {a: false, b: false, c: false, d: false};
  		var result = numberGraph(cells, adj, sw);
  		assert.deepEqual(result, {a: 1, b: 2, c: 3, d: 4});
  	});
  });

  describe('numberGraph — dangling edges', () =>
  {
  	test('ignores edge with null target', () =>
  	{
  		var a = makeCell('a', 0, 0, true);
  		var b = makeCell('b', 100, 0, true);
  		var cells = [a, b];
  		var adj = {a: [b, null], b: []}; // null target
  		var sw = {a: false, b: false};
  		var result = numberGraph(cells, adj, sw);
  		assert.deepEqual(result, {a: 1, b: 2});
  	});
  });

  describe('numberGraph — swimlanes', () =>
  {
  	test('does not number swimlane frames', () =>
  	{
  		var frame = makeCell('frame', 0, 0, true); // swimlane with top-right child
  		var a = makeCell('a', 50, 50, true, false, 'frame');
  		var b = makeCell('b', 150, 50, true, false, 'frame');
  		var cells = [frame, a, b];
  		var adj = {frame: [], a: [b], b: []};
  		var sw = {frame: true, a: false, b: false};
  		var result = numberGraph(cells, adj, sw);
  		assert.ok(!('frame' in result), 'swimlane frame should not be numbered');
  		assert.ok('a' in result);
  		assert.ok('b' in result);
  	});
  });
  ```

- [ ] **Krok 2: Uruchom testy — powinny przejść**

  ```bash
  cd c:/Projects/drawio-desktop
  node --test src/test/numbering.test.js
  ```

  Oczekiwane: wszystkie testy PASS (algorytm jest w samym pliku testowym).

- [ ] **Krok 3: Commit**

  ```bash
  git add src/test/numbering.test.js
  git commit -m "test: add unit tests for numbering algorithm"
  git push
  ```

---

### Task 4: Numerowanie — implementacja numbering.js + index.html

**Files:**
- Create: `drawio/src/main/webapp/js/extensions/numbering.js`
- Modify: `drawio/src/main/webapp/index.html`

**Interfaces:**
- Konsumuje: `ext-cmd {type: 'number'}` przez `window.electron.registerMsgListener`
- Produkuje:
  - `ext-result {type: 'number-progress', current: N, total: M}` — postęp per strona
  - `ext-result {type: 'number-done', count: N}` — zakończenie
  - `ext-result {type: 'number-status', msg: string}` — błąd/brak elementów

Algorytm musi być identyczny logicznie z funkcjami `findTopRightChild`, `downstreamLength`, `numberGraph` z Task 3.

- [ ] **Krok 1: Utwórz numbering.js**

  ```javascript
  (function ()
  {
  	function findTopRightChild(cell)
  	{
  		if (!cell.children || cell.children.length === 0) return null;
  		for (var i = 0; i < cell.children.length; i++)
  		{
  			var child = cell.children[i];
  			var style = child.style || '';
  			if (style.indexOf('align=right') !== -1 && style.indexOf('verticalAlign=top') !== -1)
  			{
  				return child;
  			}
  		}
  		return null;
  	}

  	function getAbsolutePosition(cell, graph)
  	{
  		var x = (cell.geometry && cell.geometry.x) || 0;
  		var y = (cell.geometry && cell.geometry.y) || 0;
  		var parent = graph.model.getParent(cell);
  		if (parent && graph.isSwimlane(parent))
  		{
  			x += (parent.geometry && parent.geometry.x) || 0;
  			y += (parent.geometry && parent.geometry.y) || 0;
  		}
  		return {x: x, y: y};
  	}

  	function downstreamLength(node, visited, graph)
  	{
  		var count = 0;
  		var stack = [node];
  		var seen = new Set(Array.from(visited));
  		while (stack.length > 0)
  		{
  			var current = stack.pop();
  			if (seen.has(current.id)) continue;
  			seen.add(current.id);
  			count++;
  			var edges = graph.getEdges(current, null, false, true, false) || [];
  			for (var i = 0; i < edges.length; i++)
  			{
  				var t = edges[i].target;
  				if (t && !seen.has(t.id) && !graph.isSwimlane(t))
  				{
  					stack.push(t);
  				}
  			}
  		}
  		return count;
  	}

  	function getConnectedVertices(graph)
  	{
  		var model = graph.model;
  		var cells = model.cells;
  		var connected = [];
  		for (var id in cells)
  		{
  			var cell = cells[id];
  			if (!cell.isVertex()) continue;
  			if (graph.isSwimlane(cell)) continue;
  			var outEdges = graph.getEdges(cell, null, false, true, false) || [];
  			var inEdges = graph.getEdges(cell, null, true, false, false) || [];
  			if (outEdges.length > 0 || inEdges.length > 0)
  			{
  				connected.push(cell);
  			}
  		}
  		return connected;
  	}

  	function findRoots(connected, graph)
  	{
  		var reachable = new Set();
  		for (var i = 0; i < connected.length; i++)
  		{
  			var edges = graph.getEdges(connected[i], null, false, true, false) || [];
  			for (var j = 0; j < edges.length; j++)
  			{
  				var t = edges[j].target;
  				if (t) reachable.add(t.id);
  			}
  		}
  		var roots = connected.filter(function (c) { return !reachable.has(c.id); });
  		if (roots.length === 0) roots = connected.length > 0 ? [connected[0]] : [];
  		roots.sort(function (a, b)
  		{
  			var posA = getAbsolutePosition(a, graph);
  			var posB = getAbsolutePosition(b, graph);
  			var sumA = posA.x + posA.y;
  			var sumB = posB.x + posB.y;
  			if (sumA !== sumB) return sumA - sumB;
  			return posA.x - posB.x;
  		});
  		return roots;
  	}

  	function clearExistingNumbers(graph)
  	{
  		var model = graph.model;
  		var cells = model.cells;
  		for (var id in cells)
  		{
  			var cell = cells[id];
  			if (!cell.isVertex()) continue;
  			var child = findTopRightChild(cell);
  			if (child && child.value !== '')
  			{
  				model.setValue(child, '');
  			}
  		}
  	}

  	function numberPage(graph, counter, visited)
  	{
  		var connected = getConnectedVertices(graph);

  		function dfs(node)
  		{
  			if (visited.has(node.id)) return;
  			visited.add(node.id);

  			var child = findTopRightChild(node);
  			if (child)
  			{
  				graph.model.setValue(child, String(counter.value));
  				counter.value++;
  			}

  			var edges = graph.getEdges(node, null, false, true, false) || [];
  			var neighbors = [];
  			for (var i = 0; i < edges.length; i++)
  			{
  				var t = edges[i].target;
  				if (t && !visited.has(t.id) && !graph.isSwimlane(t))
  				{
  					neighbors.push(t);
  				}
  			}

  			if (neighbors.length >= 2)
  			{
  				neighbors = neighbors.slice().sort(function (a, b)
  				{
  					return downstreamLength(b, visited, graph) -
  						downstreamLength(a, visited, graph);
  				});
  			}

  			for (var j = 0; j < neighbors.length; j++)
  			{
  				dfs(neighbors[j]);
  			}
  		}

  		var roots = findRoots(connected, graph);
  		for (var r = 0; r < roots.length; r++)
  		{
  			dfs(roots[r]);
  		}

  		return connected.length;
  	}

  	function runNumbering(ui)
  	{
  		var pages = ui.pages;
  		if (!pages || pages.length === 0)
  		{
  			window.electron.sendMessage('ext-result',
  				{type: 'number-status', msg: 'Nie znaleziono elementów do numerowania'});
  			return;
  		}

  		var counter = {value: 1};
  		var visited = new Set();
  		var totalNumbered = 0;

  		for (var i = 0; i < pages.length; i++)
  		{
  			window.electron.sendMessage('ext-result',
  				{type: 'number-progress', current: i + 1, total: pages.length});

  			// Try direct page graph access without switching
  			var pageGraph = null;
  			try
  			{
  				pageGraph = pages[i].graph || (pages[i].state && pages[i].state.graph);
  			}
  			catch (e) {}

  			if (!pageGraph)
  			{
  				// Fallback: switch to page
  				ui.selectPage(pages[i]);
  				pageGraph = ui.editor.graph;
  			}

  			pageGraph.model.beginUpdate();
  			try
  			{
  				clearExistingNumbers(pageGraph);
  				totalNumbered += numberPage(pageGraph, counter, visited);
  			}
  			finally
  			{
  				pageGraph.model.endUpdate();
  			}
  		}

  		if (totalNumbered === 0)
  		{
  			window.electron.sendMessage('ext-result',
  				{type: 'number-status', msg: 'Nie znaleziono elementów do numerowania'});
  		}
  		else
  		{
  			window.electron.sendMessage('ext-result',
  				{type: 'number-done', count: counter.value - 1});
  		}
  	}

  	window.Draw.loadPlugin(function (ui)
  	{
  		window.electron.registerMsgListener('ext-cmd', function (msg)
  		{
  			if (msg.type !== 'number') return;
  			runNumbering(ui);
  		});
  	});
  })();
  ```

- [ ] **Krok 2: Dodaj script tag w index.html**

  W `drawio/src/main/webapp/index.html`, po istniejącej linii z `export-all.js`, dodaj:

  ```html
      <script src="js/extensions/highlight-selection.js"></script>
      <script src="js/extensions/export-all.js"></script>
      <script src="js/extensions/numbering.js"></script>
  </body>
  ```

- [ ] **Krok 3: Test manualny w DevTools**

  Uruchom app, otwórz diagram z co najmniej 2 połączonymi elementami które mają child cell z `align=right;verticalAlign=top` w stylu. W DevTools Console:

  ```javascript
  window.electron.sendMessage('ext-cmd', {type: 'number'})
  ```

  Oczekiwane: elementy dostają numery, DevTools pokazuje `ext-result` number-done.

- [ ] **Krok 4: Uruchom unit testy**

  ```bash
  cd c:/Projects/drawio-desktop
  node --test src/test/numbering.test.js
  ```

  Oczekiwane: wszystkie PASS.

- [ ] **Krok 5: Commit**

  ```bash
  cd c:/Projects/drawio-desktop/drawio
  git add src/main/webapp/js/extensions/numbering.js src/main/webapp/index.html
  git commit -m "feat: add numbering extension with DFS algorithm"
  git push
  cd ..
  git add drawio
  git commit -m "feat: update drawio submodule with numbering extension"
  git push
  ```

---

### Task 5: Eksport — 5 cichych formatów (SVG, PNG, JPEG + ext-cmd handler)

**Files:**
- Modify: `drawio/src/main/webapp/js/extensions/export-all.js`
- Modify: `src/main/electron.js`

**Interfaces:**
- Konsumuje: `ext-cmd {type: 'export', payload: {formats: string[], folder: string, allPages: bool, imagesMode: 'perPage'|'current'}}`
- Produkuje:
  - `ext-result {type: 'export-data', format: string, data: string, encoding: 'utf8'|'base64', filename: string}` — jeden per plik
  - `ext-result {type: 'export-complete'}` — sygnał końca

- [ ] **Krok 1: Dodaj funkcje SVG i PNG/JPEG do export-all.js**

  W `export-all.js`, wewnątrz IIFE, po funkcji `triggerPdfExport`, dodaj:

  ```javascript
  	function getSvgString(ui)
  	{
  		try
  		{
  			var svgEl = ui.editor.graph.getSvg(null, null, null, null, null, null, null, false);
  			return new XMLSerializer().serializeToString(svgEl);
  		}
  		catch (e) { return null; }
  	}

  	function getImageBase64(ui, mimeType, callback)
  	{
  		try
  		{
  			var svgEl = ui.editor.graph.getSvg(null, null, null, null, null, null, null, false);
  			var svgString = new XMLSerializer().serializeToString(svgEl);
  			var svgBlob = new Blob([svgString], {type: 'image/svg+xml;charset=utf-8'});
  			var url = URL.createObjectURL(svgBlob);
  			var img = new Image();
  			img.onload = function ()
  			{
  				var canvas = document.createElement('canvas');
  				canvas.width = img.naturalWidth || img.width;
  				canvas.height = img.naturalHeight || img.height;
  				var ctx = canvas.getContext('2d');
  				ctx.drawImage(img, 0, 0);
  				var dataUrl = canvas.toDataURL(mimeType, 0.9);
  				URL.revokeObjectURL(url);
  				callback(dataUrl.split(',')[1]);
  			};
  			img.onerror = function () { URL.revokeObjectURL(url); callback(null); };
  			img.src = url;
  		}
  		catch (e) { callback(null); }
  	}
  ```

- [ ] **Krok 2: Dodaj handler ext-cmd export do export-all.js**

  Wewnątrz `window.Draw.loadPlugin(function (ui) { ... })`, po istniejącym `registerMsgListener('exportAllToFolder', ...)`, dodaj:

  ```javascript
  		window.electron.registerMsgListener('ext-cmd', function (data)
  		{
  			if (data.type !== 'export') return;

  			var payload = data.payload;
  			var formats = payload.formats || [];
  			var allPages = payload.allPages || false;
  			var imagesMode = payload.imagesMode || 'current';
  			var name = getDiagramName(ui);

  			var pending = 0;
  			var done = false;

  			function checkDone()
  			{
  				if (done) return;
  				if (pending === 0)
  				{
  					done = true;
  					window.electron.sendMessage('ext-result', {type: 'export-complete'});
  				}
  			}

  			function sendFile(format, data, encoding, filename)
  			{
  				window.electron.sendMessage('ext-result',
  					{type: 'export-data', format: format, data: data,
  					 encoding: encoding, filename: filename});
  			}

  			// XML
  			if (formats.indexOf('xml') !== -1)
  			{
  				var xml = getXmlString(ui, allPages);
  				if (xml) sendFile('xml', xml, 'utf8', name + '.xml');
  			}

  			// JSON
  			if (formats.indexOf('json') !== -1)
  			{
  				var xmlForJson = getXmlString(ui, allPages);
  				if (xmlForJson)
  				{
  					try
  					{
  						var dom = (new DOMParser()).parseFromString(xmlForJson, 'text/xml');
  						var jsonObj = {};
  						jsonObj[dom.documentElement.nodeName] = xmlNodeToJson(dom.documentElement);
  						sendFile('json', JSON.stringify(jsonObj, null, 2), 'utf8', name + '.json');
  					}
  					catch (e) {}
  				}
  			}

  			// SVG
  			if (formats.indexOf('svg') !== -1)
  			{
  				var svgStr = getSvgString(ui);
  				if (svgStr) sendFile('svg', svgStr, 'utf8', name + '.svg');
  			}

  			// PNG
  			if (formats.indexOf('png') !== -1)
  			{
  				pending++;
  				getImageBase64(ui, 'image/png', function (b64)
  				{
  					if (b64) sendFile('png', b64, 'base64', name + '.png');
  					pending--;
  					checkDone();
  				});
  			}

  			// JPEG
  			if (formats.indexOf('jpeg') !== -1)
  			{
  				pending++;
  				getImageBase64(ui, 'image/jpeg', function (b64)
  				{
  					if (b64) sendFile('jpeg', b64, 'base64', name + '.jpeg');
  					pending--;
  					checkDone();
  				});
  			}

  			// PDF i HTML — natywny dialog
  			if (formats.indexOf('pdf') !== -1) triggerPdfExport(ui);
  			if (formats.indexOf('html') !== -1) ui.downloadFile('html');

  			checkDone(); // jeśli brak async formatów
  		});
  ```

- [ ] **Krok 3: Dodaj obsługę export-data i export-complete w electron.js**

  W `electron.js`, w bloku `ipcMain.on('ext-result', ...)` (Task 1, Krok 3), zmień komentarz `// obsługiwane osobno w Task 5` na faktyczną obsługę.

  Zastąp cały handler `ext-result` z Task 1:

  ```javascript
  var pendingExportFolder = null;
  var pendingExportSucceeded = [];
  var pendingExportFailed = [];

  ipcMain.on('ext-result', async (e, msg) =>
  {
  	if (!msg) return;

  	if (msg.type === 'export-data')
  	{
  		if (!pendingExportFolder) return;
  		const filePath = path.join(pendingExportFolder, msg.filename);
  		try
  		{
  			await fsProm.writeFile(filePath, msg.data, msg.encoding);
  			pendingExportSucceeded.push(msg.format.toUpperCase());
  		}
  		catch (err)
  		{
  			pendingExportFailed.push(msg.format.toUpperCase());
  		}
  		return;
  	}

  	if (msg.type === 'export-complete')
  	{
  		const folder = pendingExportFolder;
  		const succeeded = pendingExportSucceeded.slice();
  		const failed = pendingExportFailed.slice();
  		pendingExportFolder = null;
  		pendingExportSucceeded = [];
  		pendingExportFailed = [];

  		if (controlPanelWin && !controlPanelWin.isDestroyed())
  		{
  			controlPanelWin.webContents.send('ext-result',
  				{type: 'export-summary', folder: folder,
  				 succeeded: succeeded, failed: failed});
  		}
  		return;
  	}

  	// Pozostałe typy (number-progress, number-done, number-status itp.)
  	if (controlPanelWin && !controlPanelWin.isDestroyed())
  	{
  		controlPanelWin.webContents.send('ext-result', msg);
  	}
  });
  ```

  Również w bloku `ext-cmd` (Task 1, Krok 3), w gałęzi `msg.type === 'export'`, przed `target.webContents.send(...)` ustaw folder:

  ```javascript
  		pendingExportFolder = folder;
  		pendingExportSucceeded = [];
  		pendingExportFailed = [];
  		target.webContents.send('ext-cmd', msg);
  ```

- [ ] **Krok 4: Test manualny w DevTools**

  Otwórz diagram, w DevTools Console:

  ```javascript
  window.electron.sendMessage('ext-cmd', {
    type: 'export',
    payload: {
      formats: ['xml', 'json', 'svg'],
      folder: 'C:/temp',
      allPages: false,
      imagesMode: 'current'
    }
  })
  ```

  (Utwórz folder `C:/temp` wcześniej.) Oczekiwane: pliki `diagram.xml`, `diagram.json`, `diagram.svg` pojawiają się w `C:/temp`.

- [ ] **Krok 5: Commit**

  ```bash
  cd c:/Projects/drawio-desktop/drawio
  git add src/main/webapp/js/extensions/export-all.js
  git commit -m "feat: add multi-format export via ext-cmd (SVG, PNG, JPEG + XML/JSON)"
  git push
  cd ..
  git add drawio src/main/electron.js
  git commit -m "feat: add export-data/export-complete IPC handling in main process"
  git push
  ```

---

### Task 6: Panel kontrolny — fundament (HTML + preload + BrowserWindow + menu)

**Files:**
- Create: `src/main/control-panel.html`
- Create: `src/main/control-panel-preload.js`
- Modify: `src/main/electron.js`

**Interfaces:**
- Produkuje:
  - `window.panelBridge.sendCmd(type, payload)` — wysyła ext-cmd do main
  - `window.panelBridge.onResult(type, callback)` — odbiera ext-result z main
  - BrowserWindow `controlPanelWin` (singleton) otwierany z menu "Rozszerzenia" lub Ctrl+Shift+P

- [ ] **Krok 1: Utwórz control-panel-preload.js**

  ```javascript
  const { contextBridge, ipcRenderer } = require('electron');

  contextBridge.exposeInMainWorld('panelBridge',
  {
  	sendCmd: function (type, payload)
  	{
  		ipcRenderer.send('ext-cmd', {type: type, payload: payload || {}});
  	},
  	onResult: function (type, callback)
  	{
  		ipcRenderer.on('ext-result', function (event, msg)
  		{
  			if (msg && msg.type === type) callback(msg);
  		});
  	}
  });
  ```

- [ ] **Krok 2: Utwórz control-panel.html — pełny layout (statyczny, bez wiring)**

  ```html
  <!DOCTYPE html>
  <html lang="pl">
  <head>
    <meta charset="UTF-8">
    <title>Panel rozszerzeń</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 13px;
        background: #f0f0f0;
        color: #333;
        user-select: none;
      }
      h2 {
        font-size: 13px;
        font-weight: 600;
        padding: 8px 12px 6px;
        background: #e0e0e0;
        border-bottom: 1px solid #ccc;
        color: #555;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .section { border-bottom: 1px solid #ccc; padding: 10px 12px; }
      .section:last-child { border-bottom: none; }
      .row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
      .row:last-child { margin-bottom: 0; }
      .label { font-size: 13px; }
      button {
        padding: 4px 12px;
        font-size: 12px;
        border: 1px solid #aaa;
        border-radius: 3px;
        background: #fff;
        cursor: pointer;
      }
      button:hover { background: #e8e8e8; }
      button:active { background: #d0d0d0; }
      button:disabled { opacity: 0.5; cursor: default; }
      /* Toggle */
      .toggle-btn {
        width: 100px;
        text-align: center;
        font-weight: 500;
      }
      .toggle-btn.on { background: #4caf50; color: #fff; border-color: #388e3c; }
      .toggle-btn.on:hover { background: #43a047; }
      .toggle-btn.off { background: #f44336; color: #fff; border-color: #c62828; }
      .toggle-btn.off:hover { background: #e53935; }
      /* Folder */
      .folder-row { display: flex; gap: 6px; margin-bottom: 8px; }
      .folder-input {
        flex: 1;
        padding: 4px 6px;
        font-size: 12px;
        border: 1px solid #aaa;
        border-radius: 3px;
      }
      /* Checkboxes */
      .formats-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 4px 8px;
        margin-bottom: 8px;
      }
      .formats-grid label { display: flex; align-items: center; gap: 4px; cursor: pointer; }
      .all-pages-row { margin-bottom: 6px; }
      .all-pages-row label { display: flex; align-items: center; gap: 4px; cursor: pointer; }
      .images-mode { margin-left: 20px; display: none; font-size: 12px; color: #555; }
      .images-mode.visible { display: block; }
      .images-mode label { display: flex; align-items: center; gap: 4px; cursor: pointer; margin-bottom: 2px; }
      /* Status */
      .status {
        font-size: 11px;
        color: #666;
        margin-top: 6px;
        min-height: 16px;
      }
      .status.error { color: #c62828; }
      .status.success { color: #2e7d32; }
    </style>
  </head>
  <body>
    <h2>Panel rozszerzeń</h2>

    <!-- Highlight -->
    <div class="section">
      <div class="row">
        <span class="label">Podświetlenie zaznaczenia</span>
        <button id="highlightToggle" class="toggle-btn on">Włączone</button>
      </div>
    </div>

    <!-- Numerowanie -->
    <div class="section">
      <div class="row">
        <span class="label">Numerowanie elementów</span>
        <button id="numberBtn">Numeruj</button>
      </div>
      <div class="status" id="numberStatus"></div>
    </div>

    <!-- Eksport -->
    <div class="section">
      <div class="label" style="margin-bottom:8px;font-weight:600;">Eksportuj...</div>
      <div class="folder-row">
        <input type="text" id="folderInput" class="folder-input" placeholder="Ścieżka folderu..." />
        <button id="browseBtn">...</button>
      </div>
      <div class="formats-grid">
        <label><input type="checkbox" id="fmt-xml" value="xml" checked> XML</label>
        <label><input type="checkbox" id="fmt-json" value="json" checked> JSON</label>
        <label><input type="checkbox" id="fmt-pdf" value="pdf"> PDF</label>
        <label><input type="checkbox" id="fmt-svg" value="svg"> SVG</label>
        <label><input type="checkbox" id="fmt-png" value="png"> PNG</label>
        <label><input type="checkbox" id="fmt-jpeg" value="jpeg"> JPEG</label>
        <label><input type="checkbox" id="fmt-html" value="html"> HTML</label>
      </div>
      <div class="all-pages-row">
        <label><input type="checkbox" id="allPages"> Wszystkie strony</label>
      </div>
      <div class="images-mode" id="imagesMode">
        <label><input type="radio" name="imagesMode" value="perPage" checked> Per strona</label>
        <label><input type="radio" name="imagesMode" value="current"> Tylko bieżąca</label>
      </div>
      <div class="row" style="margin-top:8px;">
        <div></div>
        <button id="exportBtn">Eksportuj</button>
      </div>
      <div class="status" id="exportStatus"></div>
    </div>

    <script src="panel.js"></script>
  </body>
  </html>
  ```

- [ ] **Krok 3: Utwórz src/main/panel.js — plik JS panelu (pusty wiring, wypełniany w Taskach 7-9)**

  ```javascript
  // panel.js — wiring między UI a panelBridge
  // Wypełniany w Tasks 7, 8, 9
  ```

- [ ] **Krok 4: Dodaj funkcję openControlPanel i menu w electron.js**

  W `electron.js`, po zmiennych `controlPanelWin` i `lastFocusedDrawioWin` (Task 1, Krok 1), dodaj funkcję:

  ```javascript
  function openControlPanel()
  {
  	if (controlPanelWin && !controlPanelWin.isDestroyed())
  	{
  		controlPanelWin.focus();
  		return;
  	}

  	controlPanelWin = new BrowserWindow(
  	{
  		width: 280,
  		height: 420,
  		resizable: false,
  		title: 'Panel rozszerzeń',
  		webPreferences:
  		{
  			preload: path.join(__dirname, 'control-panel-preload.js'),
  			contextIsolation: true,
  			nodeIntegration: false
  		}
  	});

  	controlPanelWin.loadFile(path.join(__dirname, 'control-panel.html'));

  	if (__DEV__)
  	{
  		controlPanelWin.webContents.openDevTools({mode: 'detach'});
  	}

  	controlPanelWin.on('closed', () =>
  	{
  		controlPanelWin = null;
  	});
  }
  ```

- [ ] **Krok 5: Dodaj skrót Ctrl+Shift+P (cross-platform) w electron.js**

  W `createWindow`, w bloku `before-input-event` (szukaj `pasteAndMatchStyle`), po istniejącym bloku Ctrl+Shift+E, dodaj:

  ```javascript
  		if (input.type === 'keyDown' && input.key === 'P' &&
  			input.shift && (isMac ? input.meta : input.control) && !input.alt)
  		{
  			event.preventDefault();
  			openControlPanel();
  		}
  ```

- [ ] **Krok 6: Dodaj menu "Rozszerzenia" na macOS**

  W bloku macOS menu (szukaj `label: 'File'`, ok. linia 2016), po bloku `File`, przed `Edit`, dodaj:

  ```javascript
  	  }, {
  	    label: 'Rozszerzenia',
  	    submenu: [
  	      {
  	        label: 'Panel rozszerzeń',
  	        accelerator: 'CmdOrCtrl+Shift+P',
  	        click() { openControlPanel(); }
  	      }
  	    ]
  	  }, {
  	    label: 'Edit',
  ```

- [ ] **Krok 7: Sprawdź że control-panel.html ładuje panel.js poprawnie**

  W `control-panel.html` script tag `<script src="panel.js"></script>` musi ładować `src/main/panel.js`. Ponieważ `loadFile` ładuje z katalogu `src/main/`, względna ścieżka `panel.js` jest poprawna.

- [ ] **Krok 8: Test manualny**

  Uruchom app. Sprawdź:
  - macOS: menu "Rozszerzenia" → "Panel rozszerzeń" otwiera okno 280×420
  - Wszystkie platformy: Ctrl+Shift+P (lub Cmd+Shift+P) otwiera panel
  - Drugie Ctrl+Shift+P → focus na istniejącym oknie, nie tworzy nowego
  - Panel zamyka się z aplikacją

- [ ] **Krok 9: Commit**

  ```bash
  cd c:/Projects/drawio-desktop
  git add src/main/control-panel.html src/main/control-panel-preload.js src/main/panel.js src/main/electron.js
  git commit -m "feat: add control panel BrowserWindow with menu and Ctrl+Shift+P shortcut"
  git push
  ```

---

### Task 7: Panel — sekcja highlight toggle

**Files:**
- Modify: `src/main/panel.js`

**Interfaces:**
- Konsumuje: `window.panelBridge.sendCmd('highlight-toggle', {value: bool})`
- Konsumuje: `localStorage.getItem('highlightEnabled')` — persystencja stanu

- [ ] **Krok 1: Zaimplementuj toggle w panel.js**

  Zastąp zawartość `src/main/panel.js`:

  ```javascript
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
  ```

- [ ] **Krok 2: Test manualny**

  Otwórz panel. Toggle pokazuje "Włączone" (zielony). Kliknij → "Wyłączone" (czerwony). Kliknij element w diagramie → brak podświetlenia. Kliknij toggle → "Włączone". Podświetlanie wraca.

  Zamknij panel, otwórz ponownie → stan toggle zachowany (localStorage).

- [ ] **Krok 3: Commit**

  ```bash
  cd c:/Projects/drawio-desktop
  git add src/main/panel.js
  git commit -m "feat: wire highlight toggle in control panel"
  git push
  ```

---

### Task 8: Panel — sekcja numerowanie

**Files:**
- Modify: `src/main/panel.js`

**Interfaces:**
- Konsumuje: `window.panelBridge.sendCmd('number', {})`
- Konsumuje: `window.panelBridge.onResult('number-progress', cb)`, `onResult('number-done', cb)`, `onResult('number-status', cb)`

- [ ] **Krok 1: Dodaj wiring numerowania do panel.js**

  Dołącz do `panel.js` (po sekcji highlight):

  ```javascript
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
  ```

- [ ] **Krok 2: Test manualny**

  Otwórz panel, otwórz diagram z połączonymi elementami. Kliknij "Numeruj":
  - Status pokazuje "Numerowanie: strona 1/1..." podczas operacji
  - Po zakończeniu: "Ponumerowano: X elementów" (znika po 3s)
  - Elementy mają numery w polach top-right
  - Ctrl+Z cofa całe numerowanie jedną operacją

  Test błędu: pusty diagram → "Nie znaleziono elementów do numerowania" (czerwony).

- [ ] **Krok 3: Commit**

  ```bash
  cd c:/Projects/drawio-desktop
  git add src/main/panel.js
  git commit -m "feat: wire numbering section in control panel"
  git push
  ```

---

### Task 9: Panel — sekcja eksport (folder, checkboxy, eksportuj)

**Files:**
- Modify: `src/main/panel.js`
- Modify: `src/main/electron.js`

**Interfaces:**
- Konsumuje: `window.panelBridge.sendCmd('export', payload)` gdzie payload = `{formats, folder, allPages, imagesMode}`
- Konsumuje: `window.panelBridge.onResult('export-summary', cb)`, `onResult('export-error', cb)`
- Konsumuje (electron.js): `dialog.showOpenDialog` dla Przeglądaj

- [ ] **Krok 1: Dodaj IPC handler dla browse-folder w electron.js**

  Po bloku `ipcMain.on('ext-cmd', ...)` (Task 1), dodaj:

  ```javascript
  ipcMain.handle('browse-folder', async () =>
  {
  	const result = await dialog.showOpenDialog(
  	{
  		title: 'Wybierz folder eksportu',
  		properties: ['openDirectory', 'createDirectory']
  	});
  	if (result.canceled || !result.filePaths[0]) return null;
  	return result.filePaths[0];
  });
  ```

- [ ] **Krok 2: Dodaj `ipcRenderer.invoke` do control-panel-preload.js**

  Dodaj do eksponowanego `panelBridge` obiektu w `control-panel-preload.js`:

  ```javascript
  	browseFolder: function ()
  	{
  		return ipcRenderer.invoke('browse-folder');
  	}
  ```

  Pełny `panelBridge` po zmianie:

  ```javascript
  contextBridge.exposeInMainWorld('panelBridge',
  {
  	sendCmd: function (type, payload)
  	{
  		ipcRenderer.send('ext-cmd', {type: type, payload: payload || {}});
  	},
  	onResult: function (type, callback)
  	{
  		ipcRenderer.on('ext-result', function (event, msg)
  		{
  			if (msg && msg.type === type) callback(msg);
  		});
  	},
  	browseFolder: function ()
  	{
  		return ipcRenderer.invoke('browse-folder');
  	}
  });
  ```

- [ ] **Krok 3: Dodaj wiring eksportu do panel.js**

  Dołącz do `panel.js` (po sekcji numerowanie):

  ```javascript
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

  var savedImagesMode = localStorage.getItem('exportImagesMode') || 'perPage';
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
  ```

- [ ] **Krok 4: Test manualny — pełny flow eksportu**

  Otwórz panel. Sekcja "Eksportuj...":
  - Kliknij "Eksportuj" bez folderu → "Wybierz folder eksportu" (czerwony)
  - Kliknij "..." (Przeglądaj) → folder picker otwiera się → po wyborze pole folderu wypełnione
  - Zaznacz XML, JSON, SVG → kliknij "Eksportuj"
  - Status: "Eksportowanie..." → "Wyeksportowano: XML, JSON, SVG"
  - Pliki pojawiają się w folderze
  - Zamknij panel, otwórz ponownie → folder i checkboxy zachowane

  Test "Wszystkie strony": włącz checkbox → pojawia się radio "Per strona / Tylko bieżąca".

- [ ] **Krok 5: Uruchom wszystkie unit testy**

  ```bash
  cd c:/Projects/drawio-desktop
  node --test src/test/export-all.test.js
  node --test src/test/numbering.test.js
  ```

  Oczekiwane: wszystkie PASS.

- [ ] **Krok 6: Commit końcowy**

  ```bash
  cd c:/Projects/drawio-desktop
  git add src/main/panel.js src/main/electron.js src/main/control-panel-preload.js
  git commit -m "feat: wire export section in control panel with folder picker and format checkboxes"
  git push
  ```

---

## Self-Review

### Spec coverage

| Wymaganie ze spec | Task |
|-------------------|------|
| ext-cmd IPC bus, focused window tracking | Task 1 |
| ext-result forwarding renderer → panel | Task 1, 5 |
| Highlight toggle via ext-cmd | Task 2 |
| `highlightEnabled` var, check w onSelectionChange | Task 2 |
| Algorytm numerowania (DFS, najdłuższa gałąź, cykl, izolowane) | Task 3 (testy), Task 4 (impl) |
| Wszystkie strony, licznik ciągły | Task 4 |
| Węzeł startowy = abs. pozycja min(x+y) | Task 4 |
| Ramki pomijane (`isSwimlane`) | Task 4 |
| Węzły bez top-right child pomijane w numeracji | Task 4 |
| Czyszczenie starych numerów przed DFS | Task 4 |
| ext-result progress, done, status | Task 4 |
| SVG eksport przez getSvg() | Task 5 |
| PNG/JPEG eksport przez SVG→canvas | Task 5 |
| XML/JSON eksport (istniejące) przez ext-cmd | Task 5 |
| PDF/HTML przez natywny dialog | Task 5 |
| export-data/export-complete handling w main | Task 5 |
| BrowserWindow 280×420, singleton, Ctrl+Shift+P | Task 6 |
| Menu "Rozszerzenia" → "Panel rozszerzeń" (macOS) | Task 6 |
| control-panel-preload.js z panelBridge | Task 6 |
| Panel HTML z pełnym layoutem | Task 6 |
| Toggle highlight w panelu, localStorage | Task 7 |
| Przywrócenie stanu highlight przy otwarciu | Task 7 |
| Numeruj button, status progress/done/error | Task 8 |
| Folder field (edytowalne), Przeglądaj | Task 9 |
| Format checkboxy, localStorage | Task 9 |
| Wszystkie strony checkbox + images radio | Task 9 |
| Eksportuj button — blokowany podczas ops | Task 9 |
| Status success/error z formatami | Task 9 |
| browse-folder IPC handle | Task 9 |
