package vn.travel.card;

import javacard.security.KeyPair;
import javacard.security.RSAPublicKey;
import javacard.security.Signature;

/** Cặp khóa RSA-1024 CRT của thẻ và bộ ký PKCS#1 v1.5 SHA-256. */
final class CardKeys {
    private final KeyPair pair;
    private final Signature signer;

    CardKeys() {
        pair = new KeyPair(KeyPair.ALG_RSA_CRT, (short) 1024);
        signer = Signature.getInstance(Signature.ALG_RSA_SHA_256_PKCS1, false);
    }

    void generate() {
        pair.genKeyPair();
    }

    /** Ghi modulus 128 byte; trả về 128. */
    short getModulus(byte[] out, short off) {
        return ((RSAPublicKey) pair.getPublic()).getModulus(out, off);
    }

    /** Ký msg; trả về độ dài chữ ký (128). */
    short sign(byte[] msg, short off, short len, byte[] out, short outOff) {
        signer.init(pair.getPrivate(), Signature.MODE_SIGN);
        return signer.sign(msg, off, len, out, outOff);
    }

    void clear() {
        if (pair.getPrivate().isInitialized()) {
            pair.getPrivate().clearKey();
        }
        if (pair.getPublic().isInitialized()) {
            pair.getPublic().clearKey();
        }
    }
}
