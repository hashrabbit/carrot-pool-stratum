const maxMaskHex = '1fffe000'; // See BIP-320
const maxMaskBits = parseInt(maxMaskHex, 16);

// Validates a 4-byte hex-encoded string
function validHex(hexChars) {
  const hexAlphabet = '0123456789aAbBcCdDeEfF';
  return (typeof hexChars === 'string')
    && (hexChars.length === 8)
    && ([...hexChars].every((hexChar) => hexAlphabet.includes(hexChar)));
}

function validate(bitsHex, maskHex) {
  if (!validHex(bitsHex)) {
    return false;
  }

  const bits = parseInt(bitsHex, 16);
  const allowedBits = parseInt(maskHex, 16);
  return (bits & ~allowedBits) === 0;
}

function handle(params) {
  const response = {};
  const requestMaskHex = params && params['version-rolling.mask'];

  if (!requestMaskHex) {
    response['version-rolling'] = true;
    response['version-rolling.mask'] = maxMaskHex;
    return response;
  }

  if (!validHex(requestMaskHex)) {
    response['version-rolling'] = 'Invalid version-rolling.mask parameter.';
    return response;
  }

  const requestMaskBits = parseInt(requestMaskHex, 16);
  const responseMaskBits = requestMaskBits & maxMaskBits;
  const responseMaskHex = responseMaskBits.toString(16).padStart(8, '0');

  response['version-rolling'] = true;
  response['version-rolling.mask'] = responseMaskHex;
  return response;
}

module.exports = {
  maxMaskHex,
  maxMaskBits,
  validHex,
  validate,
  handle
};
