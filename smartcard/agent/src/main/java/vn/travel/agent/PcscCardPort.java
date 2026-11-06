package vn.travel.agent;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
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
        } catch (CardException | IllegalStateException | SecurityException | UnsatisfiedLinkError | NoClassDefFoundError e) {
            // hai lỗi cuối xảy ra khi thiếu thư viện PC/SC gốc
            drop();
            throw new NoCardException("no reader or card available", e);
        }
        throw new NoCardException("no reader or card available");
    }

    /** Số lần GET RESPONSE tối đa cho một APDU, tránh vòng lặp vô hạn khi thẻ lỗi. */
    private static final int MAX_GET_RESPONSE = 32;

    /**
     * {@inheritDoc}
     *
     * <p>Nếu lần transmit đầu tiên lỗi, kết nối bị bỏ và thử kết nối lại đúng một lần.
     * Lỗi giữa chừng thì mất các phản hồi đã nhận.
     */
    @Override
    public List<byte[]> transmitBatch(List<byte[]> apdus) throws NoCardException {
        synchronized (lock) {
            for (int attempt = 0; ; attempt++) {
                Card c = ensureCard();
                try {
                    return run(c.getBasicChannel(), apdus);
                } catch (CardException | IllegalStateException | IOException e) {
                    drop();
                    if (attempt >= 1) {
                        throw new NoCardException("card communication failed", e);
                    }
                }
            }
        }
    }

    private static List<byte[]> run(CardChannel ch, List<byte[]> apdus) throws CardException, IOException {
        List<byte[]> out = new ArrayList<>();
        for (byte[] apdu : apdus) {
            ByteArrayOutputStream data = new ByteArrayOutputStream();
            ResponseAPDU r = ch.transmit(new CommandAPDU(apdu));
            int rounds = 0;
            while (r.getSW1() == 0x61) {
                if (++rounds > MAX_GET_RESPONSE) {
                    throw new IOException("too many GET RESPONSE rounds");
                }
                data.write(r.getData(), 0, r.getData().length);
                int le = r.getSW2() == 0x00 ? 256 : r.getSW2();
                r = ch.transmit(new CommandAPDU(0x00, 0xC0, 0x00, 0x00, le));
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
                CardTerminal t = currentTerminal();
                if (t != null && t.isCardPresent()) {
                    return true;
                }
            } catch (NoCardException | CardException | IllegalStateException e) {
                // rơi xuống bên dưới
            }
            drop();
            return false;
        }
    }

    /** Terminal đang dùng theo tên đã kết nối; phải đang giữ khóa. */
    private CardTerminal currentTerminal() throws CardException {
        if (connectedReader == null) {
            return null;
        }
        for (CardTerminal t : TerminalFactory.getDefault().terminals().list()) {
            if (t.getName().equals(connectedReader)) {
                return t;
            }
        }
        return null;
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
