import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// Local copy of xmlNodeToJson for isolated testing
function xmlNodeToJson(node)
{
    var obj = {};

    if (node.attributes)
    {
        for (var i = 0; i < node.attributes.length; i++)
        {
            var attr = node.attributes[i];
            obj['@' + attr.name] = attr.value;
        }
    }

    var children = [];

    for (var i = 0; i < node.childNodes.length; i++)
    {
        var child = node.childNodes[i];

        if (child.nodeType === 1)
        {
            var childObj = {};
            childObj[child.nodeName] = xmlNodeToJson(child);
            children.push(childObj);
        }
    }

    if (children.length > 0)
    {
        obj['#children'] = children;
    }

    return obj;
}

describe('xmlNodeToJson', () =>
{
    test('konwertuje atrybuty na klucze z prefiksem @', () =>
    {
        const dom = new JSDOM('<root id="1" name="test"/>', { contentType: 'application/xml' });
        const node = dom.window.document.querySelector('root');
        const result = xmlNodeToJson(node);
        assert.equal(result['@id'], '1');
        assert.equal(result['@name'], 'test');
    });

    test('konwertuje elementy potomne na tablicę #children', () =>
    {
        const dom = new JSDOM('<root><child id="2"/></root>', { contentType: 'application/xml' });
        const node = dom.window.document.querySelector('root');
        const result = xmlNodeToJson(node);
        assert.ok(Array.isArray(result['#children']));
        assert.equal(result['#children'].length, 1);
        assert.ok(result['#children'][0]['child']);
        assert.equal(result['#children'][0]['child']['@id'], '2');
    });

    test('węzeł bez dzieci nie ma klucza #children', () =>
    {
        const dom = new JSDOM('<leaf value="x"/>', { contentType: 'application/xml' });
        const node = dom.window.document.querySelector('leaf');
        const result = xmlNodeToJson(node);
        assert.equal(result['#children'], undefined);
        assert.equal(result['@value'], 'x');
    });

    test('zachowuje zagnieżdżoną strukturę mxfile', () =>
    {
        const dom = new JSDOM(
            '<mxfile><diagram id="d1"><mxGraphModel><root/></mxGraphModel></diagram></mxfile>',
            { contentType: 'application/xml' }
        );
        const node = dom.window.document.querySelector('mxfile');
        const result = xmlNodeToJson(node);
        const diagram = result['#children'][0]['diagram'];
        assert.equal(diagram['@id'], 'd1');
        assert.ok(diagram['#children'][0]['mxGraphModel']);
    });
});
