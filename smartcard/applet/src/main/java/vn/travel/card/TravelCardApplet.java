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
    private final ServerAuth auth;
    private final SecureStore store;
    private final Wallet wallet;
    private final TicketStore tickets;
    private final RSAPublicKey serverKey;
    private final byte[] exponent;
    private final byte[] cardId;
    // [0] cardType, [1] state, [2] wipePending (đợt xóa của TERMINATE chưa hoàn tất)
    private final byte[] status;
    /** Buffer staging transient cho dữ liệu lệnh (các byte header vẫn nằm trong buffer APDU); xem receiveAll. */
    private final byte[] in;
    /** Vùng nháp M_auth (spec 3.2): 0x41 || nonce16 || cardId16 || txCounter4. */
    private final byte[] authMsg;

    private static final short S_TYPE = 0;
    private static final short S_STATE = 1;
    private static final short S_WIPE = 2;
    /** Kích thước staging: offset header 5 + Lc tối đa 255. */
    private static final short IN_LEN = 260;

    TravelCardApplet() {
        pin = new PinGuard();
        keys = new CardKeys();
        serverKey = (RSAPublicKey) KeyBuilder.buildKey(KeyBuilder.TYPE_RSA_PUBLIC, KeyBuilder.LENGTH_RSA_1024, false);
        exponent = new byte[] {0x01, 0x00, 0x01};
        auth = new ServerAuth(serverKey);
        store = new SecureStore();
        cardId = new byte[16];
        wallet = new Wallet(keys, cardId);
        tickets = new TicketStore();
        status = new byte[3];
        in = JCSystem.makeTransientByteArray(IN_LEN, JCSystem.CLEAR_ON_DESELECT);
        authMsg = JCSystem.makeTransientByteArray((short) 37, JCSystem.CLEAR_ON_DESELECT);
        status[S_TYPE] = CardConst.TYPE_BLANK;
        status[S_STATE] = CardConst.STATE_CREATED;
    }

    public static void install(byte[] bArray, short bOffset, byte bLength) {
        new TravelCardApplet().register();
    }

    public void process(APDU apdu) {
        if (status[S_WIPE] != 0) {
            // Đợt xóa TERMINATE bị gián đoạn (mất điện) được hoàn tất trước mọi việc khác.
            completeWipe();
        }
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
        try {
            checkAllowed(ins);
            dispatch(apdu, buf, ins);
        } finally {
            Util.arrayFillNonAtomic(in, (short) 0, IN_LEN, (byte) 0);
            if (ins == CardConst.INS_DEBIT) {
                // Spec 3.3: DEBIT luôn hủy phiên PIN và DEK, bất kể kết quả.
                pin.clearSession();
            }
        }
    }

    private void dispatch(APDU apdu, byte[] buf, byte ins) {
        switch (ins) {
            case CardConst.INS_GET_PUBLIC_INFO:
                getPublicInfo(apdu);
                break;
            case CardConst.INS_INIT:
                init(apdu);
                break;
            case CardConst.INS_VERIFY_PIN:
                verifyPin(apdu);
                break;
            case CardConst.INS_CHANGE_PIN:
                changePin(apdu);
                break;
            case CardConst.INS_GET_CHALLENGE:
                auth.issueChallenge(buf, (short) 0);
                apdu.setOutgoingAndSend((short) 0, (short) 16);
                break;
            case CardConst.INS_AUTHENTICATE:
                authenticate(apdu);
                break;
            case CardConst.INS_GET_CARD_PUBKEY:
                apdu.setOutgoingAndSend((short) 0, keys.getModulus(buf, (short) 0));
                break;
            case CardConst.INS_SET_STATE:
                setState(apdu);
                break;
            case CardConst.INS_RESET_PIN:
                resetPin(apdu);
                break;
            case CardConst.INS_READ_DATA:
                readData(apdu);
                break;
            case CardConst.INS_BEGIN_WRITE:
                beginWrite(apdu);
                break;
            case CardConst.INS_WRITE_CHUNK:
                writeChunk(apdu);
                break;
            case CardConst.INS_COMMIT_WRITE:
                commitWrite(apdu);
                break;
            case CardConst.INS_GET_BALANCE:
                apdu.setOutgoingAndSend((short) 0, wallet.balance(buf, (short) 0));
                break;
            case CardConst.INS_CREDIT:
                apdu.setOutgoingAndSend((short) 0, walletTx(apdu, true));
                break;
            case CardConst.INS_DEBIT:
                apdu.setOutgoingAndSend((short) 0, walletTx(apdu, false));
                break;
            case CardConst.INS_READ_TX_LOG:
                apdu.setOutgoingAndSend((short) 0, wallet.log(buf, (short) 0));
                break;
            case CardConst.INS_GET_RECEIPT:
                getReceipt(apdu);
                break;
            case CardConst.INS_WRITE_TICKET:
            case CardConst.INS_USE_TICKET:
            case CardConst.INS_DELETE_TICKET:
                ticketCmd(apdu, ins);
                break;
            case CardConst.INS_READ_TICKETS:
                apdu.setOutgoingAndSend((short) 0, tickets.read(buf, (short) 0));
                break;
            default:
                ISOException.throwIt(CardConst.SW_INS_NOT_SUPPORTED);
        }
    }

    private void ticketCmd(APDU apdu, byte ins) {
        byte[] buf = apdu.getBuffer();
        short payloadLen = receiveSigned(apdu);
        short want = ins == CardConst.INS_WRITE_TICKET ? TicketStore.TICKET_LEN : TicketStore.KEY_LEN;
        if (payloadLen != want) {
            ISOException.throwIt(CardConst.SW_WRONG_LENGTH);
        }
        if (ins == CardConst.INS_WRITE_TICKET) {
            tickets.write(in, ISO7816.OFFSET_CDATA);
        } else if (ins == CardConst.INS_USE_TICKET) {
            tickets.use(in, ISO7816.OFFSET_CDATA);
        } else {
            tickets.delete(in, ISO7816.OFFSET_CDATA);
        }
    }

    private short walletTx(APDU apdu, boolean credit) {
        byte[] buf = apdu.getBuffer();
        short payloadLen = receiveSigned(apdu);
        if (payloadLen != 12) {
            ISOException.throwIt(CardConst.SW_WRONG_LENGTH);
        }
        return credit ? wallet.credit(in, ISO7816.OFFSET_CDATA, buf, (short) 0)
                : wallet.debit(in, ISO7816.OFFSET_CDATA, buf, (short) 0);
    }

    private void getReceipt(APDU apdu) {
        byte[] buf = apdu.getBuffer();
        short lc = (short) (buf[ISO7816.OFFSET_LC] & 0xFF);
        if (lc != 8) {
            ISOException.throwIt(CardConst.SW_WRONG_LENGTH);
        }
        receiveAll(apdu, lc);
        apdu.setOutgoingAndSend((short) 0, wallet.receipt(in, ISO7816.OFFSET_CDATA, buf, (short) 0));
    }

    public void deselect() {
        auth.clear();
        pin.clearSession();
    }

    /**
     * Nhận toàn bộ Lc byte dữ liệu (lặp qua receiveBytes, vì lần đọc đầu có thể chỉ nhận một phần với
     * T=1 chained / contactless) vào buffer staging transient tại ISO7816.OFFSET_CDATA, và xóa
     * từng chunk đã nhận khỏi buffer APDU. Buffer APDU phải chứa ít nhất 5 + 128 byte
     * (mức tối thiểu của Java Card là 133); truyền thiếu hoặc bị đứng sẽ lỗi 6700. Các handler đọc
     * dữ liệu từ {@code in}; buffer staging được xóa về 0 trong process() ở mọi đường thoát.
     */
    private void receiveAll(APDU apdu, short lc) {
        byte[] buf = apdu.getBuffer();
        short got = apdu.setIncomingAndReceive();
        short total = 0;
        while (got > 0) {
            if ((short) (total + got) > lc) {
                got = (short) (lc - total);
            }
            Util.arrayCopyNonAtomic(buf, ISO7816.OFFSET_CDATA, in, (short) (ISO7816.OFFSET_CDATA + total), got);
            Util.arrayFillNonAtomic(buf, ISO7816.OFFSET_CDATA, got, (byte) 0);
            total = (short) (total + got);
            if (total >= lc) {
                break;
            }
            got = apdu.receiveBytes(ISO7816.OFFSET_CDATA);
        }
        if (total != lc) {
            ISOException.throwIt(CardConst.SW_WRONG_LENGTH);
        }
    }

    private short receivePins(APDU apdu, short expected) {
        byte[] buf = apdu.getBuffer();
        short lc = (short) (buf[ISO7816.OFFSET_LC] & 0xFF);
        if (lc != expected) {
            ISOException.throwIt(CardConst.SW_WRONG_LENGTH);
        }
        receiveAll(apdu, lc);
        for (short i = 0; i < lc; i++) {
            byte d = in[(short) (ISO7816.OFFSET_CDATA + i)];
            if (d < 0x30 || d > 0x39) {
                ISOException.throwIt(CardConst.SW_BAD_DATA);
            }
        }
        return ISO7816.OFFSET_CDATA;
    }

    private void verifyPin(APDU apdu) {
        short off = receivePins(apdu, CardConst.PIN_LEN);
        pin.verify(in, off);
    }

    private void changePin(APDU apdu) {
        short off = receivePins(apdu, (short) (2 * CardConst.PIN_LEN));
        pin.change(in, off, (short) (off + CardConst.PIN_LEN));
    }

    /** Nhận toàn bộ dữ liệu lệnh và xác minh chữ ký server; trả về độ dài payload. */
    private short receiveSigned(APDU apdu) {
        byte[] buf = apdu.getBuffer();
        short lc = (short) (buf[ISO7816.OFFSET_LC] & 0xFF);
        try {
            receiveAll(apdu, lc);
        } catch (ISOException e) {
            auth.clear();
            throw e;
        }
        return auth.verifySigned(in, ISO7816.OFFSET_CDATA, lc, buf[ISO7816.OFFSET_INS],
                buf[ISO7816.OFFSET_P1], buf[ISO7816.OFFSET_P2], cardId);
    }

    private void authenticate(APDU apdu) {
        byte[] buf = apdu.getBuffer();
        short lc = (short) (buf[ISO7816.OFFSET_LC] & 0xFF);
        if (lc != 16) {
            ISOException.throwIt(CardConst.SW_WRONG_LENGTH);
        }
        receiveAll(apdu, lc);
        authMsg[0] = 0x41;
        Util.arrayCopyNonAtomic(in, ISO7816.OFFSET_CDATA, authMsg, (short) 1, (short) 16);
        Util.arrayCopyNonAtomic(cardId, (short) 0, authMsg, (short) 17, (short) 16);
        wallet.counter(authMsg, (short) 33);
        Util.arrayCopyNonAtomic(authMsg, (short) 33, buf, (short) 0, (short) 4);
        keys.sign(authMsg, (short) 0, (short) 37, buf, (short) 4);
        apdu.setOutgoingAndSend((short) 0, (short) 132);
    }

    private void setState(APDU apdu) {
        byte[] buf = apdu.getBuffer();
        short payloadLen = receiveSigned(apdu);
        if (payloadLen != 0) {
            ISOException.throwIt(CardConst.SW_WRONG_LENGTH);
        }
        byte target = buf[ISO7816.OFFSET_P1];
        if (target != CardConst.STATE_ACTIVE && target != CardConst.STATE_LOCKED
                && target != CardConst.STATE_TERMINATED) {
            ISOException.throwIt(CardConst.SW_BAD_P1P2);
        }
        if (target == status[S_STATE]) {
            return;
        }
        if (target == CardConst.STATE_TERMINATED) {
            // Chỉ commit việc đổi state + wipePending (nhỏ, an toàn khi mất điện). Các thao tác xóa không được
            // ghi journal (arrayFillNonAtomic, xóa khóa, bộ đếm OwnerPIN), nên chúng chạy ngoài
            // transaction và là idempotent; process() chạy lại chúng khi wipePending còn được đặt.
            JCSystem.beginTransaction();
            status[S_STATE] = CardConst.STATE_TERMINATED;
            status[S_WIPE] = 1;
            JCSystem.commitTransaction();
            completeWipe();
            return;
        }
        JCSystem.beginTransaction();
        if (target == CardConst.STATE_LOCKED) {
            pin.clearSession();
        }
        status[S_STATE] = target;
        JCSystem.commitTransaction();
    }

    /** Xóa TERMINATE idempotent toàn bộ bí mật và dữ liệu người dùng; xóa wipePending sau cùng. */
    void completeWipe() {
        pin.wipe();
        keys.clear();
        serverKey.clearKey();
        wallet.wipe();
        tickets.wipe();
        store.wipe();
        status[S_WIPE] = 0;
    }

    private void readData(APDU apdu) {
        byte[] buf = apdu.getBuffer();
        byte target = buf[ISO7816.OFFSET_P1];
        SecureStore.checkTarget(target);
        byte p2 = buf[ISO7816.OFFSET_P2];
        if (p2 == (byte) 0xFF) {
            Util.setShort(buf, (short) 0, store.length(target));
            apdu.setOutgoingAndSend((short) 0, (short) 2);
            return;
        }
        short n = store.readChunk(target, p2, pin.dek(), buf, (short) 0);
        apdu.setOutgoingAndSend((short) 0, n);
    }

    private void beginWrite(APDU apdu) {
        byte[] buf = apdu.getBuffer();
        byte target = buf[ISO7816.OFFSET_P1];
        SecureStore.checkTarget(target);
        short lc = (short) (buf[ISO7816.OFFSET_LC] & 0xFF);
        if (lc != 2) {
            ISOException.throwIt(CardConst.SW_WRONG_LENGTH);
        }
        receiveAll(apdu, lc);
        store.begin(target, Util.getShort(in, ISO7816.OFFSET_CDATA));
    }

    private void writeChunk(APDU apdu) {
        byte[] buf = apdu.getBuffer();
        byte target = buf[ISO7816.OFFSET_P1];
        SecureStore.checkTarget(target);
        short lc = (short) (buf[ISO7816.OFFSET_LC] & 0xFF);
        receiveAll(apdu, lc);
        store.writeChunk(target, buf[ISO7816.OFFSET_P2], in, ISO7816.OFFSET_CDATA, lc, pin.dek());
    }

    private void commitWrite(APDU apdu) {
        byte[] buf = apdu.getBuffer();
        byte target = buf[ISO7816.OFFSET_P1];
        SecureStore.checkTarget(target);
        short payloadLen = receiveSigned(apdu);
        if (payloadLen != 34) {
            ISOException.throwIt(CardConst.SW_WRONG_LENGTH);
        }
        store.commit(target, in, ISO7816.OFFSET_CDATA, Util.getShort(in, (short) (ISO7816.OFFSET_CDATA + 32)));
    }

    private void resetPin(APDU apdu) {
        short payloadLen = receiveSigned(apdu);
        if (payloadLen != 16) {
            ISOException.throwIt(CardConst.SW_WRONG_LENGTH);
        }
        pin.resetWithEscrow(in, ISO7816.OFFSET_CDATA);
    }

    private void init(APDU apdu) {
        byte[] buf = apdu.getBuffer();
        short lc = (short) (buf[ISO7816.OFFSET_LC] & 0xFF);
        if (lc != 167) {
            ISOException.throwIt(CardConst.SW_WRONG_LENGTH);
        }
        receiveAll(apdu, lc);
        final short base = ISO7816.OFFSET_CDATA;
        final short pinOff = (short) (base + 16 + 1 + 128);
        final short escrowOff = (short) (pinOff + 6);
        for (short i = 0; i < CardConst.PIN_LEN; i++) {
            byte d = in[(short) (pinOff + i)];
            if (d < 0x30 || d > 0x39) {
                ISOException.throwIt(CardConst.SW_BAD_DATA);
            }
        }
        byte type = in[(short) (base + 16)];
        if (type != CardConst.TYPE_CUSTOMER && type != CardConst.TYPE_STAFF) {
            ISOException.throwIt(CardConst.SW_BAD_DATA);
        }
        keys.generate();
        JCSystem.beginTransaction();
        Util.arrayCopy(in, base, cardId, (short) 0, (short) 16);
        status[S_TYPE] = type;
        serverKey.setModulus(in, (short) (base + 17), (short) 128);
        serverKey.setExponent(exponent, (short) 0, (short) 3);
        pin.init(in, pinOff, escrowOff);
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

    /** Ma trận chặn lệnh spec 3.3, quy tắc chỉ dành cho khách hàng và yêu cầu PIN. */
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
