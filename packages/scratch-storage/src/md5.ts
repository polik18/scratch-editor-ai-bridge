import {md5 as nobleMd5} from '@noble/hashes/legacy.js';
import {bytesToHex} from '@noble/hashes/utils.js';
import type {AssetData} from './Asset';
import {_TextEncoder} from './memoizedToString';

/**
 * Hash Scratch asset bytes using the MD5 spelling used in SB3 asset IDs.
 * String input is encoded as UTF-8 to match js-md5's string behavior.
 * @param {AssetData} data The asset contents to hash.
 * @returns {string} The lowercase hexadecimal MD5 digest.
 */
const md5 = (data: AssetData): string => {
    const bytes =
        typeof data === 'string' ?
            new _TextEncoder().encode(data) :
            data instanceof Uint8Array ?
                data :
                Uint8Array.from(data as unknown as number[]);
    return bytesToHex(nobleMd5(bytes));
};

export default md5;
