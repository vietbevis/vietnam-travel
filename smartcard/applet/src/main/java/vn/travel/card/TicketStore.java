package vn.travel.card;

import javacard.framework.ISOException;
import javacard.framework.JCSystem;
import javacard.framework.Util;

/**
 * Các slot vé điện tử (spec 3.3 INS 60-63). Mỗi slot = status1 | ticket33, trong đó
 * ticket33 = orderCode12 | tourId12 | departure8 | pax1 và khóa tra cứu là 24 byte đầu.
 */
final class TicketStore {
    static final short TICKET_LEN = 33;
    static final short KEY_LEN = 24;
    static final byte ST_EMPTY = 0;
    static final byte ST_VALID = 1;
    static final byte ST_USED = 2;
    private static final short SLOT = 34;

    private final byte[] slots;

    TicketStore() {
        slots = new byte[(short) (CardConst.TICKET_SLOTS * SLOT)];
    }

    /** Lưu ticket33 tại buf[off]. Khóa VALID trùng khớp là thành công và không làm gì thêm. */
    void write(byte[] buf, short off) {
        short target = -1;
        short empty = -1;
        short used = -1;
        for (short i = 0; i < CardConst.TICKET_SLOTS; i++) {
            short b = (short) (i * SLOT);
            byte st = slots[b];
            if (st == ST_VALID) {
                if (Util.arrayCompare(slots, (short) (b + 1), buf, off, KEY_LEN) == 0) {
                    return;
                }
            } else if (st == ST_EMPTY) {
                if (empty < 0) {
                    empty = b;
                }
            } else if (used < 0) {
                used = b;
            }
        }
        target = empty >= 0 ? empty : used;
        if (target < 0) {
            ISOException.throwIt(CardConst.SW_NO_SPACE);
        }
        JCSystem.beginTransaction();
        Util.arrayCopy(buf, off, slots, (short) (target + 1), TICKET_LEN);
        slots[target] = ST_VALID;
        JCSystem.commitTransaction();
    }

    /** Chuyển VALID sang USED. 6A88 nếu không có khóa, 6985 nếu khóa chỉ tồn tại ở trạng thái USED. */
    void use(byte[] buf, short keyOff) {
        short s = find(buf, keyOff, ST_VALID);
        if (s < 0) {
            if (find(buf, keyOff, ST_USED) >= 0) {
                ISOException.throwIt(CardConst.SW_BAD_STATE);
            }
            ISOException.throwIt(CardConst.SW_NOT_FOUND);
        }
        JCSystem.beginTransaction();
        slots[s] = ST_USED;
        JCSystem.commitTransaction();
    }

    /** Giải phóng mọi slot (VALID hoặc USED) chứa khóa. 6A88 nếu không có. */
    void delete(byte[] buf, short keyOff) {
        if (find(buf, keyOff, ST_VALID) < 0 && find(buf, keyOff, ST_USED) < 0) {
            ISOException.throwIt(CardConst.SW_NOT_FOUND);
        }
        JCSystem.beginTransaction();
        for (short i = 0; i < CardConst.TICKET_SLOTS; i++) {
            short b = (short) (i * SLOT);
            if (slots[b] != ST_EMPTY
                    && Util.arrayCompare(slots, (short) (b + 1), buf, keyOff, KEY_LEN) == 0) {
                for (short j = 0; j < SLOT; j++) {
                    slots[(short) (b + j)] = 0;
                }
            }
        }
        JCSystem.commitTransaction();
    }

    /** count1 | n x (status1 | ticket33); trả về độ dài đã ghi. */
    short read(byte[] out, short off) {
        short p = (short) (off + 1);
        byte n = 0;
        for (short i = 0; i < CardConst.TICKET_SLOTS; i++) {
            short b = (short) (i * SLOT);
            if (slots[b] != ST_EMPTY) {
                Util.arrayCopyNonAtomic(slots, b, out, p, SLOT);
                p = (short) (p + SLOT);
                n++;
            }
        }
        out[off] = n;
        return (short) (p - off);
    }

    void wipe() {
        Util.arrayFillNonAtomic(slots, (short) 0, (short) slots.length, (byte) 0);
    }

    private short find(byte[] buf, short keyOff, byte status) {
        for (short i = 0; i < CardConst.TICKET_SLOTS; i++) {
            short b = (short) (i * SLOT);
            if (slots[b] == status
                    && Util.arrayCompare(slots, (short) (b + 1), buf, keyOff, KEY_LEN) == 0) {
                return b;
            }
        }
        return -1;
    }
}
