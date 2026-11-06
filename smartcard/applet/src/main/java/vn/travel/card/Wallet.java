package vn.travel.card;

import javacard.framework.ISOException;
import javacard.framework.JCSystem;
import javacard.framework.Util;

/**
 * Stored-value wallet (spec 3.2 M_rcpt, 3.3 INS 50-54): balance, txCounter and a 10-entry ring log.
 * Balance, counter and log change only inside one transaction.
 */
final class Wallet {
    /** Receipt tag: distinct from M_auth 0x41 (37 bytes) and M_cmd 0x43. */
    static final byte TAG_RCPT = 0x52;
    static final short RCPT_MSG_LEN = 38;
    static final short RCPT_LEN = 166;
    static final byte TYPE_CREDIT = 0x01;
    static final byte TYPE_DEBIT = 0x02;

    /** Log entry: type1 | amount4 | balanceAfter4 | counter4 | txRef8. */
    private static final short ENTRY = 21;
    private static final short O_AMOUNT = 1;
    private static final short O_BAL = 5;
    private static final short O_CTR = 9;
    private static final short O_REF = 13;
    /** calc layout. */
    private static final short C_NBAL = 0;
    private static final short C_NCTR = 4;
    private static final short C_MAX = 8;
    private static final short C_ONE = 12;

    private final CardKeys keys;
    private final byte[] cardId;
    /** balance4 | counter4 (persistent). */
    private final byte[] state;
    private final byte[] ring;
    /** [0] next write slot, [1] entries held. */
    private final byte[] meta;
    private final byte[] calc;
    private final byte[] msg;

    Wallet(CardKeys keys, byte[] cardId) {
        this.keys = keys;
        this.cardId = cardId;
        state = new byte[8];
        ring = new byte[(short) (CardConst.LOG_SIZE * ENTRY)];
        meta = new byte[2];
        calc = JCSystem.makeTransientByteArray((short) 16, JCSystem.CLEAR_ON_DESELECT);
        msg = JCSystem.makeTransientByteArray(RCPT_MSG_LEN, JCSystem.CLEAR_ON_DESELECT);
    }

    /** payload = txRef8 | amount4 at buf[p]. Writes the 166-byte receipt to out[o]. */
    short credit(byte[] buf, short p, byte[] out, short o) {
        checkAmount(buf, p);
        Util.setShort(calc, C_MAX, CardConst.BALANCE_MAX_HI);
        Util.setShort(calc, (short) (C_MAX + 2), CardConst.BALANCE_MAX_LO);
        if (!U32.add(state, (short) 0, buf, (short) (p + 8), calc, C_NBAL)
                || U32.compare(calc, C_NBAL, calc, C_MAX) > 0) {
            ISOException.throwIt(CardConst.SW_BALANCE_LIMIT);
        }
        return commit(TYPE_CREDIT, buf, p, out, o);
    }

    short debit(byte[] buf, short p, byte[] out, short o) {
        checkAmount(buf, p);
        if (!U32.sub(state, (short) 0, buf, (short) (p + 8), calc, C_NBAL)) {
            ISOException.throwIt(CardConst.SW_INSUFFICIENT_BALANCE);
        }
        return commit(TYPE_DEBIT, buf, p, out, o);
    }

    /** Re-signs the receipt of the newest log entry with this txRef8 (at txRef[off]); else 6A88. */
    short receipt(byte[] txRef, short off, byte[] out, short outOff) {
        short slot = meta[0];
        for (short i = 0; i < meta[1]; i++) {
            slot = prev(slot);
            if (Util.arrayCompare(ring, (short) (slot * ENTRY + O_REF), txRef, off, (short) 8) == 0) {
                return emit(slot, out, outOff);
            }
        }
        ISOException.throwIt(CardConst.SW_NOT_FOUND);
        return 0;
    }

    /** balance4 | counter4; returns 8. */
    short balance(byte[] out, short off) {
        Util.arrayCopyNonAtomic(state, (short) 0, out, off, (short) 8);
        return 8;
    }

    /** count1 | entries, newest first. */
    short log(byte[] out, short off) {
        byte count = meta[1];
        out[off] = count;
        short w = (short) (off + 1);
        short slot = meta[0];
        for (short i = 0; i < count; i++) {
            slot = prev(slot);
            Util.arrayCopyNonAtomic(ring, (short) (slot * ENTRY), out, w, ENTRY);
            w = (short) (w + ENTRY);
        }
        return (short) (w - off);
    }

    void counter(byte[] out, short off) {
        Util.arrayCopyNonAtomic(state, (short) 4, out, off, (short) 4);
    }

    void wipe() {
        Util.arrayFillNonAtomic(state, (short) 0, (short) 8, (byte) 0);
        Util.arrayFillNonAtomic(ring, (short) 0, (short) ring.length, (byte) 0);
        Util.arrayFillNonAtomic(meta, (short) 0, (short) 2, (byte) 0);
    }

    private static void checkAmount(byte[] buf, short p) {
        if (U32.isZero(buf, (short) (p + 8))) {
            ISOException.throwIt(CardConst.SW_BAD_DATA);
        }
    }

    private static short prev(short slot) {
        return slot == 0 ? (short) (CardConst.LOG_SIZE - 1) : (short) (slot - 1);
    }

    /** calc[C_NBAL] holds the new balance. Bumps the counter, logs, and returns the signed receipt. */
    private short commit(byte type, byte[] in, short p, byte[] out, short o) {
        Util.setShort(calc, C_ONE, (short) 0);
        Util.setShort(calc, (short) (C_ONE + 2), (short) 1);
        if (!U32.add(state, (short) 4, calc, C_ONE, calc, C_NCTR)) {
            ISOException.throwIt(CardConst.SW_BAD_STATE);
        }
        short slot = meta[0];
        short eo = (short) (slot * ENTRY);
        JCSystem.beginTransaction();
        Util.arrayCopy(calc, (short) 0, state, (short) 0, (short) 8);
        ring[eo] = type;
        Util.arrayCopy(in, (short) (p + 8), ring, (short) (eo + O_AMOUNT), (short) 4);
        Util.arrayCopy(calc, C_NBAL, ring, (short) (eo + O_BAL), (short) 4);
        Util.arrayCopy(calc, C_NCTR, ring, (short) (eo + O_CTR), (short) 4);
        Util.arrayCopy(in, p, ring, (short) (eo + O_REF), (short) 8);
        short next = (short) (slot + 1);
        meta[0] = next == CardConst.LOG_SIZE ? (byte) 0 : (byte) next;
        if (meta[1] < CardConst.LOG_SIZE) {
            meta[1]++;
        }
        JCSystem.commitTransaction();
        return emit(slot, out, o);
    }

    /** Builds M_rcpt from log slot and writes M_rcpt | sig128 to out[o]. */
    private short emit(short slot, byte[] out, short o) {
        short eo = (short) (slot * ENTRY);
        msg[0] = TAG_RCPT;
        Util.arrayCopyNonAtomic(cardId, (short) 0, msg, (short) 1, (short) 16);
        msg[17] = ring[eo];
        Util.arrayCopyNonAtomic(ring, (short) (eo + O_REF), msg, (short) 18, (short) 8);
        Util.arrayCopyNonAtomic(ring, (short) (eo + O_AMOUNT), msg, (short) 26, (short) 4);
        Util.arrayCopyNonAtomic(ring, (short) (eo + O_BAL), msg, (short) 30, (short) 4);
        Util.arrayCopyNonAtomic(ring, (short) (eo + O_CTR), msg, (short) 34, (short) 4);
        Util.arrayCopyNonAtomic(msg, (short) 0, out, o, RCPT_MSG_LEN);
        keys.sign(msg, (short) 0, RCPT_MSG_LEN, out, (short) (o + RCPT_MSG_LEN));
        return RCPT_LEN;
    }
}
