const { describe, it, beforeEach } = require('mocha');
const { expect } = require('chai');
const versionRolling = require('../../scripts/stratum/version_rolling.js');

describe('validHex', () => {
  describe('with hex strings too small', () => {
    let hex;
    beforeEach(() => {
      hex = '1234567';
    });
    it('returns false', () => {
      expect(versionRolling.validHex(hex)).to.be.false;
    });
  });

  describe('with hex strings too large', () => {
    let hex;
    beforeEach(() => {
      hex = '123456789';
    });

    it('returns false', () => {
      expect(versionRolling.validHex(hex)).to.be.false;
    });
  });

  describe('with four-byte hex strings', () => {
    describe('with non-hex characters', () => {
      let nonHexStrings;
      beforeEach(() => {
        nonHexStrings = ['+0112233', '-fffffff', 'ffgg0011', 'etcetera'];
      });

      it('returns false', () => {
        nonHexStrings.forEach((h) => {
          expect(versionRolling.validHex(h)).to.be.false;
        });
      });
    });

    describe('with valid hex characters', () => {
      let hexStrings;
      beforeEach(() => {
        hexStrings = ['00112233', 'ffffffff', 'AAbbCCdd', 'deadBEEF'];
      });

      it('returns true', () => {
        hexStrings.forEach((h) => {
          expect(versionRolling.validHex(h)).to.be.true;
        });
      });
    });
  });
});

describe('validate', () => {
  describe('with an improper hexstring to validate', () => {
    let nonHexStrings;
    beforeEach(() => {
      nonHexStrings = ['+0112233', '-fffffff', 'ffgg0011', 'etcetera'];
    });

    it('returns false', () => {
      nonHexStrings.forEach((h) => {
        expect(versionRolling.validHex(h)).to.be.false;
      });
    });
  });

  describe('with a proper hexstring to validate', () => {
    describe('when the hexstring represents bits not set in the bitmask', () => {
      let mask;
      let badHexStrings;

      beforeEach(() => {
        mask = 'ff00ff00';
        badHexStrings = ['00000001', 'ffffffff', 'e0e0e0e0', '00070000'];
      });

      it('returns false', () => {
        badHexStrings.forEach((h) => {
          expect(versionRolling.validate(h, mask)).to.be.false;
        });
      });
    });

    describe('when the hexstring represents bits only set in the bitmask', () => {
      let mask;
      let hexStrings;

      beforeEach(() => {
        mask = 'ff00ff00';
        hexStrings = ['12003400', 'f0000000', 'e000e000', '00000000'];
      });

      it('returns true', () => {
        hexStrings.forEach((h) => {
          expect(versionRolling.validate(h, mask)).to.be.true;
        });
      });
    });
  });
});

describe('handle', () => {
  describe('with no params', () => {
    let response;
    beforeEach(() => {
      response = versionRolling.handle();
    });

    it('responds with version-rolling accepted', () => {
      expect(response['version-rolling']).to.be.true;
    });

    it('sets the default version-rolling mask', () => {
      expect(response['version-rolling.mask']).to.eq(versionRolling.maxMaskHex);
    });
  });

  describe('with an invalid version-rolling param', () => {
    let response;
    beforeEach(() => {
      response = versionRolling.handle({ 'version-rolling.mask': 'invalid!' });
    });

    it('responds with version-rolling accepted', () => {
      expect(response['version-rolling']).to.eq('Invalid version-rolling.mask parameter.');
    });
  });

  describe('with a valid version-rolling param', () => {
    describe('when the request mask has fewer or equal bits in common with the maximum mask', () => {
      let smallMasks;
      let responses;
      beforeEach(() => {
        smallMasks = ['1f000000', '0fffa000', '1aaaa000'];
        responses = smallMasks.map((mask) => versionRolling.handle({ 'version-rolling.mask': mask }));
      });

      it('responds with version-rolling accepted', () => {
        responses.forEach((response) => {
          expect(response['version-rolling']).to.be.true;
        });
      });

      it('responds with the requested mask', () => {
        responses.forEach((response, idx) => {
          expect(response['version-rolling.mask']).to.eq(smallMasks[idx]);
        });
      });
    });

    describe('when the request mask has bits outside the maximum mask', () => {
      let bigMasks;
      let resultMasks;
      let responses;
      beforeEach(() => {
        bigMasks = ['ff000000', '2020f020', 'ffffffff'];
        resultMasks = ['1f000000', '0020e000', '1fffe000'];
        responses = bigMasks.map((mask) => versionRolling.handle({ 'version-rolling.mask': mask }));
      });

      it('responds with version-rolling accepted', () => {
        responses.forEach((response) => {
          expect(response['version-rolling']).to.be.true;
        });
      });

      it('responds with just the bits within the maximum mask', () => {
        responses.forEach((response, idx) => {
          expect(response['version-rolling.mask']).to.eq(resultMasks[idx]);
        });
      });
    });
  });
});
