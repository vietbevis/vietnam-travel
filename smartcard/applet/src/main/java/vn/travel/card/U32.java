package vn.travel.card;

/**
 * Số học 32 bit không dấu big-endian trên mảng byte (spec 3.1). Chỉ dùng byte/short: không có int/long.
 * out có thể trùng với một toán hạng tại cùng offset. Khi trả về false, nội dung out là không xác định.
 */
final class U32 {
    private U32() {}

    /** out = a + b; false nếu tràn quá 2^32 - 1. */
    static boolean add(byte[] a, short aOff, byte[] b, short bOff, byte[] out, short outOff) {
        short carry = 0;
        for (short i = 3; i >= 0; i--) {
            short s = (short) ((short) (a[(short) (aOff + i)] & 0xFF)
                    + (short) (b[(short) (bOff + i)] & 0xFF) + carry);
            out[(short) (outOff + i)] = (byte) s;
            carry = (short) (s >> 8);
        }
        return carry == 0;
    }

    /** out = a - b; false nếu b > a (kết quả sẽ âm). */
    static boolean sub(byte[] a, short aOff, byte[] b, short bOff, byte[] out, short outOff) {
        short borrow = 0;
        for (short i = 3; i >= 0; i--) {
            short s = (short) ((short) (a[(short) (aOff + i)] & 0xFF)
                    - (short) (b[(short) (bOff + i)] & 0xFF) - borrow);
            out[(short) (outOff + i)] = (byte) s;
            borrow = (short) (s < 0 ? 1 : 0);
        }
        return borrow == 0;
    }

    /** -1 nếu a &lt; b, 0 nếu bằng, 1 nếu a &gt; b (không dấu). */
    static short compare(byte[] a, short aOff, byte[] b, short bOff) {
        for (short i = 0; i < 4; i++) {
            short x = (short) (a[(short) (aOff + i)] & 0xFF);
            short y = (short) (b[(short) (bOff + i)] & 0xFF);
            if (x != y) {
                return x < y ? (short) -1 : (short) 1;
            }
        }
        return 0;
    }

    static boolean isZero(byte[] a, short aOff) {
        return (a[aOff] | a[(short) (aOff + 1)] | a[(short) (aOff + 2)] | a[(short) (aOff + 3)]) == 0;
    }
}
