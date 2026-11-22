// Run with: node test.js
// Userscripts are sealed IIFEs, so the function under test is read straight from the script source.
const fs = require('fs')
const assert = require('assert')

const src = fs.readFileSync(__dirname + '/order_number_extractor.js', 'utf8')
const regexLine = src.match(/const ORDER_REGEX = .*/)[0]
const fnSource = src.match(/function splitOrders\(text\) \{[\s\S]*?\n    \}/)[0]
const splitOrders = new Function(`${regexLine}\n${fnSource}\nreturn splitOrders`)()

const join = (parts) => parts.map((p) => p.text).join('')
const orders = (parts) => parts.filter((p) => p.isOrder).map((p) => p.text)

// HTML in ticket text stays plain text and the pieces rebuild the exact input
const evil = '<img src=x onerror=alert(1)> see 1012345678 and 301234567 end'
const parts = splitOrders(evil)
assert.strictEqual(join(parts), evil)
assert.deepStrictEqual(orders(parts), ['1012345678', '301234567'])
assert.ok(parts.some((p) => !p.isOrder && p.text.includes('<img')))

// Edges: order at start/end, back to back, no orders, wrong prefix or length
assert.deepStrictEqual(splitOrders('1012345678'), [{ text: '1012345678', isOrder: true }])
assert.deepStrictEqual(orders(splitOrders('1012345678,3012345678')), ['1012345678', '3012345678'])
assert.deepStrictEqual(splitOrders('no orders'), [{ text: 'no orders', isOrder: false }])
assert.deepStrictEqual(orders(splitOrders('2012345678 10123456 101234567890')), [])
assert.deepStrictEqual(splitOrders(''), [])

console.log('ok')
