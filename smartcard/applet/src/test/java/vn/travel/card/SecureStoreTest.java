package vn.travel.card;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Arrays;
import java.util.Random;
import org.junit.jupiter.api.Test;

class SecureStoreTest {
    private static CardHarness card() {
        CardHarness c = CardHarness.fresh();
        c.activate();
        c.verifyPin();
        return c;
    }

    private static byte[] rnd(int n, long seed) {
        byte[] b = new byte[n];
        new Random(seed).nextBytes(b);
        return b;
    }

    private static int len(CardHarness c, int target) {
        byte[] l = c.ok(0x40, target, 0xFF, null);
        return ((l[0] & 0xFF) << 8) | (l[1] & 0xFF);
    }

    @Test
    void profileRoundTrip() {
        CardHarness c = card();
        byte[] d = rnd(300, 1);
        c.writeTarget(1, d);
        assertArrayEquals(d, c.readTarget(1));
    }

    @Test
    void profileMaxRoundTrip() {
        CardHarness c = card();
        byte[] d = rnd(448, 2);
        c.writeTarget(1, d);
        assertArrayEquals(d, c.readTarget(1));
    }

    @Test
    void oddLengthsRoundTrip() {
        CardHarness c = card();
        for (int n : new int[] {1, 15, 16, 17, 223, 224, 225}) {
            byte[] d = rnd(n, n);
            c.writeTarget(1, d);
            assertArrayEquals(d, c.readTarget(1), "len " + n);
        }
    }

    @Test
    void photoMaxRoundTrip() {
        CardHarness c = card();
        byte[] d = rnd(10080, 3);
        c.writeTarget(2, d);
        assertEquals(10080, len(c, 2));
        assertArrayEquals(d, c.readTarget(2));
    }

    @Test
    void photoTooLarge() {
        CardHarness c = card();
        assertEquals(0x6A84, c.beginWrite(2, 10081).getSW());
        assertEquals(0x6A84, c.beginWrite(1, 449).getSW());
        assertEquals(0x6A84, c.beginWrite(2, 0xFFFF).getSW());
        assertEquals(0x9000, c.beginWrite(2, 10080).getSW());
    }

    @Test
    void oversizeBeginKeepsOldContent() {
        CardHarness c = card();
        byte[] d = rnd(100, 4);
        c.writeTarget(1, d);
        assertEquals(0x6A84, c.beginWrite(1, 449).getSW());
        assertArrayEquals(d, c.readTarget(1));
    }

    @Test
    void commitBeforeAllChunks() {
        CardHarness c = card();
        byte[] d = rnd(500, 5);
        assertEquals(0x9000, c.beginWrite(2, 500).getSW());
        c.ok(0x42, 2, 0, Arrays.copyOfRange(d, 0, 224));
        assertEquals(0x6A80, c.commit(2, CardHarness.sha256(d), 500).getSW());
        assertEquals(0, len(c, 2));
        c.assertSw(0x6A88, 0x40, 2, 0, null);
    }

    @Test
    void commitBeforeAllChunksDoesNotLeavePartialStateOverOldData() {
        CardHarness c = card();
        c.writeTarget(2, rnd(300, 6));
        byte[] d = rnd(500, 7);
        c.beginWrite(2, 500);
        c.ok(0x42, 2, 0, Arrays.copyOfRange(d, 0, 224));
        assertEquals(0x6A80, c.commit(2, CardHarness.sha256(d), 500).getSW());
        assertEquals(0, len(c, 2));
        // phiên đã kết thúc: các chunk tiếp theo bị từ chối
        assertEquals(0x6985, c.writeChunk(2, 1, Arrays.copyOfRange(d, 224, 448)).getSW());
        // sau đó thẻ vẫn dùng được
        byte[] ok = rnd(260, 8);
        c.writeTarget(2, ok);
        assertArrayEquals(ok, c.readTarget(2));
    }

    @Test
    void outOfOrderChunk() {
        CardHarness c = card();
        c.beginWrite(1, 300);
        assertEquals(0x6A86, c.writeChunk(1, 1, new byte[76]).getSW());
        assertEquals(0x6A86, c.writeChunk(1, 1, new byte[224]).getSW());
    }

    @Test
    void repeatedChunkIndexRejected() {
        CardHarness c = card();
        c.beginWrite(1, 448);
        c.ok(0x42, 1, 0, new byte[224]);
        assertEquals(0x6A86, c.writeChunk(1, 0, new byte[224]).getSW());
    }

    @Test
    void chunkBeyondDeclaredLength() {
        CardHarness c = card();
        c.beginWrite(1, 224);
        c.ok(0x42, 1, 0, new byte[224]);
        assertEquals(0x6A86, c.writeChunk(1, 1, new byte[1]).getSW());
    }

    @Test
    void shortNonLastChunk() {
        CardHarness c = card();
        c.beginWrite(1, 300);
        assertEquals(0x6700, c.writeChunk(1, 0, new byte[100]).getSW());
    }

    @Test
    void wrongLastChunkLength() {
        CardHarness c = card();
        c.beginWrite(1, 300);
        c.ok(0x42, 1, 0, new byte[224]);
        assertEquals(0x6700, c.writeChunk(1, 1, new byte[77]).getSW());
        assertEquals(0x6700, c.send(0x42, 1, 1, null).getSW());
    }

    @Test
    void writeWithoutBegin() {
        CardHarness c = card();
        assertEquals(0x6985, c.writeChunk(1, 0, new byte[224]).getSW());
        assertEquals(0x6985, c.commit(1, new byte[32], 1).getSW());
    }

    @Test
    void chunkForOtherTargetRejected() {
        CardHarness c = card();
        c.beginWrite(1, 100);
        assertEquals(0x6985, c.writeChunk(2, 0, new byte[100]).getSW());
    }

    @Test
    void hashMismatch() {
        CardHarness c = card();
        byte[] d = rnd(300, 9);
        c.beginWrite(1, 300);
        c.ok(0x42, 1, 0, Arrays.copyOfRange(d, 0, 224));
        c.ok(0x42, 1, 1, Arrays.copyOfRange(d, 224, 300));
        byte[] other = d.clone();
        other[0] ^= 1;
        assertEquals(0x6A80, c.commit(1, CardHarness.sha256(other), 300).getSW());
        assertEquals(0, len(c, 1));
    }

    @Test
    void lengthMismatchOnCommit() {
        CardHarness c = card();
        byte[] d = rnd(300, 10);
        c.beginWrite(1, 300);
        c.ok(0x42, 1, 0, Arrays.copyOfRange(d, 0, 224));
        c.ok(0x42, 1, 1, Arrays.copyOfRange(d, 224, 300));
        assertEquals(0x6A80, c.commit(1, CardHarness.sha256(d), 299).getSW());
        assertEquals(0, len(c, 1));
    }

    @Test
    void commitNeedsSignature() {
        CardHarness c = card();
        byte[] d = rnd(100, 11);
        c.writeTarget(1, d);
        c.beginWrite(1, 100);
        c.ok(0x42, 1, 0, d);
        byte[] p = Arrays.copyOf(CardHarness.sha256(d), 34);
        p[33] = 100;
        byte[] data = c.signedData(CardHarness.CARD_ID, 0x43, 1, 0, p);
        data[data.length - 1] ^= 1;
        assertEquals(0x6F20, c.send(0x43, 1, 0, data).getSW());
        // hiện không còn challenge nào chưa dùng
        assertEquals(0x6F21, c.send(0x43, 1, 0, data).getSW());
    }

    @Test
    void commitSignatureBoundToTarget() {
        CardHarness c = card();
        byte[] d = rnd(100, 12);
        c.beginWrite(1, 100);
        c.ok(0x42, 1, 0, d);
        byte[] p = Arrays.copyOf(CardHarness.sha256(d), 34);
        p[33] = 100;
        byte[] data = c.signedData(CardHarness.CARD_ID, 0x43, 2, 0, p);
        assertEquals(0x6F20, c.send(0x43, 1, 0, data).getSW());
    }

    @Test
    void commitWrongPayloadLength() {
        CardHarness c = card();
        c.beginWrite(1, 100);
        assertEquals(0x6700, c.signed(0x43, 1, 0, new byte[33]).getSW());
    }

    @Test
    void readNeedsPin() {
        CardHarness c = card();
        c.writeTarget(1, rnd(50, 13));
        c.reselect();
        c.assertSw(0x6982, 0x40, 1, 0xFF, null);
        c.assertSw(0x6982, 0x40, 1, 0, null);
        c.assertSw(0x6982, 0x41, 1, 0, new byte[] {0, 5});
        c.assertSw(0x6982, 0x42, 1, 0, new byte[5]);
    }

    @Test
    void writeSessionDoesNotSurviveReselect() {
        CardHarness c = card();
        byte[] d = rnd(100, 14);
        c.beginWrite(1, 100);
        c.ok(0x42, 1, 0, d);
        c.reselect();
        c.verifyPin();
        assertEquals(0x6985, c.commit(1, CardHarness.sha256(d), 100).getSW());
        assertEquals(0, len(c, 1));
    }

    @Test
    void emptyTargetRead() {
        CardHarness c = card();
        assertArrayEquals(new byte[] {0, 0}, c.ok(0x40, 1, 0xFF, null));
        assertArrayEquals(new byte[] {0, 0}, c.ok(0x40, 2, 0xFF, null));
        c.assertSw(0x6A88, 0x40, 1, 0, null);
        c.assertSw(0x6A88, 0x40, 2, 0, null);
    }

    @Test
    void readChunkOutOfRange() {
        CardHarness c = card();
        c.writeTarget(1, rnd(300, 15));
        c.assertSw(0x6A86, 0x40, 1, 2, null);
        c.assertSw(0x6A86, 0x40, 1, 0x80, null);
        assertEquals(224, c.ok(0x40, 1, 0, null).length);
        assertEquals(76, c.ok(0x40, 1, 1, null).length);
    }

    @Test
    void badTarget() {
        CardHarness c = card();
        c.assertSw(0x6A86, 0x40, 3, 0xFF, null);
        c.assertSw(0x6A86, 0x40, 0, 0xFF, null);
        c.assertSw(0x6A86, 0x41, 3, 0, new byte[] {0, 5});
        c.assertSw(0x6A86, 0x42, 3, 0, new byte[5]);
        c.assertSw(0x6A86, 0x43, 3, 0, new byte[34]);
    }

    @Test
    void beginWrongLength() {
        CardHarness c = card();
        c.assertSw(0x6700, 0x41, 1, 0, new byte[] {1});
        c.assertSw(0x6700, 0x41, 1, 0, new byte[3]);
        c.assertSw(0x6A80, 0x41, 1, 0, new byte[] {0, 0});
    }

    @Test
    void rewriteSameDataReadable() {
        CardHarness c = card();
        byte[] d = rnd(300, 16);
        c.writeTarget(1, d);
        assertArrayEquals(d, c.readTarget(1));
        c.writeTarget(1, d);
        assertArrayEquals(d, c.readTarget(1));
    }

    @Test
    void rewriteShorterShrinks() {
        CardHarness c = card();
        c.writeTarget(1, rnd(400, 17));
        byte[] d = rnd(30, 18);
        c.writeTarget(1, d);
        assertArrayEquals(d, c.readTarget(1));
    }

    @Test
    void targetsAreIndependent() {
        CardHarness c = card();
        byte[] p = rnd(200, 19);
        byte[] ph = rnd(1000, 20);
        c.writeTarget(1, p);
        c.writeTarget(2, ph);
        assertArrayEquals(p, c.readTarget(1));
        assertArrayEquals(ph, c.readTarget(2));
    }

    @Test
    void dataEncryptedInEeprom() throws Exception {
        CardHarness c = card();
        byte[] d = new byte[448];
        Arrays.fill(d, (byte) 0x41);
        c.writeTarget(1, d);
        // jCardSim chạy applet trong cùng tiến trình: kiểm tra mảng hồ sơ persistent bằng reflection.
        byte[] raw = persistentArray(c, "profile");
        assertEquals(448, raw.length);
        assertFalse(Arrays.equals(d, raw));
        // các khối bản rõ giống nhau không được cho ra các khối bản mã giống nhau (chuỗi CBC)
        assertFalse(Arrays.equals(Arrays.copyOfRange(raw, 0, 16), Arrays.copyOfRange(raw, 16, 32)));
        int same = 0;
        for (int i = 0; i < raw.length; i++) {
            if (raw[i] == d[i]) {
                same++;
            }
        }
        assertTrue(same < 40, "ciphertext looks like plaintext: " + same);
    }

    @Test
    void ciphertextChangesOnRewrite() throws Exception {
        CardHarness c = card();
        byte[] d = rnd(224, 21);
        c.writeTarget(1, d);
        byte[] first = persistentArray(c, "profile").clone();
        c.writeTarget(1, d);
        byte[] second = persistentArray(c, "profile");
        assertFalse(Arrays.equals(Arrays.copyOf(first, 224), Arrays.copyOf(second, 224)));
    }

    @Test
    void terminateWipesStore() throws Exception {
        CardHarness c = card();
        c.writeTarget(1, rnd(100, 22));
        assertEquals(0x9000, c.signed(0x70, 0x7F, 0, new byte[0]).getSW());
        byte[] raw = persistentArray(c, "profile");
        assertArrayEquals(new byte[raw.length], raw);
        assertArrayEquals(new byte[10080], persistentArray(c, "photo"));
    }

    private static byte[] persistentArray(CardHarness c, String field) throws Exception {
        Object applet = c.appletInstance();
        java.lang.reflect.Field fs = TravelCardApplet.class.getDeclaredField("store");
        fs.setAccessible(true);
        Object store = fs.get(applet);
        java.lang.reflect.Field f = SecureStore.class.getDeclaredField(field);
        f.setAccessible(true);
        return (byte[]) f.get(store);
    }
}
