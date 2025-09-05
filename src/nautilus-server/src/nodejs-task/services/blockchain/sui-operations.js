const { SuiClient, getFullnodeUrl } = require("@mysten/sui/client");
const { Ed25519Keypair } = require("@mysten/sui/keypairs/ed25519");
const { Transaction } = require("@mysten/sui/transactions");
const { fromHex } = require("@mysten/sui/utils");
const bech32 = require("bech32");

class SuiOperations {
  constructor(options = {}) {
    this.options = options;
    this.suiClient = new SuiClient({ url: getFullnodeUrl("testnet") });
    this.keypair = null;
    this.movePackageId = process.env.MOVE_PACKAGE_ID;
    
    if (!this.movePackageId) {
      throw new Error('MOVE_PACKAGE_ID environment variable is required');
    }
  }

  async initialize() {
    if (this.keypair) {
      return; // Already initialized
    }

    const suiSecretKey = process.env.SUI_SECRET_KEY;
    if (!suiSecretKey) {
      throw new Error('SUI_SECRET_KEY environment variable is required');
    }

    try {
      const decoded = bech32.bech32.decode(suiSecretKey);
      if (!decoded) throw new Error("Invalid bech32 private key format");
      const privateKeyBytes = bech32.bech32.fromWords(decoded.words);
      const rawSecretKey = Buffer.from(privateKeyBytes).subarray(1);
      this.keypair = Ed25519Keypair.fromSecretKey(rawSecretKey);
      
      console.log("✅ Sui keypair initialized successfully");
    } catch (err) {
      console.error("❌ Failed to initialize Sui keypair:", err.message);
      throw err;
    }
  }

  async registerAttestation(fileObjectId, enclaveId) {
    if (!this.keypair) {
      await this.initialize();
    }

    try {
      console.log(`🔗 Registering TEE attestation for file: ${fileObjectId}`);
      
      const tx = new Transaction();
      tx.setGasBudget(10_000_000);
      tx.setSender(this.keypair.getPublicKey().toSuiAddress());
      tx.moveCall({
        target: `${this.movePackageId}::seal_manager::register_tee_attestation`,
        arguments: [
          tx.pure.vector("u8", new TextEncoder().encode(enclaveId)),
          tx.pure.vector("u8", fromHex(fileObjectId)),
          tx.pure.address(this.getKeypairAddress()),
        ],
      });

      const result = await this.suiClient.signAndExecuteTransaction({
        transaction: tx,
        signer: this.keypair,
        requestType: "WaitForLocalExecution",
        options: { showEffects: true },
      });

      const attestationObjId = result?.effects?.created[0]?.reference?.objectId;
      if (!attestationObjId) {
        throw new Error("No attestation object created");
      }
      
      console.log(`✅ Attestation object created: ${attestationObjId}`);
      return attestationObjId;
    } catch (err) {
      console.error(`❌ Failed to register attestation: ${err.message}`);
      throw new Error(`registerAttestation failed: ${JSON.stringify(err)}`);
    }
  }

  async saveEncryptedFileOnChain(encryptedRefinedData, metadata, policyObjId) {
    if (!this.keypair) {
      await this.initialize();
    }

    try {
      console.log(`💾 Saving encrypted file on-chain...`);
      
      const { EncryptedObject } = require("@mysten/seal");
      const encryptedData = new Uint8Array(encryptedRefinedData);
      const encryptedObject = EncryptedObject.parse(encryptedData);

      const tx = new Transaction();
      tx.setGasBudget(10_000_000);
      const metadataBytes = new Uint8Array(
        new TextEncoder().encode(JSON.stringify(metadata))
      );
      
      tx.moveCall({
        target: `${this.movePackageId}::seal_manager::save_encrypted_file`,
        arguments: [
          tx.pure.vector("u8", fromHex(encryptedObject.id)),
          tx.object(policyObjId),
          tx.pure.vector("u8", metadataBytes),
        ],
      });

      const result = await this.suiClient.signAndExecuteTransaction({
        transaction: tx,
        signer: this.keypair,
        requestType: "WaitForLocalExecution",
        options: { showEffects: true },
      });

      const objId = result?.effects?.created[0]?.reference?.objectId;
      if (!objId) {
        throw new Error("No on-chain file object created");
      }
      
      console.log(`✅ On-chain file object created: ${objId}`);
      return objId;
    } catch (err) {
      console.error(`❌ Failed to save encrypted file on-chain: ${err.message}`);
      throw new Error(`saveEncryptedFileOnChain failed: ${err.message}`);
    }
  }

  async sealApprove(
    fileObjectId,
    // onChainFileObjId,
    policyObjectId,
    // attestationObjId
  )
   {
    if (!this.keypair) {
      await this.initialize();
    }

    try {
      console.log(`🔐 Creating seal approval transaction...`);
      
      const tx = new Transaction();
      tx.setGasBudget(10_000_000);
      tx.setSender(this.keypair.getPublicKey().toSuiAddress());
      tx.moveCall({
        target: `${this.movePackageId}::seal_manager::seal_approve`,
        arguments: [
          tx.pure.vector("u8", fromHex(fileObjectId)),
          // tx.object(onChainFileObjId),
          tx.object(policyObjectId),
          // tx.object(attestationObjId),
          // tx.pure.address(this.getKeypairAddress()),
        ],
      });

      const txBytes = await tx.build({
        client: this.suiClient,
        onlyTransactionKind: true,
      });

      console.log(`✅ Seal approval transaction built`);
      return txBytes;
    } catch (err) {
      console.error(`❌ Failed to create seal approval: ${err.message}`);
      throw new Error(`sealApprove failed: ${err.message}`);
    }
  }

  getKeypairAddress() {
    if (!this.keypair) {
      throw new Error("Keypair not initialized");
    }
    return this.keypair.getPublicKey().toSuiAddress();
  }

  async signPersonalMessage(message) {
    if (!this.keypair) {
      await this.initialize();
    }

    return await this.keypair.signPersonalMessage(Buffer.from(message));
  }
}

module.exports = SuiOperations;