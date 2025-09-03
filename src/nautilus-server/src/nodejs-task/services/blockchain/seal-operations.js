const {
  SealClient,
  SessionKey,
  EncryptedObject,
} = require("@mysten/seal");
const { toHex } = require("@mysten/sui/utils");
const crypto = require("crypto");

class SealOperations {
  constructor(suiClient, options = {}) {
    this.suiClient = suiClient;
    this.options = options;
    this.movePackageId = process.env.MOVE_PACKAGE_ID;
    
    if (!this.movePackageId) {
      throw new Error('MOVE_PACKAGE_ID environment variable is required');
    }

    const keyServers = ['0x6068c0acb197dddbacd4746a9de7f025b2ed5a5b6c1b1ab44dade4426d141da2'];
    this.sealClient = new SealClient({
      suiClient: this.suiClient,
      serverConfigs: keyServers.map((id) => ({
        objectId: id,
        weight: 1,
      })),
      verifyKeyServers: false,
    });
    // this.sealClient = new SealClient({
    //   suiClient: this.suiClient,
    //   serverObjectIds: keyServers.map((id) => [id, 1]),
    //   verifyKeyServers: false,
    // });
  }

  async decryptFile(fileObjectId, attestationObjId, encryptedFile, onChainFileObjId, policyObjectId, threshold, suiOperations) {
    try {
      console.log(`🔓 Decrypting file: ${fileObjectId}`);
      const address = suiOperations.getKeypairAddress();

      const sessionKey = new SessionKey({
        address,
        packageId: this.movePackageId,
        ttlMin: 10,
        client: this.suiClient,
      });

      const message = sessionKey.getPersonalMessage();
      console.log(`🔑 Personal message: ${message}`);
      
      const signature = await suiOperations.signPersonalMessage(message);
      console.log(`✍️  Signature generated`);
      
      await sessionKey.setPersonalMessageSignature(signature.signature);

      const txBytes = await suiOperations.sealApprove(
        fileObjectId,
        onChainFileObjId,
        policyObjectId,
        attestationObjId,
        address
      );

      console.log(`🔐 Fetching decryption keys...`);
      await this.sealClient.fetchKeys({
        ids: [fileObjectId],
        txBytes,
        sessionKey,
        // threshold: Number(threshold) || 1,
        threshold: 1,
      });

      console.log(`🔓 Decrypting file data...`);
      const decryptedBytes = await this.sealClient.decrypt({
        data: new Uint8Array(encryptedFile),
        sessionKey,
        txBytes,
      });

      const decoder = new TextDecoder("utf-8");
      const jsonString = decoder.decode(decryptedBytes);
      
      console.log(`✅ File decrypted successfully`);
      return JSON.parse(jsonString);
    } catch (err) {
      console.error(`❌ Failed to decrypt file: ${err.message}`);
      throw new Error(`decryptFile failed: ${err.message}`);
    }
  }

  async encryptFile(refinedData, policyObjectId) {
    try {
      console.log(`🔒 Encrypting processed data...`);
      
      const { fromHex } = require("@mysten/sui/utils");
      const policyObjectBytes = fromHex(policyObjectId);
      const nonce = crypto.getRandomValues(new Uint8Array(5));
      const id = toHex(new Uint8Array([...policyObjectBytes, ...nonce]));

      console.log(`🔒 Generated encryption ID: ${id}`);
      
      const { encryptedObject: encryptedBytes } = await this.sealClient.encrypt({
        threshold: 1,
        packageId: this.movePackageId,
        id,
        data: new Uint8Array(new TextEncoder().encode(JSON.stringify(refinedData))),
      });

      console.log(`✅ Data encrypted successfully`);
      return encryptedBytes;
    } catch (err) {
      console.error(`❌ Failed to encrypt file: ${err.message}`);
      throw new Error(`encryptFile failed: ${err.message}`);
    }
  }



  async parseEncryptedObject(encryptedFile) {
    try {
      const encryptedData = new Uint8Array(encryptedFile);
      const encryptedObject = await EncryptedObject.parse(encryptedData);
      
      console.log(`📦 Parsed encrypted object with ID: ${encryptedObject.id}`);
      return encryptedObject;
    } catch (err) {
      console.error(`❌ Failed to parse encrypted object: ${err.message}`);
      throw new Error(`parseEncryptedObject failed: ${err.message}`);
    }
  }

  async healthCheck() {
    try {
      // Test if seal client is properly initialized
      const keyServers = getAllowlistedKeyServers("testnet") || [];
      
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