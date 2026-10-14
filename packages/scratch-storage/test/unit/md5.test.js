const jsMd5 = require('js-md5');
const md5 = require('../../src/md5').default;

describe('Scratch asset MD5 compatibility', () => {
    it.each([
        ['empty', ''],
        ['ASCII', 'abc'],
        ['Unicode', '雪🚀'],
        ['large string', 'a'.repeat(16 * 1024)],
        ['binary bytes', new Uint8Array([0, 0x7f, 0x80, 0xff])],
        ['array bytes', [0, 0x7f, 0x80, 0xff]]
    ])('matches the previous JS-MD5 output for %s input', (_label, data) => {
        expect(md5(data)).toBe(jsMd5(data));
    });
});
