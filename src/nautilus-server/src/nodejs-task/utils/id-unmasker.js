const crypto = require('crypto');

/**
 * Utility for unmasking IDs that were masked using AES-256-CBC with deterministic IV.
 * This matches the NestJS IdMaskerService implementation.
 */
class IdUnmasker {
  constructor() {
    // Get mask salt from environment variable (must match the backend server)
    // The salt is used to derive the encryption key
    this.maskSalt = process.env.ID_MASK_SALT || 'default-mask-salt-change-in-production';
    
    // Derive encryption key from salt (32 bytes for AES-256)
    const keyHash = crypto.createHash('sha256').update(this.maskSalt).digest();
    this.encryptionKey = keyHash;
    this.algorithm = 'aes-256-cbc';
  }

  /**
   * Unmask a reversibly masked ID.
   * Expects format from reversiblyMaskIdWithIv: base64(iv(16 bytes) + encrypted)
   *
   * @param {string} maskedId - The masked ID (base64-encoded with IV prepended)
   * @returns {string} Original ID string, or empty string if unmasking fails
   */
  unmaskId(maskedId) {
    if (!maskedId || maskedId.trim() === '') {
      return '';
    }

    try {
      const buffer = Buffer.from(maskedId, 'base64');

      // Extract IV (first 16 bytes) and encrypted data (rest)
      if (buffer.length < 16) {
        return ''; // Invalid format
      }

      const iv = buffer.subarray(0, 16);
      const encrypted = buffer.subarray(16);

      // Decrypt using AES-256-CBC
      const decipher = crypto.createDecipheriv(this.algorithm, this.encryptionKey, iv);
      let decrypted = decipher.update(encrypted, undefined, 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      // If unmasking fails, return empty string
      console.warn(`Failed to unmask ID: ${error.message}`);
      return '';
    }
  }

  /**
   * Unmask a user ID from Walrus metadata
   * @param {string} maskedUserId - The masked user ID
   * @returns {string} Original user ID
   */
  unmaskUserId(maskedUserId) {
    return this.unmaskId(maskedUserId);
  }

  /**
   * Unmask a chat ID from Walrus metadata
   * @param {string} maskedChatId - The masked chat ID
   * @returns {string} Original chat ID
   */
  unmaskChatId(maskedChatId) {
    return this.unmaskId(maskedChatId);
  }

  /**
   * Unmask a submission ID from Walrus metadata
   * @param {string} maskedSubmissionId - The masked submission ID
   * @returns {string} Original submission ID
   */
  unmaskSubmissionId(maskedSubmissionId) {
    return this.unmaskId(maskedSubmissionId);
  }

  /**
   * Parse and unmask a JSON-encoded masked ID (removes quotes)
   * Tags in Walrus response are JSON-encoded strings like "\"maskedId\""
   * @param {string} jsonEncodedMaskedId - JSON-encoded masked ID
   * @returns {string} Original ID
   */
  unmaskJsonEncodedId(jsonEncodedMaskedId) {
    if (!jsonEncodedMaskedId || jsonEncodedMaskedId.trim() === '') {
      return '';
    }

    try {
      // Parse JSON string to remove quotes (e.g., "\"maskedId\"" -> "maskedId")
      const maskedId = JSON.parse(jsonEncodedMaskedId);
      return this.unmaskId(maskedId);
    } catch (error) {
      // If JSON parsing fails, try unmasking directly
      return this.unmaskId(jsonEncodedMaskedId);
    }
  }

  /**
   * Unmask all IDs from a patch's tags
   * @param {object} patch - Patch object with tags
   * @returns {object} Object with unmasked userId, chatId, and submissionId
   */
  unmaskPatchTags(patch) {
    if (!patch || !patch.tags) {
      return {
        userId: '',
        chatId: '',
        submissionId: ''
      };
    }

    return {
      userId: this.unmaskJsonEncodedId(patch.tags.userId || ''),
      chatId: this.unmaskJsonEncodedId(patch.tags.chatId || ''),
      submissionId: this.unmaskJsonEncodedId(patch.tags.submissionId || '')
    };
  }
}

module.exports = IdUnmasker;

