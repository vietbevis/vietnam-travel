package vn.travel.card;

import javacard.framework.ISOException;
import javacard.framework.JCSystem;
import javacard.framework.Util;
import javacard.security.CryptoException;
import javacard.security.RSAPublicKey;
import javacard.security.RandomData;
import javacard.security.Signature;

/** Server challenge and verification of server-signed commands (spec 3.2, M_cmd). */
final class ServerAuth {
    static final short SIG_LEN = 128;
    private static final byte TAG_CMD = 0x43;

    private final RSAPublicKey serverKey;
    private final Signature verifier;
    private final RandomData rnd;
    /** Both cleared on deselect. */
    private final byte[] challenge;
    private final byte[] outstanding;
    private final byte[] head;

    ServerAuth(RSAPublicKey serverKey) {
        this.serverKey = serverKey;
        verifier = Signature.getInstance(Signature.ALG_RSA_SHA_256_PKCS1, false);
        rnd = RandomData.getInstance(RandomData.ALG_SECURE_RANDOM);
        challenge = JCSystem.makeTransientByteArray((short) 16, JCSystem.CLEAR_ON_DESELECT);
        outstanding = JCSystem.makeTransientByteArray((short) 1, JCSystem.CLEAR_ON_DESELECT);
        head = JCSystem.makeTransientByteArray((short) 36, JCSystem.CLEAR_ON_DESELECT);
    }

    /** Replaces any previous challenge with a fresh 16-byte one and copies it to out[off..]. */
    void issueChallenge(byte[] out, short off) {
        rnd.generateData(challenge, (short) 0, (short) 16);
        outstanding[0] = 1;
        Util.arrayCopyNonAtomic(challenge, (short) 0, out, off, (short) 16);
    }

    void clear() {
        destroy();
    }

    private void destroy() {
        outstanding[0] = 0;
        Util.arrayFillNonAtomic(challenge, (short) 0, (short) 16, (byte) 0);
    }

    /**
     * buf[cdataOff..+lc] = payload || sig128. The challenge is destroyed on every call,
     * whatever the outcome. Returns the payload length (lc - 128).
     * Throws 6F21 (no challenge), 6700 (lc &lt; 128), 6F20 (bad signature).
     */
    short verifySigned(byte[] buf, short cdataOff, short lc, byte ins, byte p1, byte p2, byte[] cardId) {
        boolean had = outstanding[0] != 0;
        if (had) {
            head[0] = TAG_CMD;
            Util.arrayCopyNonAtomic(challenge, (short) 0, head, (short) 1, (short) 16);
        }
        destroy();
        if (!had) {
            ISOException.throwIt(CardConst.SW_NO_CHALLENGE);
        }
        if (lc < SIG_LEN) {
            ISOException.throwIt(CardConst.SW_WRONG_LENGTH);
        }
        Util.arrayCopyNonAtomic(cardId, (short) 0, head, (short) 17, (short) 16);
        head[33] = ins;
        head[34] = p1;
        head[35] = p2;
        short payloadLen = (short) (lc - SIG_LEN);
        boolean ok = false;
        try {
            verifier.init(serverKey, Signature.MODE_VERIFY);
            verifier.update(head, (short) 0, (short) 36);
            ok = verifier.verify(buf, cdataOff, payloadLen, buf, (short) (cdataOff + payloadLen), SIG_LEN);
        } catch (CryptoException e) {
            ok = false;
        }
        Util.arrayFillNonAtomic(head, (short) 0, (short) 36, (byte) 0);
        if (!ok) {
            ISOException.throwIt(CardConst.SW_BAD_SIGNATURE);
        }
        return payloadLen;
    }
}
