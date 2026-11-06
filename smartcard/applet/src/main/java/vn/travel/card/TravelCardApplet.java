package vn.travel.card;

import javacard.framework.APDU;
import javacard.framework.Applet;
import javacard.framework.ISO7816;
import javacard.framework.ISOException;
import javacard.framework.OwnerPIN;
import javacard.framework.Util;

public class TravelCardApplet extends Applet {
    private final OwnerPIN pin;
    private final byte[] cardId;
    // [0] cardType, [1] state, [2] mustChangePin
    private final byte[] status;

    private static final short S_TYPE = 0;
    private static final short S_STATE = 1;
    private static final short S_MUST_CHANGE = 2;

    private TravelCardApplet() {
        pin = new OwnerPIN(CardConst.PIN_TRIES, CardConst.PIN_LEN);
        cardId = new byte[16];
        status = new byte[3];
        status[S_TYPE] = CardConst.TYPE_BLANK;
        status[S_STATE] = CardConst.STATE_CREATED;
        status[S_MUST_CHANGE] = 0;
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
            default:
                ISOException.throwIt(CardConst.SW_INS_NOT_SUPPORTED);
        }
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
                } else if (status[S_MUST_CHANGE] != 0) {
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
            if (pin.getTriesRemaining() == 0) {
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
        buf[18] = status[S_MUST_CHANGE];
        buf[19] = pin.getTriesRemaining();
        buf[20] = CardConst.VERSION;
        apdu.setOutgoingAndSend((short) 0, (short) 21);
    }
}
