package vn.travel.agent;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.List;
import javax.smartcardio.Card;
import javax.smartcardio.CardChannel;
import javax.smartcardio.CardException;
import javax.smartcardio.CardTerminal;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import javax.smartcardio.TerminalFactory;

/** Đầu đọc PC/SC thật. Kết nối khi cần và tự kết nối lại ở lần gọi kế tiếp sau khi lỗi. */
public final class PcscCardPort implements CardPort {
    private final Object lock = new Object();
    private final String wantedReader;
    private Card card;
    private String connectedReader;

    public PcscCardPort(String readerNameOrNull) {
        this.wantedReader = readerNameOrNull == null || readerNameOrNull.isBlank() ? null : readerNameOrNull;
    }

    private void drop() {
        if (card != null) {
            try {
                card.disconnect(false);
            } catch (Exception ignored) {
                // thẻ đã không còn kết nối
            }
        }
        card = null;
        connectedReader = null;
    }

    /** Phải đang giữ khóa. */
    private Card ensureCard() throws NoCardException {
        if (card != null) {
            return card;
        }
        try {
            List<CardTerminal> terminals = TerminalFactory.getDefault().terminals().list();
            for (CardTerminal t : terminals) {
                if (wantedReader != null && !t.getName().equals(wantedReader)) {
                    continue;
                }
                if (t.isCardPresent()) {
                    card = t.connect("*");
                    connectedReader = t.getName();
                    return card;
                }
            }
        } catch (CardException | IllegalStateException | SecurityException | Error e) {
            // Error bao gồm trường hợp thiếu thư viện PC/SC gốc (UnsatisfiedLinkError / NoClassDefFoundError)
            drop();
            throw new NoCardException("no reader or card available", e);
        }
        throw new NoCardException("no reader or card available");
    }

    @Override
    public List<byte[]> transmitBatch(List<byte[]> apdus) throws NoCardException {
        synchronized (lock) {
            Card c = ensureCard();
            try {
                CardChannel ch = c.getBasicChannel();
                List<byte[]> out = new ArrayList<>();
                for (byte[] apdu : apdus) {
                    ByteArrayOutputStream data = new ByteArrayOutputStream();
                    ResponseAPDU r = ch.transmit(new CommandAPDU(apdu));
                    while (r.getSW1() == 0x61) {
                        data.write(r.getData(), 0, r.getData().length);
                        r = ch.transmit(new CommandAPDU(0x00, 0xC0, 0x00, 0x00, r.getSW2()));
                    }
                    data.write(r.getData(), 0, r.getData().length);
                    data.write(r.getSW1());
                    data.write(r.getSW2());
                    out.add(data.toByteArray());
                    if (r.getSW() != 0x9000) {
                        break;
                    }
                }
                return out;
            } catch (CardException | IllegalStateException e) {
                drop();
                throw new NoCardException("card communication failed", e);
            }
        }
    }

    @Override
    public String readerName() {
        synchronized (lock) {
            return connectedReader != null ? connectedReader : wantedReader;
        }
    }

    @Override
    public boolean cardPresent() {
        synchronized (lock) {
            try {
                ensureCard();
                return true;
            } catch (NoCardException e) {
                return false;
            }
        }
    }

    @Override
    public Integer slot() {
        return null;
    }

    @Override
    public String mode() {
        return "pcsc";
    }
}
