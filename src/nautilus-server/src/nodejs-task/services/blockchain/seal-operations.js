const {
  SealClient,
  SessionKey,
  EncryptedObject,
  getAllowlistedKeyServers,
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

    const keyServers = getAllowlistedKeyServers("testnet") || [];
    this.sealClient = new SealClient({
      suiClient: this.suiClient,
      serverObjectIds: keyServers.map((id) => [id, 1]),
      verifyKeyServers: false,
    });
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
        threshold: Number(threshold),
      });

      console.log(`🔓 Decrypting file data...`);
      const decryptedBytes = await this.sealClient.decrypt({
        data: new Uint8Array(encryptedFile),
        sessionKey,
        txBytes,
      });
      
      // const decoder = new TextDecoder("utf-8");
      // const jsonString = decoder.decode(decryptedBytes);
      
      const rawData = decryptAES256GCM(decryptedBytes);
      
      console.log(`✅ File decrypted successfully`);
      return JSON.parse(rawData);
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
        threshold: 2,
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

  parseEncryptedObject(encryptedFile) {
    try {
      const encryptedData = new Uint8Array(encryptedFile);
      const encryptedObject = EncryptedObject.parse(encryptedData);
      
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
  
  decryptAES256GCM(encryptedPackage) {
    try {
      console.log(`🔓 Decrypting AES-256-GCM encrypted data`);
      
      // Get encryption key from environment
      const encryptionKey = process.env.INTERNAL_ENCRYPTION_SECRET_KEY;
      if (!encryptionKey) {
        throw new Error('INTERNAL_ENCRYPTION_SECRET_KEY environment variable is not set');
      }
      
      // Decode base64 components
      const keyBuffer = Buffer.from(encryptionKey, 'base64');
      const nonceBuffer = Buffer.from(encryptedPackage.nonce, 'base64');
      const ciphertextBuffer = Buffer.from(encryptedPackage.ciphertext, 'base64');
      const tagBuffer = Buffer.from(encryptedPackage.tag, 'base64');
      
      // Validate key length (must be 32 bytes for AES-256)
      if (keyBuffer.length !== 32) {
        throw new Error('Invalid key length. Must be 32 bytes.');
      }
      
      // Validate nonce length (must be 12 bytes for GCM)
      if (nonceBuffer.length !== 12) {
        throw new Error('Invalid nonce length. Must be 12 bytes.');
      }
      
      // Create decipher
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        keyBuffer,
        nonceBuffer
      );
      
      // Set authentication tag
      decipher.setAuthTag(tagBuffer);
      
      // Decrypt data
      let decrypted = decipher.update(ciphertextBuffer);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      
      console.log(`✅ AES-256-GCM decryption successful`);
      return decrypted.toString('utf8');
    } catch (error) {
      console.error(`❌ AES-256-GCM decryption failed: ${error.message}`);
      throw new Error(`AES-256-GCM decryption failed: ${error.message}`);
    }
  }
}

module.exports = SealOperations;