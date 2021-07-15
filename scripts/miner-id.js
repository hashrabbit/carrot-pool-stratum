require('dotenv').config()
const bsv = require('bsv')
const protocolName = 'ac1eed88'
const cbdVersion = '0.1'

function createCoinbaseDocument (height, minerId, prevMinerIdPrivKey, vcTx, optionalData) {
  let prevMinerId = prevMinerIdPrivKey.toPublicKey().toString()

  prevMinerId = prevMinerId || minerId

  const minerIdSigPayload = Buffer.concat([
    Buffer.from(prevMinerId, 'hex'),
    Buffer.from(minerId, 'hex'),
    Buffer.from(vcTx, 'hex')
  ])

  const hash = bsv.crypto.Hash.sha256(minerIdSigPayload)
  const prevMinerIdSig = bsv.crypto.ECDSA.sign(hash, prevMinerIdPrivKey).toString()

  const doc = {
    version: cbdVersion,
    height: height,

    prevMinerId: prevMinerId,
    prevMinerIdSig: prevMinerIdSig,

    minerId: minerId,

    vctx: {
      txId: vcTx,
      vout: 0
    }
  }
  if (optionalData) {
    doc.minerContact = optionalData
  }
  return doc
}

function createMinerIdOpReturn (height, minerIdPrivKey, prevMinerIdPrivKey, vcTx, mc) {
  const minerId = minerIdPrivKey.toPublicKey().toString()
  const doc = createCoinbaseDocument(height, minerId, prevMinerIdPrivKey, vcTx, mc)

  const payload = JSON.stringify(doc)

  const hash = bsv.crypto.Hash.sha256(Buffer.from(payload))
  const signature = bsv.crypto.ECDSA.sign(hash, minerIdPrivKey).toString()

  const opReturnScript = bsv.Script.buildSafeDataOut([protocolName, payload, signature]).toBuffer()
  return opReturnScript
}

exports.generate = function (height) {
  try {
    const v = process.env.VCTX
    const mc = {
      name: process.env.MINERID_NAME.toString(),
      email: process.env.MINERID_EMAIL.toString(),
      merchantAPIEndPoint: process.env.MINERID_MAPI.toString()
    }
    const prevMinerIdPrivKey = bsv.PrivateKey.fromWIF(process.env.PREV_MINERID_PK.toString())
    const minerIdPrivKey = bsv.PrivateKey.fromWIF(process.env.MINERID_PK.toString())
    const minerIdPayload = createMinerIdOpReturn(height, minerIdPrivKey, prevMinerIdPrivKey, v, mc)

    return minerIdPayload
  } catch (e) {
    console.log(
      'Incorrect miner-id parameters, please make sure .env file is setup correctly: ', e
    )
  }
}
