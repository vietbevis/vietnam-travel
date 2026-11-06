package vn.travel.card;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.lang.reflect.Field;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.Arrays;
import javacard.framework.APDU;
import javax.crypto.Cipher;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;

/** Các sửa lỗi sau review cuối: TERMINATE an toàn khi mất điện (I1), nhận dữ liệu qua staging (I2), mật mã ghi tmp trước (M1), xóa buffer (M2), cờ vectors (M5). */
class FinalFixTest {
    /** Mô phỏng mất điện giữa lúc commit state và lúc xóa; ghi lại buffer APDU sau mỗi lệnh. */
    public static class Probe extends TravelCardApplet {
        static boolean tear;
        static byte[] lastBuf;

        public static void install(byte[] b, short o, byte l) {
            new Probe().register();
        }

        void completeWipe() {
            if (!tear) {
                super.completeWipe();
            }
        }

        public void process(APDU apdu) {
            try {
                super.process(apdu);
            } catch (javacard.framework.ISOException e) {
                lastBuf = apdu.getBuffer().clone();
                throw e;
            }
            lastBuf = apdu.getBuffer().clone();
        }
    }

    private static Object field(Object o, Class<?> k, String name) throws Exception {
        Field f = k.getDeclaredField(name);
        f.setAccessible(true);
        return f.get(o);
    }

    private static byte[] bytes(Object applet, Class<?> holder, String holderField, String name) throws Exception {
        Object h = holder == TravelCardApplet.class ? applet : field(applet, TravelCardApplet.class, holderField);
        return (byte[]) field(h, holder, name);
    }

    private static boolean allZero(byte[] b) {
        for (byte x : b) {
            if (x != 0) {
                return false;
            }
        }
        return true;
    }

    private static CardHarness probeCard() {
        Probe.tear = false;
        CardHarness c = CardHarness.fresh(Probe.class);
        c.activate();
        c.verifyPin();
        return c;
    }

    // ---- I1 ----

    @Test
    void interruptedTerminateWipeCompletesOnNextCommand() throws Exception {
        CardHarness c = probeCard();
        c.signedOk(0x51, CardHarness.txPayload(1, 1_000_000));
        c.signedOk(0x60, CardHarness.ticket("ORD000000001", CardHarness.filled(12, (byte) 7), "20261231", 2));
        c.writeTarget(1, new byte[100]);
        c.writeTarget(2, CardHarness.filled(300, (byte) 5));
        Object a = c.appletInstance();

        Probe.tear = true; // commit xảy ra, đợt xóa không chạy
        assertEquals(0x9000, c.signed(0x70, 0x7F, 0, new byte[0]).getSW());
        assertEquals(1, bytes(a, TravelCardApplet.class, null, "status")[2], "wipePending set");
        assertEquals(0x7F, bytes(a, TravelCardApplet.class, null, "status")[1]);
        assertFalse(allZero(bytes(a, Wallet.class, "wallet", "state")), "wipe has not run yet");
        assertFalse(allZero(bytes(a, PinGuard.class, "pin", "encDekPin")));

        Probe.tear = false; // có điện lại: lệnh kế tiếp (kể cả GET_PUBLIC_INFO) hoàn tất đợt xóa
        byte[] info = c.ok(0x10, 0, 0, null);
        assertEquals(0x7F, info[17]);
        assertEquals(0, info[19], "PIN blocked");
        assertEquals(0, bytes(a, TravelCardApplet.class, null, "status")[2], "flag cleared");
        assertTrue(allZero(bytes(a, Wallet.class, "wallet", "state")));
        assertTrue(allZero(bytes(a, Wallet.class, "wallet", "ring")));
        assertTrue(allZero(bytes(a, TicketStore.class, "tickets", "slots")));
        assertTrue(allZero(bytes(a, SecureStore.class, "store", "profile")));
        assertTrue(allZero(bytes(a, SecureStore.class, "store", "photo")));
        assertTrue(allZero(bytes(a, PinGuard.class, "pin", "salt")));
        assertTrue(allZero(bytes(a, PinGuard.class, "pin", "encDekPin")));
        assertTrue(allZero(bytes(a, PinGuard.class, "pin", "encDekEscrow")));
        c.assertSw(0x6985, 0x20, 0, 0, CardHarness.ascii(c.pin));
        c.assertSw(0x6985, 0x50, 0, 0, null);
    }

    @Test
    void interruptedTerminateWipeCompletesOnReselect() throws Exception {
        CardHarness c = probeCard();
        c.signedOk(0x51, CardHarness.txPayload(1, 5));
        Object a = c.appletInstance();
        Probe.tear = true;
        assertEquals(0x9000, c.signed(0x70, 0x7F, 0, new byte[0]).getSW());
        Probe.tear = false;
        c.reselect();
        assertEquals(0, bytes(a, TravelCardApplet.class, null, "status")[2]);
        assertTrue(allZero(bytes(a, Wallet.class, "wallet", "state")));
    }

    @Test
    void normalTerminateLeavesNoPendingFlag() throws Exception {
        CardHarness c = probeCard();
        assertEquals(0x9000, c.signed(0x70, 0x7F, 0, new byte[0]).getSW());
        assertEquals(0, bytes(c.appletInstance(), TravelCardApplet.class, null, "status")[2]);
    }

    // ---- I2 ----

    @Test
    void stagingBufferIsZeroedAfterEveryCommand() throws Exception {
        CardHarness c = probeCard();
        Object a = c.appletInstance();
        byte[] in = bytes(a, TravelCardApplet.class, null, "in");
        c.writeTarget(1, CardHarness.filled(224, (byte) 9)); // WRITE_CHUNK 224 B
        assertTrue(allZero(in));
        c.signedOk(0x51, CardHarness.txPayload(3, 10)); // CREDIT 145 B
        assertTrue(allZero(in));
        c.ok(0x20, 0, 0, CardHarness.ascii(c.pin));
        assertTrue(allZero(in));
    }

    @Test
    void largestCommandsStillWork() {
        CardHarness c = CardHarness.fresh();
        c.activate();
        c.verifyPin();
        c.signedOk(0x60, CardHarness.ticket("ORD000000002", CardHarness.filled(12, (byte) 3), "20261231", 1));
        c.writeTarget(2, CardHarness.filled(10080, (byte) 4));
        assertEquals(1, c.ok(0x61, 0, 0, null)[0]);
    }

    // ---- M2 ----

    private static void assertDataRegionZero(int lc) {
        for (int i = 5; i < 5 + lc; i++) {
            assertEquals(0, Probe.lastBuf[i], "APDU buffer byte " + i);
        }
    }

    @Test
    void secretsNotLeftInApduBufferOnFailures() {
        Probe.tear = false;
        CardHarness c = CardHarness.fresh(Probe.class);
        byte[] d = new byte[167];
        System.arraycopy(TestServer.modulus(), 0, d, 17, 128);
        System.arraycopy(CardHarness.ascii("482915"), 0, d, 145, 6);
        System.arraycopy(CardHarness.filled(16, (byte) 0x66), 0, d, 151, 16);
        d[16] = 0x09; // cardType sai, các chữ số vẫn đúng
        c.assertSw(0x6A80, 0x01, 0, 0, d);
        assertDataRegionZero(167);
        d[16] = 0x01;
        d[147] = 'x'; // PIN chứa ký tự không phải chữ số
        c.assertSw(0x6A80, 0x01, 0, 0, d);
        assertDataRegionZero(167);

        c.activate();
        c.assertSw(0x6A80, 0x20, 0, 0, CardHarness.ascii("12345x"));
        assertDataRegionZero(6);
        c.assertSw(0x6A80, 0x21, 0, 0, CardHarness.ascii("12345x" + "123456"));
        assertDataRegionZero(12);
        assertNotEquals(0x9000, c.send(0x20, 0, 0, CardHarness.ascii("000000")).getSW());
        assertDataRegionZero(6);
        assertNotEquals(0x9000, c.send(0x21, 0, 0, CardHarness.ascii("000000" + "111111")).getSW());
        assertDataRegionZero(12);
        assertNotEquals(0x9000, c.send(0x22, 0, 0, new byte[16 + 128]).getSW());
        assertDataRegionZero(144);
    }

    // ---- M1 ----

    private static byte[] aesEcb(int mode, byte[] key, byte[] data) throws Exception {
        Cipher ci = Cipher.getInstance("AES/ECB/NoPadding");
        ci.init(mode, new SecretKeySpec(key, "AES"));
        return ci.doFinal(data);
    }

    private static byte[] unwrapWithPin(byte[] salt, byte[] encDek, String pin) throws Exception {
        byte[] kek = Arrays.copyOf(CardHarness.sha256(concat(salt, CardHarness.ascii(pin))), 16);
        return aesEcb(Cipher.DECRYPT_MODE, kek, encDek);
    }

    private static byte[] concat(byte[] a, byte[] b) {
        byte[] r = Arrays.copyOf(a, a.length + b.length);
        System.arraycopy(b, 0, r, a.length, b.length);
        return r;
    }

    @Test
    void persistentWrapsStayConsistentAcrossInitChangeReset() throws Exception {
        CardHarness c = CardHarness.fresh();
        c.personalize((byte) 0x01);
        Object a = c.appletInstance();
        byte[] salt = bytes(a, PinGuard.class, "pin", "salt");
        byte[] encPin = bytes(a, PinGuard.class, "pin", "encDekPin");
        byte[] encEsc = bytes(a, PinGuard.class, "pin", "encDekEscrow");
        byte[] dek = aesEcb(Cipher.DECRYPT_MODE, TestServer.escrowKey(CardHarness.CARD_ID), encEsc);
        assertArrayEquals(dek, unwrapWithPin(salt, encPin, CardHarness.PIN));
        byte[] salt0 = salt.clone();

        c.changePin(CardHarness.PIN, CardHarness.ACTIVE_PIN);
        assertFalse(Arrays.equals(salt0, salt));
        assertArrayEquals(dek, unwrapWithPin(salt, encPin, CardHarness.ACTIVE_PIN));

        byte[] salt1 = salt.clone();
        byte[] plain = Arrays.copyOf(CardHarness.ascii("903172"), 16);
        byte[] encNew = aesEcb(Cipher.ENCRYPT_MODE, TestServer.escrowKey(CardHarness.CARD_ID), plain);
        assertEquals(0x9000, c.signed(0x22, 0, 0, encNew).getSW());
        assertFalse(Arrays.equals(salt1, salt));
        assertArrayEquals(dek, unwrapWithPin(salt, encPin, "903172"));
        c.ok(0x20, 0, 0, CardHarness.ascii("903172"));
    }

    // ---- M5 ----

    private static final byte[] VECTORS_BEFORE = readVectors();

    private static byte[] readVectors() {
        try {
            return Files.readAllBytes(Paths.get("..", "test-vectors", "vectors.json"));
        } catch (java.io.IOException e) {
            return null;
        }
    }

    @Test
    void vectorsFileUntouchedWithoutFlag() throws Exception {
        if (System.getProperty("writeVectors") != null || VECTORS_BEFORE == null) {
            return;
        }
        new TestVectorsExport().exportAndVerifyVectors();
        assertArrayEquals(VECTORS_BEFORE, readVectors());
    }
}
