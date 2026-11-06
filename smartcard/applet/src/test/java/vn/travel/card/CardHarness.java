package vn.travel.card;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.licel.jcardsim.smartcardio.CardSimulator;
import com.licel.jcardsim.utils.AIDUtil;
import java.util.Arrays;
import javacard.framework.AID;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;

/** Test harness: installs the applet in jCardSim and sends APDUs. */
public final class CardHarness {
    public static final byte[] CARD_ID = filled(16, (byte) 0x11);
    public static final String PIN = "482915";

    static final byte[] APPLET_AID = {
        (byte) 0xF0, 0x54, 0x52, 0x41, 0x56, 0x45, 0x4C, 0x01
    };
    static final byte[] OTHER_AID = {
        (byte) 0xF0, 0x54, 0x52, 0x41, 0x56, 0x45, 0x4C, 0x7F
    };

    public byte[] cardModulus;
    /** PIN currently set on the card (changes with activate()). */
    public String pin = PIN;
    private final CardSimulator sim;
    private final AID aid;

    private CardHarness() {
        this(TravelCardApplet.class);
    }

    CardHarness(Class<? extends javacard.framework.Applet> appletClass) {
        sim = new CardSimulator();
        aid = AIDUtil.create(APPLET_AID);
        sim.installApplet(aid, appletClass);
        sim.installApplet(AIDUtil.create(OTHER_AID), OtherApplet.class);
        sim.selectApplet(aid);
    }

    static CardHarness fresh(Class<? extends javacard.framework.Applet> appletClass) {
        return new CardHarness(appletClass);
    }


    /** Minimal applet used only to deselect ours. */
    public static final class OtherApplet extends javacard.framework.Applet {
        public static void install(byte[] b, short o, byte l) {
            new OtherApplet().register();
        }

        public void process(javacard.framework.APDU apdu) {}
    }

    /** Fresh card with the applet installed and selected, in CREATED state. */
    public static CardHarness fresh() {
        return new CardHarness();
    }

    public ResponseAPDU send(int ins, int p1, int p2, byte[] data) {
        return sendCla(0x80, ins, p1, p2, data);
    }

    public ResponseAPDU sendCla(int cla, int ins, int p1, int p2, byte[] data) {
        CommandAPDU cmd = (data == null || data.length == 0)
                ? new CommandAPDU(cla, ins, p1, p2, 256)
                : new CommandAPDU(cla, ins, p1, p2, data, 256);
        return sim.transmitCommand(cmd);
    }

    public byte[] ok(int ins, int p1, int p2, byte[] data) {
        ResponseAPDU r = send(ins, p1, p2, data);
        assertEquals(0x9000, r.getSW(), () -> String.format("SW=%04X", r.getSW()));
        return r.getData();
    }

    public void assertSw(int expectedSw, int ins, int p1, int p2, byte[] data) {
        assertEquals(expectedSw, send(ins, p1, p2, data).getSW());
    }

    /** INIT with test server data; returns and stores the card modulus. */
    public byte[] personalize(byte cardType) {
        byte[] d = new byte[167];
        System.arraycopy(CARD_ID, 0, d, 0, 16);
        d[16] = cardType;
        System.arraycopy(TestServer.modulus(), 0, d, 17, 128);
        System.arraycopy(PIN.getBytes(java.nio.charset.StandardCharsets.US_ASCII), 0, d, 145, 6);
        System.arraycopy(TestServer.escrowKey(CARD_ID), 0, d, 151, 16);
        cardModulus = ok(0x01, 0, 0, d);
        return cardModulus;
    }

    public static final String ACTIVE_PIN = "715043";

    /** personalize + CHANGE_PIN(PIN -> ACTIVE_PIN); leaves mustChangePin = 0. */
    public byte[] activate() {
        byte[] mod = personalize((byte) 0x01);
        changePin(PIN, ACTIVE_PIN);
        return mod;
    }

    public void changePin(String oldPin, String newPin) {
        byte[] d = new byte[12];
        System.arraycopy(ascii(oldPin), 0, d, 0, 6);
        System.arraycopy(ascii(newPin), 0, d, 6, 6);
        ok(0x21, 0, 0, d);
        pin = newPin;
    }

    public void verifyPin() {
        ok(0x20, 0, 0, ascii(pin));
    }

    public byte[] getChallenge() {
        return ok(0x30, 0, 0, null);
    }

    /** M_cmd = 0x43 || challenge16 || cardId16 || INS || P1 || P2 || payload (spec 3.2). */
    public static byte[] mCmd(byte[] challenge, byte[] cardId, int ins, int p1, int p2, byte[] payload) {
        byte[] m = new byte[36 + payload.length];
        m[0] = 0x43;
        System.arraycopy(challenge, 0, m, 1, 16);
        System.arraycopy(cardId, 0, m, 17, 16);
        m[33] = (byte) ins;
        m[34] = (byte) p1;
        m[35] = (byte) p2;
        System.arraycopy(payload, 0, m, 36, payload.length);
        return m;
    }

    /** GET_CHALLENGE, then returns payload || sig128 signed for the given cardId. */
    public byte[] signedData(byte[] cardId, int ins, int p1, int p2, byte[] payload) {
        byte[] sig = TestServer.sign(mCmd(getChallenge(), cardId, ins, p1, p2, payload));
        byte[] d = Arrays.copyOf(payload, payload.length + sig.length);
        System.arraycopy(sig, 0, d, payload.length, sig.length);
        return d;
    }

    /** GET_CHALLENGE -> M_cmd -> TestServer.sign -> send payload || sig. */
    public ResponseAPDU signed(int ins, int p1, int p2, byte[] payload) {
        return send(ins, p1, p2, signedData(CARD_ID, ins, p1, p2, payload));
    }

    /** signed(...) that requires 9000 and returns the response data. */
    public byte[] signedOk(int ins, byte[] payload) {
        ResponseAPDU r = signed(ins, 0, 0, payload);
        assertEquals(0x9000, r.getSW(), () -> String.format("SW=%04X", r.getSW()));
        return r.getData();
    }

    /** ticket33 = orderCode12 | tourId12 | departure8 | pax1. */
    static byte[] ticket(String orderCode12, byte[] tourId12, String yyyymmdd, int pax) {
        byte[] t = new byte[33];
        System.arraycopy(ascii(orderCode12), 0, t, 0, 12);
        System.arraycopy(tourId12, 0, t, 12, 12);
        System.arraycopy(ascii(yyyymmdd), 0, t, 24, 8);
        t[32] = (byte) pax;
        return t;
    }

    static byte[] ascii(String s) {
        return s.getBytes(java.nio.charset.StandardCharsets.US_ASCII);
    }

    /** Deselect by selecting another applet (or none), then select ours again. */
    public void reselect() {
        sim.selectApplet(AIDUtil.create(OTHER_AID));
        sim.selectApplet(aid);
    }

    static byte[] filled(int n, byte v) {
        byte[] b = new byte[n];
        Arrays.fill(b, v);
        return b;
    }

    /** Verifies a card signature (SHA256withRSA, e = 65537) against cardModulus using java.security. */
    public boolean verifyCardSig(byte[] msg, byte[] sig) {
        try {
            java.security.PublicKey pk = java.security.KeyFactory.getInstance("RSA").generatePublic(
                    new java.security.spec.RSAPublicKeySpec(
                            new java.math.BigInteger(1, cardModulus), java.math.BigInteger.valueOf(65537)));
            java.security.Signature v = java.security.Signature.getInstance("SHA256withRSA");
            v.initVerify(pk);
            v.update(msg);
            return v.verify(sig);
        } catch (java.security.GeneralSecurityException e) {
            throw new IllegalStateException(e);
        }
    }

    public static byte[] sha256(byte[] d) {
        try {
            return java.security.MessageDigest.getInstance("SHA-256").digest(d);
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    public ResponseAPDU beginWrite(int target, int totalLen) {
        return send(0x41, target, 0, new byte[] {(byte) (totalLen >> 8), (byte) totalLen});
    }

    public ResponseAPDU writeChunk(int target, int index, byte[] chunk) {
        return send(0x42, target, index, chunk);
    }

    /** COMMIT_WRITE with payload sha256_32 || len2, signed by the test server. */
    public ResponseAPDU commit(int target, byte[] hash, int len) {
        byte[] p = Arrays.copyOf(hash, 34);
        p[32] = (byte) (len >> 8);
        p[33] = (byte) len;
        return signed(0x43, target, 0, p);
    }

    /** BEGIN, WRITE each chunk, signed COMMIT; every step must return 9000. */
    public void writeTarget(int target, byte[] data) {
        ok(0x41, target, 0, new byte[] {(byte) (data.length >> 8), (byte) data.length});
        for (int i = 0, idx = 0; i < data.length; i += 224, idx++) {
            ok(0x42, target, idx, Arrays.copyOfRange(data, i, Math.min(data.length, i + 224)));
        }
        ResponseAPDU r = commit(target, sha256(data), data.length);
        assertEquals(0x9000, r.getSW(), () -> String.format("COMMIT SW=%04X", r.getSW()));
    }

    /** Length via P2 = FF, then every chunk concatenated. */
    public byte[] readTarget(int target) {
        byte[] l = ok(0x40, target, 0xFF, null);
        int len = ((l[0] & 0xFF) << 8) | (l[1] & 0xFF);
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        for (int i = 0, idx = 0; i < len; i += 224, idx++) {
            byte[] c = ok(0x40, target, idx, null);
            out.write(c, 0, c.length);
        }
        return out.toByteArray();
    }

    /** Parsed wallet receipt; construction asserts the card signature over r[0..38). */
    public static final class Receipt {
        public int type;
        public byte[] txRef;
        public long amount;
        public long balanceAfter;
        public long counter;
    }

    public static byte[] u32(long v) {
        return new byte[] {(byte) (v >> 24), (byte) (v >> 16), (byte) (v >> 8), (byte) v};
    }

    public static long u32(byte[] b, int off) {
        return ((b[off] & 0xFFL) << 24) | ((b[off + 1] & 0xFFL) << 16) | ((b[off + 2] & 0xFFL) << 8) | (b[off + 3] & 0xFFL);
    }

    /** txRef8 || amount4. */
    public static byte[] txPayload(int refByte, long amount) {
        byte[] p = new byte[12];
        Arrays.fill(p, 0, 8, (byte) refByte);
        System.arraycopy(u32(amount), 0, p, 8, 4);
        return p;
    }

    public Receipt parseReceipt(byte[] r) {
        assertEquals(166, r.length);
        byte[] m = Arrays.copyOfRange(r, 0, 38);
        org.junit.jupiter.api.Assertions.assertTrue(verifyCardSig(m, Arrays.copyOfRange(r, 38, 166)), "receipt signature");
        assertEquals(0x52, m[0]);
        org.junit.jupiter.api.Assertions.assertArrayEquals(CARD_ID, Arrays.copyOfRange(m, 1, 17));
        Receipt x = new Receipt();
        x.type = m[17];
        x.txRef = Arrays.copyOfRange(m, 18, 26);
        x.amount = u32(m, 26);
        x.balanceAfter = u32(m, 30);
        x.counter = u32(m, 34);
        return x;
    }

    /** The in-process applet instance, for white-box checks of persistent state. */
    Object appletInstance() throws Exception {
        java.lang.reflect.Field rf = null;
        for (Class<?> k = sim.getClass(); k != null && rf == null; k = k.getSuperclass()) {
            for (java.lang.reflect.Field f : k.getDeclaredFields()) {
                if (f.getType().getName().endsWith("SimulatorRuntime")) {
                    rf = f;
                    break;
                }
            }
        }
        rf.setAccessible(true);
        Object rt = rf.get(sim);
        java.lang.reflect.Method m = rt.getClass().getDeclaredMethod("getApplet", AID.class);
        m.setAccessible(true);
        return m.invoke(rt, aid);
    }
}
