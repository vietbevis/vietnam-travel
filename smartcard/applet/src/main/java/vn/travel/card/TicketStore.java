package vn.travel.card;

import javacard.framework.ISOException;
import javacard.framework.JCSystem;
import javacard.framework.Util;

/**
 * E-ticket slots (spec 3.3 INS 60-63). Each slot = status1 | ticket33, where
 * ticket33 = orderCode12 | tourId12 | departure8 | pax1 and the lookup key is its first 24 bytes.
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

    /** Stores ticket33 at buf[off]. An identical VALID key is a no-op success. */
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

    /** VALID to USED. 6A88 if no such key, 6985 if it is only present as USED. */
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

    /** Frees every slot (VALID or USED) holding the key. 6A88 if none. */
    void delete(byte[] buf, short keyOff) {
        if (find(buf, keyOff, ST_VALID) < 0 && find(buf, keyOff, ST_USED) < 0) {
            ISOException.throwIt(CardConst.SW_NOT_FOUND);
        }
        JCSystem.beginTransaction();
        for (short i = 0; i < CardConst.TICKET_SLOTS; i++) {
            short b = (short) (i * SLOT);
            if (slots[b] != ST_EMPTY
                    && Util.arrayCompare(slots, (short) (b + 1), buf, keyOff, KEY_LEN) == 0) {
                Util.arrayFill(slots, b, SLOT, (byte) 0);
            }
        }
        JCSystem.commitTransaction();
    }

    /** count1 | n x (status1 | ticket33); returns the length written. */
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
