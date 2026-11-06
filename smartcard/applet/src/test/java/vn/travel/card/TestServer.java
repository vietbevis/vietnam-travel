package vn.travel.card;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.interfaces.RSAPrivateCrtKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.Arrays;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/** Test-side stand-in for the server: RSA test key + escrow derivation. */
public final class TestServer {
    public static final byte[] ESCROW_MASTER = filled(32, (byte) 0x5A);

    private static final PrivateKey KEY = load();

    private TestServer() {}

    private static byte[] filled(int n, byte v) {
        byte[] b = new byte[n];
        Arrays.fill(b, v);
        return b;
    }

    private static PrivateKey load() {
        try {
            Path p = Paths.get("..", "test-vectors", "server-test-key.pem");
            if (!Files.exists(p)) {
                p = Paths.get("smartcard", "test-vectors", "server-test-key.pem");
            }
            String pem = new String(Files.readAllBytes(p), StandardCharsets.US_ASCII)
                    .replaceAll("-----[A-Z ]+-----", "")
                    .replaceAll("\\s", "");
            return KeyFactory.getInstance("RSA")
                    .generatePrivate(new PKCS8EncodedKeySpec(Base64.getDecoder().decode(pem)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    /** 128-byte unsigned big-endian modulus. */
    public static byte[] modulus() {
        byte[] m = ((RSAPrivateCrtKey) KEY).getModulus().toByteArray();
        byte[] out = new byte[128];
        int len = Math.min(m.length, 128);
        System.arraycopy(m, m.length - len, out, 128 - len, len);
        return out;
    }

    public static byte[] sign(byte[] msg) {
        try {
            Signature s = Signature.getInstance("SHA256withRSA");
            s.initSign(KEY);
            s.update(msg);
            return s.sign();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    public static byte[] escrowKey(byte[] cardId) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(ESCROW_MASTER, "HmacSHA256"));
            return Arrays.copyOf(mac.doFinal(cardId), 16);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

}
