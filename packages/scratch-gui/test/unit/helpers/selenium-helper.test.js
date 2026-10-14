import {describe, expect, test} from '@jest/globals';
import SeleniumHelper from '../../helpers/selenium-helper';

describe('SeleniumHelper diagnostics', () => {
    test('keeps the original WebDriver failure when diagnostic capture also fails', async () => {
        const helper = new SeleniumHelper();
        helper.driver = {
            executeScript: () => Promise.resolve(),
            wait: () => Promise.reject(new Error('original wait failure')),
            getCurrentUrl: () =>
                Promise.reject(new Error('driver session closed'))
        };

        try {
            await helper.findByXpath('//body');
            throw new Error('Expected findByXpath to fail');
        } catch (error) {
            expect(error.message).toContain('original wait failure');
            expect(error.message).toContain(
                'Diagnostic capture failed: driver session closed'
            );
            expect(error.cause.message).toBe('original wait failure');
        }
    });
});
