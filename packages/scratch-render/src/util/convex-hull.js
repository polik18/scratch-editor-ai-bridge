const cross = (origin, first, second) =>
    ((first[0] - origin[0]) * (second[1] - origin[1])) - ((first[1] - origin[1]) * (second[0] - origin[0]));

const tangent = points => {
    const result = [];
    for (const point of points) {
        while (result.length >= 2 && cross(result[result.length - 2], result[result.length - 1], point) <= 0) {
            result.pop();
        }
        result.push(point);
    }
    result.pop();
    return result;
};

/**
 * Return the convex boundary of a point list in clockwise order.
 * Lists shorter than four points retain their original order for Scratch compatibility.
 * @param {Array<Array<number>>} points 2D points.
 * @returns {Array<Array<number>>} Convex boundary, closed by repeating its first point.
 */
module.exports = points => {
    if (points.length < 4) return points.slice();

    const sorted = points.slice()
        .sort((first, second) => {
            if (first[0] === second[0]) return first[1] - second[1];
            return first[0] - second[0];
        })
        .filter((point, index, pointList) => {
            const previous = pointList[index - 1];
            return index === 0 || previous[0] !== point[0] || previous[1] !== point[1];
        });

    const upper = tangent(sorted);
    const reversed = sorted.slice().reverse();
    const lower = tangent(reversed);
    return lower.concat(upper, [reversed[0]]);
};
