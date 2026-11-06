package vn.travel.agent;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.List;
import javax.smartcardio.Card;
import javax.smartcardio.CardChannel;
import javax.smartcardio.CardException;
import javax.smartcardio.CommandAPDU;
import javax.smartcardio.ResponseAPDU;
import org.junit.jupiter.api.Test;

class PcscCardPortTest {
    static final byte[] A0 = {(byte) 0x80, 0x10, 0, 0};
    static final byte[] A1 = {(byte) 0x80, 0x20, 0, 0};

    /** Kênh giả: lần transmit thứ failAt (đếm từ 0, chỉ tính lần mở đầu tiên) ném CardException. */
    static final class FakeChannel extends CardChannel {
        final List<Integer> sentIns;
        final int failOnCall;
        int calls;

        FakeChannel(List<Integer> sentIns, int failOnCall) {
            this.sentIns = sentIns;
            this.failOnCall = failOnCall;
        }

        @Override
        public ResponseAPDU transmit(CommandAPDU c) throws CardException {
            int n = calls++;
            sentIns.add(c.getINS());
            if (n == failOnCall) {
                throw new CardException("lỗi giả lập");
            }
            return new ResponseAPDU(new byte[] {(byte) 0x90, 0x00});
        }

        @Override
        public Card getCard() {
            return null;
        }

        @Override
        public int getChannelNumber() {
            return 0;
        }

        @Override
        public int transmit(ByteBuffer a, ByteBuffer b) {
            throw new UnsupportedOperationException();
        }

        @Override
        public void close() {}
    }

    /** Nguồn giả: kênh thứ nhất lỗi ở lần gọi failOnCall, các kênh sau luôn tốt. */
    static final class FakeSource implements PcscCardPort.ChannelSource {
        final List<Integer> sentIns = new ArrayList<>();
        int opens;
        int drops;
        final int failOnCall;

        FakeSource(int failOnCall) {
            this.failOnCall = failOnCall;
        }

        @Override
        public CardChannel open() {
            return new FakeChannel(sentIns, opens++ == 0 ? failOnCall : -1);
        }

        @Override
        public void drop() {
            drops++;
        }
    }

    @Test
    void failureOnFirstApduRetriesOnce() throws Exception {
        FakeSource src = new FakeSource(0);
        List<byte[]> out = PcscCardPort.transmitWithRetry(src, List.of(A0, A1));
        assertEquals(2, out.size());
        assertEquals(2, src.opens);
        assertEquals(1, src.drops);
        assertEquals(List.of(0x10, 0x10, 0x20), src.sentIns); // APDU 0: lỗi một lần, gửi lại một lần
    }

    @Test
    void failureOnSecondApduDoesNotResend() {
        FakeSource src = new FakeSource(1);
        assertThrows(NoCardException.class, () -> PcscCardPort.transmitWithRetry(src, List.of(A0, A1)));
        assertEquals(1, src.opens);
        assertEquals(1, src.drops);
        assertEquals(List.of(0x10, 0x20), src.sentIns); // APDU 0 chỉ gửi đúng một lần
    }
}
