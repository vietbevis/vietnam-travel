package vn.travel.agent;

/** Tiện ích chuyển đổi giữa mảng byte và chuỗi hex. */
public final class Hex {
    private static final char[] DIGITS = "0123456789ABCDEF".toCharArray();

    private Hex() {}

    /**
     * Giải mã chuỗi hex (chấp nhận chữ hoa và thường). Chuỗi rỗng {@code ""} trả về mảng rỗng.
     *
     * @throws IllegalArgumentException nếu chuỗi null, độ dài lẻ hoặc chứa ký tự không phải hex
     */
    public static byte[] decode(String s) {
        if (s == null || (s.length() & 1) != 0) {
            throw new IllegalArgumentException("Chuỗi hex phải có độ dài chẵn");
        }
        byte[] out = new byte[s.length() / 2];
        for (int i = 0; i < out.length; i++) {
            int hi = Character.digit(s.charAt(2 * i), 16);
            int lo = Character.digit(s.charAt(2 * i + 1), 16);
            if (hi < 0 || lo < 0 || s.charAt(2 * i) > 'f' || s.charAt(2 * i + 1) > 'f') {
                throw new IllegalArgumentException("Ký tự hex không hợp lệ");
            }
            out[i] = (byte) (hi << 4 | lo);
        }
        return out;
    }

    /** Mã hóa mảng byte thành chuỗi hex chữ hoa; mảng rỗng cho chuỗi rỗng. */
    public static String encode(byte[] b) {
        char[] c = new char[b.length * 2];
        for (int i = 0; i < b.length; i++) {
            c[2 * i] = DIGITS[(b[i] >> 4) & 0xF];
            c[2 * i + 1] = DIGITS[b[i] & 0xF];
        }
        return new String(c);
    }
}
