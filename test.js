// Run with: node test.js
// Userscripts are sealed IIFEs, so the function under test is read straight from the script source.
const fs = require('fs')
const assert = require('assert')

const src = fs.readFileSync(__dirname + '/order_number_extractor.js', 'utf8')
const regexLine = src.match(/const ORDER_REGEX = .*/)[0]
const fnSource = src.match(/function findOrderOffsets\(text\) \{[\s\S]*?\n    \}/)[0]
const findOrderOffsets = new Function(`${regexLine}\n${fnSource}\nreturn findOrderOffsets`)()

const orders = (text) => findOrderOffsets(text).map(([s, e]) => text.slice(s, e))

// Offsets point exactly at the numbers, surrounding HTML-looking text is ignored
assert.deepStrictEqual(orders('<img src=x onerror=alert(1)> see 1012345678 and 301234567 end'), ['1012345678', '301234567'])

// Edges: order at start/end, back to back, no orders, wrong prefix or length, empty
assert.deepStrictEqual(findOrderOffsets('1012345678'), [[0, 10]])
assert.deepStrictEqual(orders('1012345678,3012345678'), ['1012345678', '3012345678'])
assert.deepStrictEqual(findOrderOffsets('no orders'), [])
assert.deepStrictEqual(orders('2012345678 10123456 101234567890'), [])
assert.deepStrictEqual(findOrderOffsets(''), [])

// Repeated calls give the same result (the regex is global, so lastIndex must not leak)
assert.deepStrictEqual(orders('x 1012345678'), orders('x 1012345678'))

console.log('ok')
