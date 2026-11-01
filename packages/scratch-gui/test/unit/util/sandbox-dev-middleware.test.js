const {createSandboxDevMiddleware, installSandboxDevMiddleware} = require('../../../sandbox-dev-middleware');

const response = () => ({
    headers: {},
    setHeader (name, value) {
        this.headers[name] = value;
    },
    end: jest.fn()
});

describe('sandbox development assets', () => {
    const headers = {'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'script'};
    const compiler = {outputPath: '/build', outputFileSystem: {readFile: jest.fn()}};
    const middleware = createSandboxDevMiddleware(compiler);
    beforeEach(() => jest.resetAllMocks());

    test('serves only emitted sandbox scripts across the opaque origin', () => {
        compiler.outputFileSystem.readFile.mockImplementation((file, callback) =>
            callback(null, Buffer.from('script')));
        const res = response();
        const next = jest.fn();
        middleware({method: 'GET', url: '/static/assets/measure-svg.abcdef12.js?resource', headers}, res, next);
        expect(compiler.outputFileSystem.readFile).toHaveBeenCalledWith(
            '/build/static/assets/measure-svg.abcdef12.js', expect.any(Function)
        );
        expect(res.headers['Cross-Origin-Resource-Policy']).toBe('cross-origin');
        expect(res.headers['Content-Type']).toMatch(/javascript/);
        expect(res.end).toHaveBeenCalledWith(Buffer.from('script'));
        expect(next).not.toHaveBeenCalled();
    });

    test.each([
        ['/static/assets/private.abcdef12.js?resource', 'GET', headers],
        ['/static/assets/runner.abcdef12.js', 'GET', headers],
        ['/static/assets/runner.abcdef12.js?resource', 'POST', headers],
        ['/static/assets/runner.abcdef12.js?resource', 'GET', {'sec-fetch-site': 'same-origin'}],
        ['/static/assets/runner.abcdef12.js/../../secrets?resource', 'GET', headers]
    ])('passes unrelated requests through unchanged', (url, method, requestHeaders) => {
        const next = jest.fn();
        middleware({method, url, headers: requestHeaders}, response(), next);
        expect(next).toHaveBeenCalledTimes(1);
        expect(compiler.outputFileSystem.readFile).not.toHaveBeenCalled();
    });

    test('keeps host checking ahead of the exception', () => {
        const middlewares = [{name: 'host-header-check'}, {name: 'cross-origin-header-check'}];
        const result = installSandboxDevMiddleware(middlewares, {compiler});
        expect(result.map(({name}) => name)).toEqual([
            'host-header-check', 'scratch-sandbox-assets', 'cross-origin-header-check'
        ]);
    });

    test('returns 404 when the compiled asset does not exist', () => {
        compiler.outputFileSystem.readFile.mockImplementation((file, callback) => callback(new Error('missing')));
        const res = response();
        middleware({method: 'GET', url: '/static/assets/runner.abcdef12.js?resource', headers}, res, jest.fn());
        expect(res.statusCode).toBe(404);
        expect(res.end).toHaveBeenCalledWith('Sandbox asset not found');
    });

    test('fails closed if the host check cannot be verified', () => {
        expect(() => installSandboxDevMiddleware([{name: 'cross-origin-header-check'}], {compiler})).toThrow();
    });
});
