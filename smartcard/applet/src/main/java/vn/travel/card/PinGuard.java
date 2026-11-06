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
        tmp = JCSystem.makeTransientByteArray((short) 48, JCSystem.CLEAR_ON_DESELECT);
        sha = MessageDigest.getInstance(MessageDigest.ALG_SHA_256, false);
        ecb = Cipher.getInstance(Cipher.ALG_AES_BLOCK_128_ECB_NOPAD, false);
        rnd = RandomData.getInstance(RandomData.ALG_SECURE_RANDOM);
    }

    /** buf[pinOff..+6] = PIN digits, buf[escrowOff..+16] = escrow key. */
    void init(byte[] buf, short pinOff, short escrowOff) {
        // DEK -> tmp[0..15]
        rnd.generateData(tmp, (short) 0, (short) 16);
        rnd.generateData(salt, (short) 0, (short) 16);
        // wrap with PIN-derived KEK
        deriveKek(buf, pinOff);
        wrap(kekKey, encDekPin);
        // wrap with escrow key
        escrowKey.setKey(buf, escrowOff);
        wrap(escrowKey, encDekEscrow);
        Util.arrayFillNonAtomic(tmp, (short) 0, (short) 48, (byte) 0);
        pin.update(buf, pinOff, CardConst.PIN_LEN);
        mustChange[0] = 1;
    }

    private void deriveKek(byte[] buf, short pinOff) {
        sha.reset();
        sha.update(salt, (short) 0, (short) 16);
        sha.doFinal(buf, pinOff, CardConst.PIN_LEN, tmp, (short) 16);
        kekKey.setKey(tmp, (short) 16);
    }

    /** Encrypts tmp[0..15] (the DEK) under key into dest. */
    private void wrap(AESKey key, byte[] dest) {
        ecb.init(key, Cipher.MODE_ENCRYPT);
        ecb.doFinal(tmp, (short) 0, (short) 16, dest, (short) 0);
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
        deriveKek(buf, off);
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
        Util.arrayFillNonAtomic(tmp, (short) 0, (short) 48, (byte) 0);
    }

    /** CHANGE_PIN: re-wraps the DEK under a KEK from the new PIN and a fresh salt. */
    void change(byte[] buf, short oldOff, short newOff) {
        checkPin(buf, oldOff);
        unwrapDek(buf, oldOff);
        dekKey.clearKey();
        JCSystem.beginTransaction();
        rnd.generateData(salt, (short) 0, (short) 16);
        deriveKek(buf, newOff);
        wrap(kekKey, encDekPin);
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
        Util.arrayFillNonAtomic(tmp, (short) 0, (short) 48, (byte) 0);
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

    void wipe() {
        clearSession();
        escrowKey.clearKey();
        Util.arrayFillNonAtomic(salt, (short) 0, (short) 16, (byte) 0);
        Util.arrayFillNonAtomic(encDekPin, (short) 0, (short) 16, (byte) 0);
        Util.arrayFillNonAtomic(encDekEscrow, (short) 0, (short) 16, (byte) 0);
        // PIN becomes 000000 and the flag is cleared; the card state (TERMINATED) gates everything.
        pin.update(tmp, (short) 0, CardConst.PIN_LEN);
        pin.resetAndUnblock();
        mustChange[0] = 0;
    }
}
