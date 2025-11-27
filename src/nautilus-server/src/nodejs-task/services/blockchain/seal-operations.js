const {
  SealClient,
  SessionKey,
  EncryptedObject,
} = require("@mysten/seal");
const { toHex } = require("@mysten/sui/utils");
const crypto = require("crypto");
const logger = require("../../utils/logger");

class SealOperations {
  constructor(suiClient, options = {}) {
    this.suiClient = suiClient;
    this.options = options;
    this.movePackageId = process.env.MOVE_PACKAGE_ID;
    
    if (!this.movePackageId) {
      throw new Error('MOVE_PACKAGE_ID environment variable is required');
    }

    const rubyNodesApiKey = process.env.RUBY_NODES_API_KEY;
    if (!rubyNodesApiKey) {
      throw new Error('RUBY_NODES_API_KEY environment variable is required');
    }

    const keyServers = ["0x7b757569e0f57c1bebcddcf934ecce4c59f668aec53ab012060e23654649efed"];
    this.sealClient = new SealClient({
      suiClient: this.suiClient,
      serverConfigs: keyServers.map((id) => ({
        objectId: id,
        weight: 1,
        apiKey: rubyNodesApiKey,
        apiKeyName: 'x-api-key'
      })),
      verifyKeyServers: false,
    });
  }

  async decryptFile(
    fileObjectId,
    // attestationObjId,
    encryptedFile,
    // onChainFileObjId,
    policyObjectId,
    // threshold,
    suiOperations
  ) {
    let address, sessionKey, message, signature, txBytes, decryptedBytes, jsonString;
    try {
      // Step 1: Get the address
      try {
        address = suiOperations.getKeypairAddress();
        logger.log(`[address] 🎯 Got keypair address`);
      } catch (err) {
        logger.error(`[address] ❌ Failed to get keypair address: ${err.message}`);
        throw new Error(`[address] ${err.message}`);
      }

      // Step 2: Create session key
      try {
        sessionKey = await SessionKey.create({
          address,
          packageId: this.movePackageId,
          ttlMin: 10,
          suiClient: this.suiClient,
        });
        logger.log(`[sessionKey.create] 🎯 SessionKey created`);
      } catch (err) {
        logger.error(`[sessionKey.create] ❌ Failed: ${err.message}`);
        throw new Error(`[sessionKey.create] ${err.message}`);
      }

      // Step 3: Get message from sessionKey
      try {
        message = sessionKey.getPersonalMessage();
        logger.log(`[sessionKey.getPersonalMessage] 🎯 Got personal message`);
      } catch (err) {
        logger.error(`[sessionKey.getPersonalMessage] ❌ Failed: ${err.message}`);
        throw new Error(`[getPersonalMessage] ${err.message}`);
      }

      // Step 4: Sign the message
      try {
        signature = await suiOperations.signPersonalMessage(message);
        logger.log(`[signPersonalMessage] 🎯 Signature generated`);
        await sessionKey.setPersonalMessageSignature(signature.signature);
        logger.log(`[setPersonalMessageSignature] 🎯 Personal message signature set`);
      } catch (err) {
        logger.error(`[signPersonalMessage/setSignature] ❌ Failed: ${err.message}`);
        throw new Error(`[signPersonalMessage/setSignature] ${err.message}`);
      }

      // Step 5: Approve the seal
      try {
        txBytes = await suiOperations.sealApprove(
          fileObjectId,
          // onChainFileObjId,
          policyObjectId,
          // attestationObjId,
          // address
        );
        logger.log(`[sealApprove] 🎯 Seal approval received`);
      } catch (err) {
        logger.error(`[sealApprove] ❌ Failed: ${err.message}`);
        throw new Error(`[sealApprove] ${err.message}`);
      }

      // // Step 6: Fetch decryption keys
      // try {
      //   console.log(`[fetchKeys] 🔐 Fetching decryption keys...`);
      //   await this.sealClient.fetchKeys({
      //     ids: [fileObjectId],
      //     txBytes,
      //     sessionKey,
      //     threshold: 1, // Or use: Number(threshold) || 1 if a threshold variable is passed
      //   });
      //   console.log(`[fetchKeys] 🎯 Decryption keys fetched successfully`);
      // } catch (err) {
      //   console.error(`[fetchKeys] ❌ Failed to fetch decryption keys: ${err.message}`);
      //   throw new Error(`[fetchKeys] ${err.message}`);
      // }
      
      // Step 6: Decrypt the file
      try {
        logger.log(`[decrypt] 🔓 Decrypting file data...`);
        decryptedBytes = await this.sealClient.decrypt({
          data: new Uint8Array(encryptedFile),
          sessionKey,
          txBytes,
          checkShareConsistency: false,
          checkLEEncoding: true,
        });
        logger.log(`[decrypt] 🎯 File decrypted`);
      } catch (err) {
        logger.error(`[decrypt] ❌ File decryption failed: ${err.message}`);
        throw new Error(`[decrypt] ${err.message}`);
      }

      // Step 7: Decode and parse JSON
      try {
        const decoder = new TextDecoder("utf-8");
        jsonString = decoder.decode(decryptedBytes);
        logger.log(`[decode/parse] 🎯 File decoded, parsing JSON...`);
        return JSON.parse(jsonString);
      } catch (err) {
        logger.error(`[decode/parse] ❌ JSON decode/parse failed: ${err.message}`);
        throw new Error(`[decode/parse] ${err.message}`);
      }
    } catch (err) {
      // This will catch errors re-thrown from any inner step
      logger.error(`❌ decryptFile failed: ${err.message}`);
      throw new Error(`decryptFile failed: ${err.message}`);
    }
  }

  async encryptFile(refinedData, policyObjectId) {
    try {
      logger.log(`🔒 Encrypting processed data...`);
      
      const { fromHex } = require("@mysten/sui/utils");
      const policyObjectBytes = fromHex(policyObjectId);
      const nonce = crypto.getRandomValues(new Uint8Array(5));
      const id = toHex(new Uint8Array([...policyObjectBytes, ...nonce]));

      logger.log(`🔒 Generated encryption ID: ${id}`);
      
      const { encryptedObject: encryptedBytes } = await this.sealClient.encrypt({
        threshold: 1,
        packageId: this.movePackageId,
        id,
        data: new Uint8Array(new TextEncoder().encode(JSON.stringify(refinedData))),
      });

      logger.log(`✅ Data encrypted successfully`);
      return encryptedBytes;
    } catch (err) {
      logger.error(`❌ Failed to encrypt file: ${err.message}`);
      throw new Error(`encryptFile failed: ${err.message}`);
    }
  }



  async parseEncryptedObject(encryptedFile) {
    try {
      const encryptedData = new Uint8Array(encryptedFile);
      const encryptedObject = await EncryptedObject.parse(encryptedData);
      
      logger.log(`📦 Parsed encrypted object with ID: ${encryptedObject.id}`);
      return encryptedObject;
    } catch (err) {
      logger.error(`❌ Failed to parse encrypted object: ${err.message}`);
      throw new Error(`parseEncryptedObject failed:  ${JSON.stringify(err)}}`);
    }
  }

  async healthCheck() {
    try {
      // Test if seal client is properly initialized
      const keyServers = getAllowlistedKeyServers("mainnet") || [];
      
      return {
        status: 'healthy',
        movePackageId: this.movePackageId,
        keyServersCount: keyServers.length,
        keyServers: keyServers.slice(0, 2) // Only show first 2 for brevity
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        movePackageId: this.movePackageId
      };
    }
  }
}

module.exports = SealOperations;
