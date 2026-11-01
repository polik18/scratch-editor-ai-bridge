const path = require('path');

// Only the immutable scripts emitted for Scratch's opaque-origin sandboxes.
const SANDBOX_ASSET = /^\/static\/assets\/(?:runner|measure-svg|paper-core\.min|paper-import)\.[a-f0-9]+\.js$/;

const createSandboxDevMiddleware = compiler => (req, res, next) => {
    const request = new URL(req.url, 'http://localhost');
    if (req.method !== 'GET' ||
        req.headers['sec-fetch-site'] !== 'cross-site' ||
        req.headers['sec-fetch-mode'] !== 'no-cors' ||
        req.headers['sec-fetch-dest'] !== 'script' ||
        !request.searchParams.has('resource') ||
        !SANDBOX_ASSET.test(request.pathname)) {
        next();
        return;
    }

    const assetPath = path.join(compiler.outputPath, request.pathname.slice(1));
    compiler.outputFileSystem.readFile(assetPath, (error, data) => {
        if (error) {
            res.statusCode = 404;
            res.end('Sandbox asset not found');
            return;
        }
        res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.end(data);
    });
};

const installSandboxDevMiddleware = (middlewares, devServer) => {
    const hostCheck = middlewares.findIndex(middleware => middleware.name === 'host-header-check');
    const crossOriginCheck = middlewares.findIndex(middleware => middleware.name === 'cross-origin-header-check');
    if (hostCheck < 0 || crossOriginCheck <= hostCheck) {
        throw new Error('Cannot install sandbox middleware without the expected development server host checks.');
    }
    middlewares.splice(crossOriginCheck, 0, {
        name: 'scratch-sandbox-assets',
        middleware: createSandboxDevMiddleware(devServer.compiler)
    });
    return middlewares;
};

module.exports = {createSandboxDevMiddleware, installSandboxDevMiddleware};
