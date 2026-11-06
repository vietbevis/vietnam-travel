package vn.travel.card;

import javacard.security.KeyPair;
import javacard.security.RSAPublicKey;
import javacard.security.Signature;

/** Card RSA-1024 CRT key pair and PKCS#1 v1.5 SHA-256 signer. */
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

    /** Writes the 128-byte modulus; returns 128. */
    short getModulus(byte[] out, short off) {
        return ((RSAPublicKey) pair.getPublic()).getModulus(out, off);
    }

    /** Signs msg; returns the signature length (128). */
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
