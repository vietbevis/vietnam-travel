package vn.travel.card;

import javacard.framework.ISOException;
import javacard.framework.JCSystem;
import javacard.framework.Util;
import javacard.security.AESKey;
import javacard.security.MessageDigest;
import javacard.security.RandomData;
import javacardx.crypto.Cipher;

/**
 * Encrypted chunked storage for the profile and photo targets (spec 3.2, 3.3 INS 40..43).
 * Data is AES-128-CBC encrypted with the session DEK; chunk i uses IV with last byte IV[15] ^ i.
 * A target is empty (length 0) from BEGIN_WRITE until a valid COMMIT_WRITE.
 */
final class SecureStore {
    private static final short S_TARGET = 0;
    private static final short S_NEXT = 1;
    private static final short S_DECL = 2;
    private static final short S_WRITTEN = 4;
    private static final short S_SIZE = 6;

    private final byte[] profile;
    private final byte[] photo;
    /** Persistent: IV of profile at [0..15], photo at [16..31]. */
    private final byte[] iv;
    /** Persistent: committed length of profile at [0..1], photo at [2..3]. */
    private final byte[] lens;
    /** Write session (CLEAR_ON_DESELECT): target, nextIndex, declaredLen2, written2. */
    private final byte[] sess;
    private final byte[] chunkBuf;
    private final byte[] ivTmp;
    private final byte[] hash;
    private final MessageDigest digest;
    private final Cipher cipher;
    private final RandomData rnd;

    SecureStore() {
        profile = new byte[CardConst.PROFILE_MAX];
        photo = new byte[CardConst.PHOTO_MAX];
        iv = new byte[32];
        lens = new byte[4];
        sess = JCSystem.makeTransientByteArray(S_SIZE, JCSystem.CLEAR_ON_DESELECT);
        chunkBuf = JCSystem.makeTransientByteArray(CardConst.CHUNK, JCSystem.CLEAR_ON_DESELECT);
        ivTmp = JCSystem.makeTransientByteArray((short) 16, JCSystem.CLEAR_ON_DESELECT);
        hash = JCSystem.makeTransientByteArray((short) 32, JCSystem.CLEAR_ON_DESELECT);
        digest = MessageDigest.getInstance(MessageDigest.ALG_SHA_256, false);
        cipher = Cipher.getInstance(Cipher.ALG_AES_BLOCK_128_CBC_NOPAD, false);
        rnd = RandomData.getInstance(RandomData.ALG_SECURE_RANDOM);
    }

    /** Throws 6A86 unless target is 01 (profile) or 02 (photo). */
    static void checkTarget(byte target) {
        if (target != CardConst.TARGET_PROFILE && target != CardConst.TARGET_PHOTO) {
            ISOException.throwIt(CardConst.SW_BAD_P1P2);
        }
    }

    private byte[] store(byte target) {
        return target == CardConst.TARGET_PROFILE ? profile : photo;
    }

    private static short ivOff(byte target) {
        return target == CardConst.TARGET_PROFILE ? (short) 0 : (short) 16;
    }

    private static short lenOff(byte target) {
        return target == CardConst.TARGET_PROFILE ? (short) 0 : (short) 2;
    }

    /** Committed length of the target (0 = empty). */
    short length(byte target) {
        checkTarget(target);
        return Util.getShort(lens, lenOff(target));
    }

    /** BEGIN_WRITE: empties the target, draws a fresh IV and opens a write session. */
    void begin(byte target, short totalLen) {
        checkTarget(target);
        short max = target == CardConst.TARGET_PROFILE ? CardConst.PROFILE_MAX : CardConst.PHOTO_MAX;
        if (totalLen < 0 || totalLen > max) {
            ISOException.throwIt(CardConst.SW_NO_SPACE);
        }
        if (totalLen == 0) {
            ISOException.throwIt(CardConst.SW_BAD_DATA);
        }
        endSession();
        rnd.generateData(ivTmp, (short) 0, (short) 16);
        JCSystem.beginTransaction();
        Util.setShort(lens, lenOff(target), (short) 0);
        Util.arrayCopy(ivTmp, (short) 0, iv, ivOff(target), (short) 16);
        JCSystem.commitTransaction();
        sess[S_TARGET] = target;
        sess[S_NEXT] = 0;
        Util.setShort(sess, S_DECL, totalLen);
        Util.setShort(sess, S_WRITTEN, (short) 0);
    }

    /** WRITE_CHUNK: encrypts buf[off..off+len] as chunk index. Non-last chunks must be CHUNK bytes. */
    void writeChunk(byte target, byte index, byte[] buf, short off, short len, AESKey dek) {
        checkTarget(target);
        if (sess[S_TARGET] != target) {
            ISOException.throwIt(CardConst.SW_BAD_STATE);
        }
        short decl = Util.getShort(sess, S_DECL);
        short written = Util.getShort(sess, S_WRITTEN);
        if (index != sess[S_NEXT] || written >= decl) {
            ISOException.throwIt(CardConst.SW_BAD_P1P2);
        }
        short rem = (short) (decl - written);
        short expected = rem > CardConst.CHUNK ? CardConst.CHUNK : rem;
        if (len != expected) {
            ISOException.throwIt(CardConst.SW_WRONG_LENGTH);
        }
        short padded = (short) ((len + 15) & 0xFFF0);
        Util.arrayCopyNonAtomic(buf, off, chunkBuf, (short) 0, len);
        if (padded > len) {
            Util.arrayFillNonAtomic(chunkBuf, len, (short) (padded - len), (byte) 0);
        }
        Util.arrayCopyNonAtomic(iv, ivOff(target), ivTmp, (short) 0, (short) 16);
        ivTmp[15] = (byte) (ivTmp[15] ^ index);
        try {
            cipher.init(dek, Cipher.MODE_ENCRYPT, ivTmp, (short) 0, (short) 16);
            cipher.doFinal(chunkBuf, (short) 0, padded, store(target), (short) (index * CardConst.CHUNK));
        } finally {
            Util.arrayFillNonAtomic(chunkBuf, (short) 0, CardConst.CHUNK, (byte) 0);
        }
        digest.update(buf, off, len);
        sess[S_NEXT] = (byte) (index + 1);
        Util.setShort(sess, S_WRITTEN, (short) (written + len));
    }

    /**
     * COMMIT_WRITE (signature already verified): buf[hashOff..+32] is the SHA-256 of the plaintext,
     * len the claimed length. Succeeds only if every chunk was written and the hash matches.
     * The write session always ends; on failure the target stays empty. Throws 6A80 on mismatch.
     */
    void commit(byte target, byte[] buf, short hashOff, short len) {
        checkTarget(target);
        if (sess[S_TARGET] != target) {
            ISOException.throwIt(CardConst.SW_BAD_STATE);
        }
        short decl = Util.getShort(sess, S_DECL);
        boolean ok = Util.getShort(sess, S_WRITTEN) == decl && decl == len
                && sess[S_NEXT] == (byte) ((len + CardConst.CHUNK - 1) / CardConst.CHUNK);
        digest.doFinal(hash, (short) 0, (short) 0, hash, (short) 0);
        ok = ok && Util.arrayCompare(hash, (short) 0, buf, hashOff, (short) 32) == 0;
        endSession();
        Util.arrayFillNonAtomic(hash, (short) 0, (short) 32, (byte) 0);
        if (!ok) {
            ISOException.throwIt(CardConst.SW_BAD_DATA);
        }
        JCSystem.beginTransaction();
        Util.setShort(lens, lenOff(target), len);
        JCSystem.commitTransaction();
    }

    /**
     * READ_DATA chunk: decrypts chunk index into out[off..], returns the plaintext length
     * (last chunk trimmed to the committed length). 6A88 if empty, 6A86 if out of range.
     */
    short readChunk(byte target, byte index, AESKey dek, byte[] out, short off) {
        checkTarget(target);
        short len = Util.getShort(lens, lenOff(target));
        if (len == 0) {
            ISOException.throwIt(CardConst.SW_NOT_FOUND);
        }
        short chunks = (short) ((len + CardConst.CHUNK - 1) / CardConst.CHUNK);
        if (index < 0 || index >= chunks) {
            ISOException.throwIt(CardConst.SW_BAD_P1P2);
        }
        short start = (short) (index * CardConst.CHUNK);
        short n = (short) (len - start);
        if (n > CardConst.CHUNK) {
            n = CardConst.CHUNK;
        }
        short padded = (short) ((n + 15) & 0xFFF0);
        Util.arrayCopyNonAtomic(iv, ivOff(target), ivTmp, (short) 0, (short) 16);
        ivTmp[15] = (byte) (ivTmp[15] ^ index);
        cipher.init(dek, Cipher.MODE_DECRYPT, ivTmp, (short) 0, (short) 16);
        cipher.doFinal(store(target), start, padded, out, off);
        return n;
    }

    private void endSession() {
        sess[S_TARGET] = 0;
        digest.reset();
    }

    /** TERMINATE: clears stored ciphertext, IVs and lengths. */
    void wipe() {
        endSession();
        Util.arrayFillNonAtomic(profile, (short) 0, CardConst.PROFILE_MAX, (byte) 0);
        Util.arrayFillNonAtomic(photo, (short) 0, CardConst.PHOTO_MAX, (byte) 0);
        Util.arrayFillNonAtomic(iv, (short) 0, (short) 32, (byte) 0);
        Util.arrayFillNonAtomic(lens, (short) 0, (short) 4, (byte) 0);
    }
}
