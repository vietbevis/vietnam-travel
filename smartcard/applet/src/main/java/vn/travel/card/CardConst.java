package vn.travel.card;

/** Các hằng số giao thức (spec mục 3.1, 3.3, 3.4). */
final class CardConst {
    private CardConst() {}

    // 3.1
    static final byte CLA = (byte) 0x80;
    static final byte VERSION = (byte) 0x01;

    static final byte TYPE_BLANK = (byte) 0x00;
    static final byte TYPE_CUSTOMER = (byte) 0x01;
    static final byte TYPE_STAFF = (byte) 0x02;

    static final byte STATE_CREATED = (byte) 0x00;
    static final byte STATE_ACTIVE = (byte) 0x02;
    static final byte STATE_LOCKED = (byte) 0x03;
    static final byte STATE_TERMINATED = (byte) 0x7F;

    static final byte PIN_TRIES = 5;
    static final byte PIN_LEN = 6;

    // BALANCE_MAX = 50 000 000 = 0x02FAF080 dưới dạng hai short hi/lo (applet không dùng int)
    static final short BALANCE_MAX_HI = (short) 0x02FA;
    static final short BALANCE_MAX_LO = (short) 0xF080;

    static final short CHUNK = 224;
    static final short PROFILE_MAX = 448;
    static final short PHOTO_MAX = 10080;
    static final byte TICKET_SLOTS = 5;
    static final byte LOG_SIZE = 10;

    static final byte TARGET_PROFILE = 0x01;
    static final byte TARGET_PHOTO = 0x02;

    // 3.3 INS
    static final byte INS_INIT = 0x01;
    static final byte INS_GET_PUBLIC_INFO = 0x10;
    static final byte INS_VERIFY_PIN = 0x20;
    static final byte INS_CHANGE_PIN = 0x21;
    static final byte INS_RESET_PIN = 0x22;
    static final byte INS_GET_CHALLENGE = 0x30;
    static final byte INS_AUTHENTICATE = 0x31;
    static final byte INS_GET_CARD_PUBKEY = 0x32;
    static final byte INS_READ_DATA = 0x40;
    static final byte INS_BEGIN_WRITE = 0x41;
    static final byte INS_WRITE_CHUNK = 0x42;
    static final byte INS_COMMIT_WRITE = 0x43;
    static final byte INS_GET_BALANCE = 0x50;
    static final byte INS_CREDIT = 0x51;
    static final byte INS_DEBIT = 0x52;
    static final byte INS_READ_TX_LOG = 0x53;
    static final byte INS_GET_RECEIPT = 0x54;
    static final byte INS_WRITE_TICKET = 0x60;
    static final byte INS_READ_TICKETS = 0x61;
    static final byte INS_USE_TICKET = 0x62;
    static final byte INS_DELETE_TICKET = 0x63;
    static final byte INS_SET_STATE = 0x70;

    // 3.4 SW
    static final short SW_WRONG_LENGTH = (short) 0x6700;
    static final short SW_PIN_FAILED_BASE = (short) 0x63C0;
    static final short SW_PIN_NOT_VERIFIED = (short) 0x6982;
    static final short SW_PIN_BLOCKED = (short) 0x6983;
    static final short SW_BAD_STATE = (short) 0x6985;
    static final short SW_CARD_TYPE = (short) 0x6986;
    static final short SW_BAD_DATA = (short) 0x6A80;
    static final short SW_NO_SPACE = (short) 0x6A84;
    static final short SW_BAD_P1P2 = (short) 0x6A86;
    static final short SW_NOT_FOUND = (short) 0x6A88;
    static final short SW_INS_NOT_SUPPORTED = (short) 0x6D00;
    static final short SW_CLA_NOT_SUPPORTED = (short) 0x6E00;
    static final short SW_INSUFFICIENT_BALANCE = (short) 0x6F10;
    static final short SW_BALANCE_LIMIT = (short) 0x6F11;
    static final short SW_BAD_SIGNATURE = (short) 0x6F20;
    static final short SW_NO_CHALLENGE = (short) 0x6F21;
}
