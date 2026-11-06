package vn.travel.card;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class U32Test {
    private static byte[] b(long v) {
        return CardHarness.u32(v);
    }

    private static byte[] add(long x, long y) {
        byte[] o = new byte[4];
        assertTrue(U32.add(b(x), (short) 0, b(y), (short) 0, o, (short) 0));
        return o;
    }

    @Test
    void carryAcrossBytes() {
        assertArrayEquals(b(0x01000000L), add(0x00FFFFFFL, 1));
        assertArrayEquals(b(0x0100L), add(0xFF, 1));
        assertArrayEquals(b(0xFFFFFFFFL), add(0x7FFFFFFFL, 0x80000000L));
        assertArrayEquals(b(0x02FAF080L), add(0x02FAF07FL, 1));
    }

    @Test
    void addInPlaceAndOffsets() {
        byte[] a = {9, 0, 0, 0, 0, (byte) 0xFF, 7};
        byte[] one = {0, 0, 0, 1};
        assertTrue(U32.add(a, (short) 2, one, (short) 0, a, (short) 2));
        assertArrayEquals(new byte[] {9, 0, 0, 0, 1, 0, 7}, new byte[] {a[0], a[1], a[2], a[3], a[4], a[5], a[6]});
    }

    @Test
    void overflowDetected() {
        byte[] o = new byte[4];
        assertFalse(U32.add(b(0xFFFFFFFFL), (short) 0, b(1), (short) 0, o, (short) 0));
        assertFalse(U32.add(b(0x80000000L), (short) 0, b(0x80000000L), (short) 0, o, (short) 0));
    }

    @Test
    void borrow() {
        byte[] o = new byte[4];
        assertTrue(U32.sub(b(0x01000000L), (short) 0, b(1), (short) 0, o, (short) 0));
        assertArrayEquals(b(0x00FFFFFFL), o);
        assertFalse(U32.sub(b(0), (short) 0, b(1), (short) 0, o, (short) 0));
        assertFalse(U32.sub(b(100), (short) 0, b(101), (short) 0, o, (short) 0));
        assertTrue(U32.sub(b(100), (short) 0, b(100), (short) 0, o, (short) 0));
        assertArrayEquals(b(0), o);
        assertTrue(U32.sub(b(0xFFFFFFFFL), (short) 0, b(0xFFFFFFFFL), (short) 0, o, (short) 0));
    }

    @Test
    void compareOrder() {
        assertEquals(-1, U32.compare(b(0x02FAF080L), (short) 0, b(0x02FAF081L), (short) 0));
        assertEquals(1, U32.compare(b(0x02FAF081L), (short) 0, b(0x02FAF080L), (short) 0));
        assertEquals(0, U32.compare(b(0x02FAF080L), (short) 0, b(0x02FAF080L), (short) 0));
        // unsigned: high bit set is larger
        assertEquals(1, U32.compare(b(0x80000000L), (short) 0, b(0x7FFFFFFFL), (short) 0));
        assertEquals(-1, U32.compare(b(0x00000000L), (short) 0, b(0xFF000000L), (short) 0));
    }

    @Test
    void zero() {
        assertTrue(U32.isZero(b(0), (short) 0));
        assertFalse(U32.isZero(b(1), (short) 0));
        assertFalse(U32.isZero(b(0x01000000L), (short) 0));
        assertFalse(U32.isZero(b(0x80000000L), (short) 0));
    }
}
