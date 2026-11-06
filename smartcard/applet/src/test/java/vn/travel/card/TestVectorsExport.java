package vn.travel.card;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.KeyFactory;
import java.security.Signature;
import java.security.spec.RSAPublicKeySpec;
import java.util.Arrays;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.crypto.Cipher;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;

/** Generates smartcard/test-vectors/vectors.json for the web side (plan 03 Task 1) and re-verifies it. */
class TestVectorsExport {
    static final String NEW_PIN = "903172";

    static String hex(byte[] b) {
        StringBuilder sb = new StringBuilder();
        for (byte x : b) {
            sb.append(String.format("%02x", x));
        }
        return sb.toString();
    }

    static byte[] unhex(String s) {
        byte[] b = new byte[s.length() / 2];
        for (int i = 0; i < b.length; i++) {
            b[i] = (byte) Integer.parseInt(s.substring(2 * i, 2 * i + 2), 16);
        }
        return b;
    }

    static String get(String json, String key) {
        Matcher m = Pattern.compile("\"" + key + "\":\\s*\"([0-9a-f]*)\"").matcher(json);
        assertTrue(m.find(), key);
        return m.group(1);
    }

    static boolean verify(byte[] modulus, byte[] msg, byte[] sig) throws Exception {
        Signature v = Signature.getInstance("SHA256withRSA");
        v.initVerify(KeyFactory.getInstance("RSA").generatePublic(
                new RSAPublicKeySpec(new java.math.BigInteger(1, modulus), java.math.BigInteger.valueOf(65537))));
        v.update(msg);
        return v.verify(sig);
    }

    @Test
    void exportAndVerifyVectors() throws Exception {
        CardHarness h = CardHarness.fresh();
        byte[] cardModulus = h.activate();

        // AUTHENTICATE (needs PIN session)
        h.verifyPin();
        byte[] nonce = CardHarness.filled(16, (byte) 0xA7);
        byte[] auth = h.ok(0x31, 0, 0, nonce);
        byte[] counter = Arrays.copyOfRange(auth, 0, 4);
        byte[] authSig = Arrays.copyOfRange(auth, 4, 132);

        // CREDIT receipt (166 B)
        byte[] receipt = h.signedOk(0x51, CardHarness.txPayload(0x33, 250000));
        assertEquals(166, receipt.length);

        // Server-signed SET_STATE(LOCKED) command; the challenge is real (from the card)
        byte[] challenge = h.getChallenge();
        byte[] message = CardHarness.mCmd(challenge, CardHarness.CARD_ID, 0x70, 0x03, 0x00, new byte[0]);
        byte[] cmdSig = TestServer.sign(message);

        // RESET_PIN payload, verified by the card
        byte[] kEscrow = TestServer.escrowKey(CardHarness.CARD_ID);
        byte[] plain = new byte[16];
        System.arraycopy(CardHarness.ascii(NEW_PIN), 0, plain, 0, 6);
        Cipher aes = Cipher.getInstance("AES/ECB/NoPadding");
        aes.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(kEscrow, "AES"));
        byte[] encPin = aes.doFinal(plain);
        assertEquals(0x9000, h.signed(0x22, 0, 0, encPin).getSW());
        h.reselect();
        assertEquals(0x9000, h.send(0x20, 0, 0, CardHarness.ascii(NEW_PIN)).getSW());

        String json = "{\n"
                + "  \"escrowMaster\": \"" + hex(TestServer.ESCROW_MASTER) + "\",\n"
                + "  \"cardId\": \"" + hex(CardHarness.CARD_ID) + "\",\n"
                + "  \"cardModulus\": \"" + hex(cardModulus) + "\",\n"
                + "  \"serverModulus\": \"" + hex(TestServer.modulus()) + "\",\n"
                + "  \"auth\": { \"nonce\": \"" + hex(nonce) + "\", \"counter\": \"" + hex(counter)
                + "\", \"signature\": \"" + hex(authSig) + "\" },\n"
                + "  \"command\": { \"challenge\": \"" + hex(challenge) + "\", \"ins\": \"70\", \"p1\": \"03\", \"p2\": \"00\","
                + " \"payload\": \"\", \"message\": \"" + hex(message) + "\", \"signature\": \"" + hex(cmdSig) + "\" },\n"
                + "  \"receipt\": { \"hex\": \"" + hex(receipt) + "\" },\n"
                + "  \"resetPin\": { \"newPin\": \"" + NEW_PIN + "\", \"encPin\": \"" + hex(encPin) + "\" },\n"
                + "  \"escrowKey\": \"" + hex(kEscrow) + "\"\n"
                + "}\n";
        Path out;
        if (System.getProperty("writeVectors") != null) {
            // ./gradlew :applet:test -PwriteVectors regenerates the committed file (random card key).
            out = Paths.get("..", "test-vectors", "vectors.json");
            if (!Files.isDirectory(out.getParent())) {
                out = Paths.get("smartcard", "test-vectors", "vectors.json");
            }
        } else {
            out = Files.createTempFile("vectors", ".json");
            out.toFile().deleteOnExit();
        }
        Files.write(out, json.getBytes(StandardCharsets.US_ASCII));

        // Read back and verify with java.security only
        String back = new String(Files.readAllBytes(out), StandardCharsets.US_ASCII);
        byte[] cm = unhex(get(back, "cardModulus"));
        byte[] sm = unhex(get(back, "serverModulus"));
        byte[] cid = unhex(get(back, "cardId"));
        byte[] authMsg = new byte[37];
        authMsg[0] = 0x41;
        System.arraycopy(unhex(get(back, "nonce")), 0, authMsg, 1, 16);
        System.arraycopy(cid, 0, authMsg, 17, 16);
        System.arraycopy(unhex(get(back, "counter")), 0, authMsg, 33, 4);
        assertTrue(verify(cm, authMsg, unhex(firstSignature(back))), "auth sig");
        assertTrue(verify(sm, unhex(get(back, "message")), unhex(lastSignature(back))), "command sig");
        byte[] r = unhex(get(back, "hex"));
        assertEquals(166, r.length);
        assertEquals(0x52, r[0]);
        assertTrue(verify(cm, Arrays.copyOfRange(r, 0, 38), Arrays.copyOfRange(r, 38, 166)), "receipt sig");
        assertArrayEquals(TestServer.escrowKey(cid), unhex(get(back, "escrowKey")));
        assertEquals(32, get(back, "encPin").length());
    }

    private static String firstSignature(String json) {
        Matcher m = Pattern.compile("\"signature\":\\s*\"([0-9a-f]*)\"").matcher(json);
        assertTrue(m.find());
        return m.group(1);
    }

    private static String lastSignature(String json) {
        Matcher m = Pattern.compile("\"signature\":\\s*\"([0-9a-f]*)\"").matcher(json);
        String last = null;
        while (m.find()) {
            last = m.group(1);
        }
        return last;
    }
}
