package vn.travel.card;

import javacard.framework.APDU;
import javacard.framework.Applet;
import javacard.framework.ISO7816;
import javacard.framework.ISOException;
import javacard.framework.JCSystem;
import javacard.security.KeyBuilder;
import javacard.security.RSAPublicKey;
import javacard.framework.Util;

public class TravelCardApplet extends Applet {
    private final PinGuard pin;
    private final CardKeys keys;
    private final RSAPublicKey serverKey;
    private final byte[] exponent;
    private final byte[] cardId;
    // [0] cardType, [1] state
    private final byte[] status;

    private static final short S_TYPE = 0;
    private static final short S_STATE = 1;

    TravelCardApplet() {
        pin = new PinGuard();
        keys = new CardKeys();
        serverKey = (RSAPublicKey) KeyBuilder.buildKey(KeyBuilder.TYPE_RSA_PUBLIC, KeyBuilder.LENGTH_RSA_1024, false);
        exponent = new byte[] {0x01, 0x00, 0x01};
        cardId = new byte[16];
        status = new byte[2];
        status[S_TYPE] = CardConst.TYPE_BLANK;
        status[S_STATE] = CardConst.STATE_CREATED;
    }

    public static void install(byte[] bArray, short bOffset, byte bLength) {
        new TravelCardApplet().register();
    }

    public void process(APDU apdu) {
        if (selectingApplet()) {
            return;
        }
        byte[] buf = apdu.getBuffer();
        if (buf[ISO7816.OFFSET_CLA] != CardConst.CLA) {
            ISOException.throwIt(CardConst.SW_CLA_NOT_SUPPORTED);
        }
        byte ins = buf[ISO7816.OFFSET_INS];
        if (!knownIns(ins)) {
            ISOException.throwIt(CardConst.SW_INS_NOT_SUPPORTED);
        }
        checkAllowed(ins);
        switch (ins) {
            case CardConst.INS_GET_PUBLIC_INFO:
                getPublicInfo(apdu);
                break;
            case CardConst.INS_INIT:
                init(apdu);
                break;
            default:
                ISOException.throwIt(CardConst.SW_INS_NOT_SUPPORTED);
        }
    }

    private void init(APDU apdu) {
        byte[] buf = apdu.getBuffer();
        short lc = (short) (buf[ISO7816.OFFSET_LC] & 0xFF);
        if (lc != 167) {
            ISOException.throwIt(CardConst.SW_WRONG_LENGTH);
        }
        short got = apdu.setIncomingAndReceive();
        if (got != lc) {
            ISOException.throwIt(CardConst.SW_WRONG_LENGTH);
        }
        final short base = ISO7816.OFFSET_CDATA;
        final short pinOff = (short) (base + 16 + 1 + 128);
        final short escrowOff = (short) (pinOff + 6);
        for (short i = 0; i < CardConst.PIN_LEN; i++) {
            byte d = buf[(short) (pinOff + i)];
            if (d < 0x30 || d > 0x39) {
                ISOException.throwIt(CardConst.SW_BAD_DATA);
            }
        }
        byte type = buf[(short) (base + 16)];
        if (type != CardConst.TYPE_CUSTOMER && type != CardConst.TYPE_STAFF) {
            ISOException.throwIt(CardConst.SW_BAD_DATA);
        }
        keys.generate();
        JCSystem.beginTransaction();
        Util.arrayCopy(buf, base, cardId, (short) 0, (short) 16);
        status[S_TYPE] = type;
        serverKey.setModulus(buf, (short) (base + 17), (short) 128);
        serverKey.setExponent(exponent, (short) 0, (short) 3);
        pin.init(buf, pinOff, escrowOff);
        status[S_STATE] = CardConst.STATE_ACTIVE;
        JCSystem.commitTransaction();
        short n = keys.getModulus(buf, (short) 0);
        apdu.setOutgoingAndSend((short) 0, n);
    }

    private static boolean knownIns(byte ins) {
        switch (ins) {
            case CardConst.INS_INIT:
            case CardConst.INS_GET_PUBLIC_INFO:
            case CardConst.INS_VERIFY_PIN:
            case CardConst.INS_CHANGE_PIN:
            case CardConst.INS_RESET_PIN:
            case CardConst.INS_GET_CHALLENGE:
            case CardConst.INS_AUTHENTICATE:
            case CardConst.INS_GET_CARD_PUBKEY:
            case CardConst.INS_READ_DATA:
            case CardConst.INS_BEGIN_WRITE:
            case CardConst.INS_WRITE_CHUNK:
            case CardConst.INS_COMMIT_WRITE:
            case CardConst.INS_GET_BALANCE:
            case CardConst.INS_CREDIT:
            case CardConst.INS_DEBIT:
            case CardConst.INS_READ_TX_LOG:
            case CardConst.INS_GET_RECEIPT:
            case CardConst.INS_WRITE_TICKET:
            case CardConst.INS_READ_TICKETS:
            case CardConst.INS_USE_TICKET:
            case CardConst.INS_DELETE_TICKET:
            case CardConst.INS_SET_STATE:
                return true;
            default:
                return false;
        }
    }

    private static boolean customerOnly(byte ins) {
        return ins >= CardConst.INS_GET_BALANCE && ins <= CardConst.INS_DELETE_TICKET
                && ins != CardConst.INS_SET_STATE;
    }

    private static boolean needsPin(byte ins) {
        switch (ins) {
            case CardConst.INS_AUTHENTICATE:
            case CardConst.INS_READ_DATA:
            case CardConst.INS_BEGIN_WRITE:
            case CardConst.INS_WRITE_CHUNK:
            case CardConst.INS_GET_BALANCE:
            case CardConst.INS_DEBIT:
            case CardConst.INS_READ_TX_LOG:
            case CardConst.INS_READ_TICKETS:
                return true;
            default:
                return false;
        }
    }

    /** Spec 3.3 command-blocking matrix, customer-only rule, and PIN requirement. */
    private void checkAllowed(byte ins) {
        boolean allowed;
        switch (status[S_STATE]) {
            case CardConst.STATE_TERMINATED:
                allowed = ins == CardConst.INS_GET_PUBLIC_INFO;
                break;
            case CardConst.STATE_CREATED:
                allowed = ins == CardConst.INS_GET_PUBLIC_INFO || ins == CardConst.INS_INIT;
                break;
            case CardConst.STATE_LOCKED:
                allowed = ins == CardConst.INS_GET_PUBLIC_INFO
                        || ins == CardConst.INS_GET_CHALLENGE
                        || ins == CardConst.INS_SET_STATE;
                break;
            case CardConst.STATE_ACTIVE:
                if (ins == CardConst.INS_INIT) {
                    allowed = false;
                } else if (pin.mustChangePin()) {
                    allowed = ins == CardConst.INS_GET_PUBLIC_INFO
                            || ins == CardConst.INS_VERIFY_PIN
                            || ins == CardConst.INS_CHANGE_PIN
                            || ins == CardConst.INS_RESET_PIN
                            || ins == CardConst.INS_GET_CHALLENGE
                            || ins == CardConst.INS_GET_CARD_PUBKEY
                            || ins == CardConst.INS_BEGIN_WRITE
                            || ins == CardConst.INS_WRITE_CHUNK
                            || ins == CardConst.INS_COMMIT_WRITE
                            || ins == CardConst.INS_SET_STATE;
                } else {
                    allowed = true;
                }
                break;
            default:
                allowed = false;
        }
        if (!allowed) {
            ISOException.throwIt(CardConst.SW_BAD_STATE);
        }
        if (customerOnly(ins) && status[S_TYPE] != CardConst.TYPE_CUSTOMER) {
            ISOException.throwIt(CardConst.SW_CARD_TYPE);
        }
        if (needsPin(ins)) {
            if (pin.triesRemaining() == 0) {
                ISOException.throwIt(CardConst.SW_PIN_BLOCKED);
            }
            if (!pin.isValidated()) {
                ISOException.throwIt(CardConst.SW_PIN_NOT_VERIFIED);
            }
        }
    }

    private void getPublicInfo(APDU apdu) {
        byte[] buf = apdu.getBuffer();
        Util.arrayCopyNonAtomic(cardId, (short) 0, buf, (short) 0, (short) 16);
        buf[16] = status[S_TYPE];
        buf[17] = status[S_STATE];
        buf[18] = pin.mustChangePin() ? (byte) 1 : (byte) 0;
        buf[19] = pin.triesRemaining();
        buf[20] = CardConst.VERSION;
        apdu.setOutgoingAndSend((short) 0, (short) 21);
    }
}
