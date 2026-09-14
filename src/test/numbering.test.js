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
			if ((adjacency[k] || []).some(function (t) { return t && t.id === c.id; }))
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
