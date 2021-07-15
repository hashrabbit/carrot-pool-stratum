const { describe, it } = require('mocha');
const { expect } = require('chai');
const Merkle = require('../scripts/merkle.js');

describe('merkle', () => {
  it('calculates the merkle branch correctly', () => {
    const args = ['foo', 'bar', 'baz', 'a', 'b', 'c', 'd'].map(Buffer.from);
    args.unshift(null);
    const expected = [
      '666f6f',
      'fbea6d88dad1e3dcd5999ce90e948f37088998c1dee0fd83c368a08935e86c1e',
      '49a980a488222504a9112c2bf1afb9541b70020ed188ed92ac1cabed6ef16f99',
    ];

    const { branch } = new Merkle(args);
    const hex = branch.map((step) => step.toString('hex'));

    expect(hex).to.deep.equal(expected);
  });
});
