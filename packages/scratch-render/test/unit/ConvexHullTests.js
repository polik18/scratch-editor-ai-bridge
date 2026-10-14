const test = require('tap').test;
const convexHull = require('../../src/util/convex-hull');

test('preserve short point lists unchanged', t => {
    const points = [[1, 2], [3, 4], [5, 6]];
    t.same(convexHull(points), points);
    t.not(convexHull(points), points);
    t.end();
});

test('return a closed clockwise square boundary and discard interior points', t => {
    const points = [[0, 0], [0, 1], [1, 0], [1, 1], [0.5, 0.5], [0, 0]];
    t.same(convexHull(points), [[1, 1], [0, 1], [0, 0], [1, 0], [1, 1]]);
    t.end();
});

test('discard collinear edge points and duplicate coordinates', t => {
    const points = [[0, 0], [1, 0], [2, 0], [2, 1], [1, 1], [0, 1], [0, 0]];
    t.same(convexHull(points), [[2, 1], [0, 1], [0, 0], [2, 0], [2, 1]]);
    t.end();
});

test('return a valid closed boundary for fully collinear points', t => {
    const points = [[0, 0], [1, 0], [2, 0], [3, 0]];
    t.same(convexHull(points), [[3, 0], [0, 0], [3, 0]]);
    t.end();
});
