package vn.travel.card;

import javacard.framework.ISOException;
import javacard.framework.JCSystem;
import javacard.framework.OwnerPIN;
import javacard.framework.Util;
import javacard.security.AESKey;
import javacard.security.KeyBuilder;
import javacard.security.MessageDigest;
import javacard.security.RandomData;
import javacardx.crypto.Cipher;

/** PIN, DEK wrapping (PIN-derived KEK and escrow key) and session DEK. */
final class PinGuard {
    /** tmp: [0..15] DEK, [16..47] SHA-256 output, [48..63] new salt, [64..79] new encDekPin, [80..95] new encDekEscrow. */
    private static final short TMP_LEN = 96;
    private static final short NEW_SALT = 48;
    private static final short NEW_ENC_PIN = 64;
    private static final short NEW_ENC_ESC = 80;

    private final OwnerPIN pin;
    private final byte[] salt;
    private final byte[] encDekPin;
    private final byte[] encDekEscrow;
    private final byte[] mustChange;
    private final AESKey escrowKey;
    private final AESKey dekKey;
    private final AESKey kekKey;
    private final byte[] tmp;
    private final MessageDigest sha;
    private final Cipher ecb;
    private final RandomData rnd;

    PinGuard() {
        pin = new OwnerPIN(CardConst.PIN_TRIES, CardConst.PIN_LEN);
        salt = new byte[16];
        encDekPin = new byte[16];
        encDekEscrow = new byte[16];
        mustChange = new byte[1];
        escrowKey = (AESKey) KeyBuilder.buildKey(KeyBuilder.TYPE_AES, KeyBuilder.LENGTH_AES_128, false);
        dekKey = (AESKey) KeyBuilder.buildKey(
                KeyBuilder.TYPE_AES_TRANSIENT_DESELECT, KeyBuilder.LENGTH_AES_128, false);
        kekKey = (AESKey) KeyBuilder.buildKey(
                KeyBuilder.TYPE_AES_TRANSIENT_DESELECT, KeyBuilder.LENGTH_AES_128, false);
        tmp = JCSystem.makeTransientByteArray(TMP_LEN, JCSystem.CLEAR_ON_DESELECT);
        sha = MessageDigest.getInstance(MessageDigest.ALG_SHA_256, false);
        ecb = Cipher.getInstance(Cipher.ALG_AES_BLOCK_128_ECB_NOPAD, false);
        rnd = RandomData.getInstance(RandomData.ALG_SECURE_RANDOM);
    }

    /**
     * buf[pinOff..+6] = PIN digits, buf[escrowOff..+16] = escrow key. All crypto output goes to the
     * transient tmp first; the persistent fields are only written by Util.arrayCopy (journaled).
     */
    void init(byte[] buf, short pinOff, short escrowOff) {
        // DEK -> tmp[0..15]
        rnd.generateData(tmp, (short) 0, (short) 16);
        rnd.generateData(tmp, NEW_SALT, (short) 16);
        deriveKek(tmp, NEW_SALT, buf, pinOff);
        wrap(kekKey, NEW_ENC_PIN);
        escrowKey.setKey(buf, escrowOff);
        wrap(escrowKey, NEW_ENC_ESC);
        Util.arrayCopy(tmp, NEW_SALT, salt, (short) 0, (short) 16);
        Util.arrayCopy(tmp, NEW_ENC_PIN, encDekPin, (short) 0, (short) 16);
        Util.arrayCopy(tmp, NEW_ENC_ESC, encDekEscrow, (short) 0, (short) 16);
        Util.arrayFillNonAtomic(tmp, (short) 0, TMP_LEN, (byte) 0);
        pin.update(buf, pinOff, CardConst.PIN_LEN);
        mustChange[0] = 1;
    }

    /** KEK = SHA-256(salt16 || pin6)[0..15] -> kekKey (hash lands in tmp[16..47]). */
    private void deriveKek(byte[] saltBuf, short saltOff, byte[] buf, short pinOff) {
        sha.reset();
        sha.update(saltBuf, saltOff, (short) 16);
        sha.doFinal(buf, pinOff, CardConst.PIN_LEN, tmp, (short) 16);
        kekKey.setKey(tmp, (short) 16);
    }

    /** Encrypts tmp[0..15] (the DEK) under key into tmp[destOff..+16]. */
    private void wrap(AESKey key, short destOff) {
        ecb.init(key, Cipher.MODE_ENCRYPT);
        ecb.doFinal(tmp, (short) 0, (short) 16, tmp, destOff);
    }

    /** Throws 63Cx / 6983 unless the PIN at buf[off..+6] is correct. */
    private void checkPin(byte[] buf, short off) {
        if (pin.getTriesRemaining() == 0) {
            clearSession();
            ISOException.throwIt(CardConst.SW_PIN_BLOCKED);
        }
        if (!pin.check(buf, off, CardConst.PIN_LEN)) {
            clearSession();
            ISOException.throwIt((short) (CardConst.SW_PIN_FAILED_BASE | pin.getTriesRemaining()));
        }
    }

    /** Unwraps encDekPin with the KEK from the PIN at buf[off..+6] into tmp[0..15]. */
    private void unwrapDek(byte[] buf, short off) {
        deriveKek(salt, (short) 0, buf, off);
        ecb.init(kekKey, Cipher.MODE_DECRYPT);
        ecb.doFinal(encDekPin, (short) 0, (short) 16, tmp, (short) 0);
        kekKey.clearKey();
        Util.arrayFillNonAtomic(tmp, (short) 16, (short) 32, (byte) 0);
    }

    /** VERIFY_PIN: on success the DEK is opened into the transient key. */
    void verify(byte[] buf, short off) {
        checkPin(buf, off);
        unwrapDek(buf, off);
        dekKey.setKey(tmp, (short) 0);
        Util.arrayFillNonAtomic(tmp, (short) 0, TMP_LEN, (byte) 0);
    }

    /** CHANGE_PIN: re-wraps the DEK under a KEK from the new PIN and a fresh salt. */
    void change(byte[] buf, short oldOff, short newOff) {
        checkPin(buf, oldOff);
        unwrapDek(buf, oldOff);
        dekKey.clearKey();
        rnd.generateData(tmp, NEW_SALT, (short) 16);
        deriveKek(tmp, NEW_SALT, buf, newOff);
        wrap(kekKey, NEW_ENC_PIN);
        JCSystem.beginTransaction();
        Util.arrayCopy(tmp, NEW_SALT, salt, (short) 0, (short) 16);
        Util.arrayCopy(tmp, NEW_ENC_PIN, encDekPin, (short) 0, (short) 16);
        pin.update(buf, newOff, CardConst.PIN_LEN);
        mustChange[0] = 0;
        JCSystem.commitTransaction();
        clearSession();
    }

    boolean isValidated() {
        return pin.isValidated();
    }

    /** Only valid once the PIN has been validated in this session. */
    AESKey dek() {
        return dekKey;
    }

    void clearSession() {
        dekKey.clearKey();
        kekKey.clearKey();
        Util.arrayFillNonAtomic(tmp, (short) 0, TMP_LEN, (byte) 0);
        pin.reset();
    }

    byte triesRemaining() {
        return pin.getTriesRemaining();
    }

    boolean mustChangePin() {
        return mustChange[0] != 0;
    }

    OwnerPIN pin() {
        return pin;
    }

    /**
     * RESET_PIN: buf[encPinOff..+16] = AES-128-ECB(kEscrow, newPin6 || 0x00*10). The DEK is
     * re-wrapped under a KEK from the new PIN, the PIN is replaced and unblocked, mustChange = 1.
     * The 16 bytes at encPinOff are overwritten (plaintext PIN is wiped before returning).
     */
    void resetWithEscrow(byte[] buf, short encPinOff) {
        ecb.init(escrowKey, Cipher.MODE_DECRYPT);
        ecb.doFinal(buf, encPinOff, (short) 16, buf, encPinOff);
        boolean digits = true;
        for (short i = 0; i < CardConst.PIN_LEN; i++) {
            byte d = buf[(short) (encPinOff + i)];
            if (d < 0x30 || d > 0x39) {
                digits = false;
            }
        }
        if (!digits) {
            Util.arrayFillNonAtomic(buf, encPinOff, (short) 16, (byte) 0);
            ISOException.throwIt(CardConst.SW_BAD_DATA);
        }
        // DEK -> tmp[0..15]
        ecb.init(escrowKey, Cipher.MODE_DECRYPT);
        ecb.doFinal(encDekEscrow, (short) 0, (short) 16, tmp, (short) 0);
        rnd.generateData(tmp, NEW_SALT, (short) 16);
        deriveKek(tmp, NEW_SALT, buf, encPinOff);
        wrap(kekKey, NEW_ENC_PIN);
        JCSystem.beginTransaction();
        Util.arrayCopy(tmp, NEW_SALT, salt, (short) 0, (short) 16);
        Util.arrayCopy(tmp, NEW_ENC_PIN, encDekPin, (short) 0, (short) 16);
        pin.update(buf, encPinOff, CardConst.PIN_LEN);
        pin.resetAndUnblock();
        mustChange[0] = 1;
        JCSystem.commitTransaction();
        Util.arrayFillNonAtomic(buf, encPinOff, (short) 16, (byte) 0);
        clearSession();
    }

    /** TERMINATE: destroys all key material (idempotent, runs outside any transaction; re-run until the wipe flag clears) and leaves the PIN random and blocked (never a known PIN). */
    void wipe() {
        clearSession();
        escrowKey.clearKey();
        Util.arrayFillNonAtomic(salt, (short) 0, (short) 16, (byte) 0);
        Util.arrayFillNonAtomic(encDekPin, (short) 0, (short) 16, (byte) 0);
        Util.arrayFillNonAtomic(encDekEscrow, (short) 0, (short) 16, (byte) 0);
        // Random PIN with the high bit set on every byte (not a digit string, so no APDU can match it).
        rnd.generateData(tmp, (short) 0, CardConst.PIN_LEN);
        for (short i = 0; i < CardConst.PIN_LEN; i++) {
            tmp[i] = (byte) (tmp[i] | 0x80);
        }
        pin.update(tmp, (short) 0, CardConst.PIN_LEN);
        Util.arrayFillNonAtomic(tmp, (short) 0, CardConst.PIN_LEN, (byte) 0);
        // Exhaust the try counter: an all-zero guess never matches the random PIN above.
        for (short i = 0; i < CardConst.PIN_TRIES; i++) {
            pin.check(tmp, (short) 0, CardConst.PIN_LEN);
        }
        pin.reset();
        mustChange[0] = 1;
    }
}
